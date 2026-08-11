'use client';

import { useEffect, useMemo, useState } from 'react';
import { defaultWorkPresets, type WorkPresetId } from '../../lib/scheduling';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { deriveCommercialClearanceReadiness, loadCommercialClearances, loadCommercialPolicies, saveCommercialClearance, saveCommercialPolicies, type BrowserCommercialClearanceRecord, type BrowserCommercialPolicy, type CommercialClearanceMode } from '../../lib/browser-commercial-clearance';
import styles from './browser-commercial-clearance.module.css';

const modes: Array<{ value: CommercialClearanceMode; label: string }> = [
  { value: 'no_preclearance', label: 'No pre-dispatch clearance required' },
  { value: 'deposit_required', label: 'Deposit / prepayment required' },
  { value: 'po_required', label: 'Purchase Order required' },
  { value: 'finance_approval', label: 'Finance approval required' },
];

function completePolicies(existing: BrowserCommercialPolicy[]) {
  return defaultWorkPresets.map((preset) => existing.find((policy) => policy.presetId === preset.id) ?? ({ presetId: preset.id, mode: 'finance_approval', reviewed: false, updatedAt: new Date(0).toISOString(), updatedBy: 'Not reviewed' } satisfies BrowserCommercialPolicy));
}

function defaultClearance(workOrderId: string, mode: CommercialClearanceMode): BrowserCommercialClearanceRecord {
  return { workOrderId, mode, status: 'not_checked', updatedAt: new Date(0).toISOString() };
}

export function BrowserCommercialClearance() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [policies, setPolicies] = useState<BrowserCommercialPolicy[]>([]);
  const [clearances, setClearances] = useState<BrowserCommercialClearanceRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<BrowserCommercialClearanceRecord | null>(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    setOrders(storedOrders);
    setPolicies(completePolicies(loadCommercialPolicies()));
    setClearances(loadCommercialClearances());
    setSelectedId(storedOrders[storedOrders.length - 1]?.id ?? '');
  }, []);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedPolicy = selectedOrder ? policies.find((policy) => policy.presetId === selectedOrder.presetId) : undefined;
  const selectedClearance = selectedOrder ? clearances.find((record) => record.workOrderId === selectedOrder.id) : undefined;

  useEffect(() => {
    if (!selectedOrder || !selectedPolicy) return;
    setDraft(selectedClearance ?? defaultClearance(selectedOrder.id, selectedPolicy.mode));
    setNotice(null);
  }, [selectedOrder?.id, selectedPolicy?.mode, selectedClearance?.updatedAt]);

  const readiness = useMemo(() => selectedOrder ? deriveCommercialClearanceReadiness(selectedOrder, { policies, clearances: draft ? [...clearances.filter((item) => item.workOrderId !== selectedOrder.id), draft] : clearances }) : null, [clearances, draft, policies, selectedOrder]);

  const patchPolicy = (presetId: WorkPresetId, patch: Partial<BrowserCommercialPolicy>) => {
    setPolicies((current) => current.map((policy) => policy.presetId === presetId ? { ...policy, ...patch } : policy));
    setPolicyDirty(true);
  };

  const savePolicies = () => {
    setPolicies(completePolicies(saveCommercialPolicies(policies)));
    setPolicyDirty(false);
    setNotice('Commercial Terms Policy saved. Work Orders now recalculate clearance from the reviewed policy and their evidence record.');
  };

  const patchDraft = (patch: Partial<BrowserCommercialClearanceRecord>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setNotice(null);
  };

  const saveClearance = () => {
    if (!draft || !selectedPolicy) return;
    const normalized = { ...draft, mode: selectedPolicy.mode };
    const saved = saveCommercialClearance(normalized);
    setClearances((current) => current.some((record) => record.workOrderId === saved.workOrderId) ? current.map((record) => record.workOrderId === saved.workOrderId ? saved : record) : [...current, saved]);
    setDraft(saved);
    setNotice(`${saved.workOrderId} Commercial Clearance evidence saved. This does not create or apply a payment.`);
  };

  if (!selectedOrder || !selectedPolicy || !draft || !readiness) return null;

  return (
    <section className={styles.workspace}>
      <header><div><span>COMMERCIAL PRE-DISPATCH CONTROL</span><h2>Terms & Clearance</h2><p>Define what commercial evidence is required before a job may dispatch. Clearance evidence is operational authorization only—it does not post accounting or invent bank activity.</p></div><label>Work Order<select value={selectedOrder.id} onChange={(event) => setSelectedId(event.target.value)}>{orders.slice().reverse().map((order) => <option value={order.id} key={order.id}>{order.id} · {order.customer}</option>)}</select></label></header>
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.summary}><article><span>Work Type</span><strong>{selectedOrder.presetId.replaceAll('_', ' ')}</strong><small>{selectedOrder.customerFacingDescription}</small></article><article><span>Policy</span><strong>{selectedPolicy.reviewed ? selectedPolicy.mode.replaceAll('_', ' ') : 'NOT REVIEWED'}</strong><small>{selectedPolicy.reviewed ? selectedPolicy.updatedBy : 'Commercial readiness remains AT RISK'}</small></article><article><span>Commercial Readiness</span><strong className={readiness.status === 'ready' ? styles.good : readiness.status === 'blocked' ? styles.danger : styles.warn}>{readiness.status.replace('_', ' ').toUpperCase()}</strong><small>{readiness.source}</small></article></div>

      <div className={styles.layout}>
        <main>
          <div className={styles.sectionHead}><div><strong>Work Order Clearance Evidence</strong><span>{selectedPolicy.reviewed ? `Required mode: ${selectedPolicy.mode.replaceAll('_', ' ')}` : 'Review the Work Preset policy before this record can be authoritative'}</span></div></div>
          {selectedPolicy.mode === 'no_preclearance' ? <div className={styles.noEvidence}><strong>No Work Order evidence required by this reviewed mode.</strong><p>If this policy is marked Reviewed, Commercial Clearance derives READY without fabricating a payment or PO.</p></div> : <div className={styles.form}>
            <label>Clearance status<select value={draft.status} onChange={(event) => patchDraft({ status: event.target.value as BrowserCommercialClearanceRecord['status'] })}><option value="not_checked">Not checked</option><option value="cleared">Cleared / evidence reviewed</option><option value="blocked">Blocked</option></select></label>
            {selectedPolicy.mode === 'deposit_required' ? <><label>Required amount (AWG)<input type="number" min="0" step="0.01" value={draft.requiredAmount ?? ''} onChange={(event) => patchDraft({ requiredAmount: event.target.value ? Number(event.target.value) : undefined })} placeholder="From accepted proposal/terms" /></label><label>Confirmed received amount (AWG)<input type="number" min="0" step="0.01" value={draft.confirmedAmount ?? ''} onChange={(event) => patchDraft({ confirmedAmount: event.target.value ? Number(event.target.value) : undefined })} placeholder="Confirmed evidence only" /></label><label>Payment / bank evidence reference<input value={draft.paymentEvidenceRef ?? ''} onChange={(event) => patchDraft({ paymentEvidenceRef: event.target.value })} placeholder="Bank transaction ID, receipt ref, etc." /></label></> : null}
            {selectedPolicy.mode === 'po_required' ? <label className={styles.wide}>Purchase Order reference<input value={draft.poReference ?? ''} onChange={(event) => patchDraft({ poReference: event.target.value })} placeholder="Customer PO / authorization reference" /></label> : null}
            {selectedPolicy.mode === 'finance_approval' ? <><label>Approved by<input value={draft.approvedBy ?? ''} onChange={(event) => patchDraft({ approvedBy: event.target.value })} placeholder="Authorized Finance / owner identity" /></label><label>Approval reason<input value={draft.approvalReason ?? ''} onChange={(event) => patchDraft({ approvalReason: event.target.value })} placeholder="Why dispatch is commercially cleared" /></label></> : null}
            <label className={styles.wide}>Finance note<textarea rows={3} value={draft.note ?? ''} onChange={(event) => patchDraft({ note: event.target.value })} placeholder="Operational note only; do not enter bank credentials or card data." /></label>
          </div>}
          <footer><button type="button" disabled={!selectedPolicy.reviewed || selectedPolicy.mode === 'no_preclearance'} onClick={saveClearance}>Save Clearance Evidence</button></footer>
        </main>

        <aside>
          <div className={styles.sectionHead}><div><strong>Derived Evidence</strong><span>What Consolidated Job Readiness will use</span></div></div>
          <div className={`${styles.readiness} ${readiness.status === 'ready' ? styles.readyBox : readiness.status === 'blocked' ? styles.blockedBox : styles.riskBox}`}><span>{readiness.status.replace('_', ' ').toUpperCase()}</span><strong>{readiness.reason}</strong><small>{readiness.source}</small></div>
          <div className={styles.guardrail}><span>ACCOUNTING GUARDRAIL</span><strong>Commercial clearance is not payment posting.</strong><p>A bank evidence reference only supports the dispatch decision. Payment allocation, customer balance, invoice status and QBO remain separate authoritative workflows.</p></div>
        </aside>
      </div>

      <section className={styles.policyPanel}><div className={styles.sectionHead}><div><strong>Commercial Terms Policy by Work Preset</strong><span>Unreviewed policy keeps the Work Order AT RISK</span></div><button type="button" disabled={!policyDirty} onClick={savePolicies}>{policyDirty ? 'Save Policy' : 'Policy Saved'}</button></div><div className={styles.policyGrid}>{policies.map((policy) => { const preset = defaultWorkPresets.find((item) => item.id === policy.presetId); return <article key={policy.presetId} className={policy.reviewed ? styles.reviewed : ''}><strong>{preset?.label ?? policy.presetId}</strong><select value={policy.mode} onChange={(event) => patchPolicy(policy.presetId, { mode: event.target.value as CommercialClearanceMode, reviewed: false })}>{modes.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select><label><input type="checkbox" checked={policy.reviewed} onChange={(event) => patchPolicy(policy.presetId, { reviewed: event.target.checked })}/><span>{policy.reviewed ? 'Reviewed' : 'Needs review'}</span></label></article>; })}</div></section>
    </section>
  );
}
