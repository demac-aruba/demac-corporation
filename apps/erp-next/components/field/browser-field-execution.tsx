'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { canSubmitFieldExecution, createFieldExecution, createOfficeReview, type BrowserFieldExecutionRecord, type BrowserOfficeReviewRecord, type FieldAddonState, type FieldEquipmentProgress } from '../../lib/browser-field';
import { loadWorkOrderScopes, scopeStatus } from '../../lib/browser-workorder-scope';
import styles from './browser-field-execution.module.css';

const refrigerantOptions: Array<FieldEquipmentProgress['refrigerantState']> = ['not_checked', 'normal', 'low', 'recovered', 'recharged'];

function labelState(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function BrowserFieldExecution() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [executions, setExecutions] = useState<BrowserFieldExecutionRecord[]>([]);
  const [reviews, setReviews] = useState<BrowserOfficeReviewRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    const storedExecutions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
    const storedReviews = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
    setOrders(storedOrders);
    setExecutions(storedExecutions);
    setReviews(storedReviews);
    setSelectedId(storedOrders[storedOrders.length - 1]?.id ?? '');
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveBrowserValue(browserKeys.fieldExecutions, executions);
  }, [executions, ready]);

  useEffect(() => {
    if (!ready) return;
    saveBrowserValue(browserKeys.officeReviews, reviews);
  }, [reviews, ready]);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedExecution = executions.find((execution) => execution.workOrderId === selectedOrder?.id);
  const selectedReview = reviews.find((review) => review.workOrderId === selectedOrder?.id);
  const selectedScope = selectedOrder ? loadWorkOrderScopes().find((scope) => scope.workOrderId === selectedOrder.id) : undefined;
  const scopeGate = selectedOrder ? scopeStatus(selectedOrder, selectedScope) : { complete: false, reason: 'No Work Order selected.' };
  const fieldGate = useMemo(() => selectedExecution ? canSubmitFieldExecution(selectedExecution) : { allowed: false, blockers: ['Start the work order first.'] }, [selectedExecution]);
  const canSubmit = scopeGate.complete && fieldGate.allowed && selectedReview?.status !== 'pending' && selectedReview?.status !== 'approved';

  const updateExecution = (mutator: (current: BrowserFieldExecutionRecord) => BrowserFieldExecutionRecord) => {
    if (!selectedOrder) return;
    setExecutions((current) => {
      const existing = current.find((item) => item.workOrderId === selectedOrder.id) ?? createFieldExecution(selectedOrder);
      const next = { ...mutator(existing), updatedAt: new Date().toISOString() };
      return current.some((item) => item.workOrderId === selectedOrder.id)
        ? current.map((item) => item.workOrderId === selectedOrder.id ? next : item)
        : [...current, next];
    });
  };

  const startWork = () => {
    if (!selectedOrder) return;
    if (!scopeGate.complete) {
      setNotice(scopeGate.reason);
      return;
    }
    updateExecution((current) => ({ ...current, technicianStatus: 'in_progress', startedAt: current.startedAt ?? new Date().toISOString() }));
    setNotice(`${selectedOrder.id} started with its exact Work Order equipment scope. Progress will survive refresh on this browser.`);
  };

  const reopenReturned = () => {
    if (!selectedExecution || selectedReview?.status !== 'returned') return;
    updateExecution((current) => ({ ...current, technicianStatus: 'in_progress', submittedAt: undefined }));
    setNotice(`${selectedOrder?.id} reopened for correction. Office reviewer note remains visible in the review record.`);
  };

  const updateEquipment = (assetId: string, patch: Partial<FieldEquipmentProgress>) => {
    if (!scopeGate.complete) {
      setNotice(scopeGate.reason);
      return;
    }
    updateExecution((current) => ({ ...current, technicianStatus: current.technicianStatus === 'not_started' ? 'in_progress' : current.technicianStatus, startedAt: current.startedAt ?? new Date().toISOString(), equipment: current.equipment.map((item) => item.assetId === assetId ? { ...item, ...patch } : item) }));
  };

  const updateAddon = (key: keyof FieldAddonState, value: number) => {
    updateExecution((current) => ({ ...current, addons: { ...current.addons, [key]: Math.max(0, value || 0) } }));
  };

  const queueTranscription = () => {
    updateExecution((current) => ({ ...current, voiceTranscriptionStatus: current.voiceSeconds > 0 && current.voiceSeconds <= 120 ? 'transcribed' : 'none' }));
  };

  const submitForOffice = () => {
    if (!selectedOrder || !selectedExecution) return;
    if (!scopeGate.complete) {
      setNotice(scopeGate.reason);
      return;
    }
    const submissionGate = canSubmitFieldExecution(selectedExecution);
    if (!submissionGate.allowed) {
      setNotice(submissionGate.blockers.join(' '));
      return;
    }
    if (selectedReview?.status === 'pending') {
      setNotice('This Work Order is already awaiting Office Review.');
      return;
    }
    if (selectedReview?.status === 'approved') {
      setNotice('This report is already office-approved. A governed revision would require a new revision workflow.');
      return;
    }

    const submittedAt = new Date().toISOString();
    const submitted = { ...selectedExecution, technicianStatus: 'submitted' as const, submittedAt, updatedAt: submittedAt };
    const nextExecutions = executions.map((item) => item.workOrderId === submitted.workOrderId ? submitted : item);
    setExecutions(nextExecutions);
    saveBrowserValue(browserKeys.fieldExecutions, nextExecutions);

    const freshReview = createOfficeReview(selectedOrder, submitted);
    const nextReviews = selectedReview
      ? reviews.map((review) => review.workOrderId === selectedOrder.id ? { ...freshReview, id: review.id, reviewerNote: review.reviewerNote } : review)
      : [...reviews, freshReview];
    setReviews(nextReviews);
    saveBrowserValue(browserKeys.officeReviews, nextReviews);
    setNotice(`${selectedOrder.id} submitted to Office Review. Nothing was sent to the customer automatically.`);
  };

  if (!ready) return <section className={styles.loading}>Loading field workspace…</section>;

  if (!orders.length) return (
    <section className={styles.empty}>
      <div><span>FIELD EXECUTION CHAIN</span><strong>No Scheduling-created Work Order is available yet</strong><p>Create and confirm an appointment in Scheduling. The resulting Work Order will appear here without re-entering customer, site or work information.</p></div>
      <a href="/scheduling/">Create appointment →</a>
    </section>
  );

  const execution = selectedExecution;
  const completedCount = execution?.equipment.filter((item) => item.status === 'complete').length ?? 0;
  const totalEquipment = execution?.equipment.length ?? Math.max(1, selectedOrder.totalQuantity);
  const isLockedByOffice = selectedReview?.status === 'pending' || selectedReview?.status === 'approved';
  const isReturned = selectedReview?.status === 'returned';

  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div><span>LIVE PERSISTENT FIELD FLOW</span><h2>Technician Execution</h2><p>Execute the exact HVAC assets assigned to a Scheduling-created Work Order and submit one report to Office Review.</p></div>
        <div className={styles.orderSelect}><label>Work Order<select value={selectedOrder.id} onChange={(event) => { setSelectedId(event.target.value); setNotice(null); }}>{orders.slice().reverse().map((order) => <option key={order.id} value={order.id}>{order.id} · {order.customer}</option>)}</select></label></div>
      </header>

      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.summary}>
        <article><span>Customer</span><strong>{selectedOrder.customer}</strong><small>{selectedOrder.customerId ? `CRM ${selectedOrder.customerId}` : 'Unregistered lead snapshot'}</small></article>
        <article><span>Property</span><strong>{selectedOrder.site}</strong><small>{selectedOrder.siteId ? `Site ${selectedOrder.siteId}` : selectedOrder.sector}</small></article>
        <article><span>Assigned</span><strong>{selectedOrder.primaryVanId}{selectedOrder.supportVanId ? ` + ${selectedOrder.supportVanId}` : ''}</strong><small>{selectedOrder.customerFacingDescription}</small></article>
        <article><span>Progress</span><strong>{completedCount} / {totalEquipment}</strong><small>{execution ? labelState(execution.technicianStatus) : 'Not started'}{selectedReview ? ` · Review ${selectedReview.status}` : ''}</small></article>
      </div>

      {!scopeGate.complete ? <section className={styles.scopeGate}><div><span>EXACT EQUIPMENT SCOPE REQUIRED</span><strong>{scopeGate.reason}</strong><p>Field work cannot start or submit from inferred property equipment. Office must identify the exact registered/planned HVAC units on the Work Order first.</p></div><a href="/work-orders/scope/">Set Exact Scope →</a></section> : null}

      {isReturned ? <section className={styles.returnedBanner}><div><span>RETURNED BY OFFICE</span><strong>This Work Order needs correction before it can be approved.</strong><p>{selectedReview?.reviewerNote || 'Open Office Review for the reviewer note and required correction.'}</p></div><button type="button" onClick={reopenReturned} disabled={execution?.technicianStatus !== 'submitted'}>Reopen for Correction</button></section> : null}

      {!execution ? <div className={styles.startPanel}><div><span>{scopeGate.complete ? 'WORK ORDER READY FOR FIELD EXECUTION' : 'WORK ORDER NOT FIELD-READY'}</span><strong>{selectedOrder.customerFacingDescription}</strong><p>{selectedOrder.technicianInstructions || 'No technician-only instructions were captured.'}</p></div><button type="button" disabled={!scopeGate.complete} onClick={startWork}>Start Work</button></div> : null}

      {execution ? <>
        <section className={styles.instructions}><div><span>CUSTOMER-FACING SCOPE</span><strong>{selectedOrder.customerFacingDescription}</strong></div><div><span>TECHNICIAN-ONLY INSTRUCTIONS</span><strong>{selectedOrder.technicianInstructions || 'No internal instructions.'}</strong></div></section>

        <section className={styles.equipmentSection}>
          <div className={styles.sectionHead}><div><span>1</span><div><strong>Exact Equipment Execution</strong><small>{scopeGate.complete ? 'These records come from the saved Work Order asset scope.' : 'Scope is incomplete; execution changes are blocked.'}</small></div></div><b>{completedCount}/{execution.equipment.length} complete</b></div>
          <div className={styles.equipmentGrid}>{execution.equipment.map((item) => <article className={`${styles.equipmentCard} ${item.status === 'complete' ? styles.complete : ''}`} key={item.assetId}>
            <header><div><span>{item.assetId}</span><strong>{item.name}</strong><small>{item.type}{item.capacity ? ` · ${item.capacity}` : ''}{item.serial ? ` · ${item.serial}` : ''}</small></div><b>{labelState(item.status)}</b></header>
            <div className={styles.evidenceGrid}><button type="button" disabled={isLockedByOffice || !scopeGate.complete} className={item.beforePhoto ? styles.captured : ''} onClick={() => updateEquipment(item.assetId, { beforePhoto: !item.beforePhoto })}><span>{item.beforePhoto ? '✓' : '○'}</span>Before photo</button><button type="button" disabled={isLockedByOffice || !scopeGate.complete} className={item.afterPhoto ? styles.captured : ''} onClick={() => updateEquipment(item.assetId, { afterPhoto: !item.afterPhoto })}><span>{item.afterPhoto ? '✓' : '○'}</span>After photo</button><button type="button" disabled={isLockedByOffice || !scopeGate.complete} className={item.gaugePhoto ? styles.captured : ''} onClick={() => updateEquipment(item.assetId, { gaugePhoto: !item.gaugePhoto })}><span>{item.gaugePhoto ? '✓' : '○'}</span>Gauge photo</button></div>
            <div className={styles.fieldGrid}><label>Refrigerant state<select disabled={isLockedByOffice || !scopeGate.complete} value={item.refrigerantState} onChange={(event) => updateEquipment(item.assetId, { refrigerantState: event.target.value as FieldEquipmentProgress['refrigerantState'] })}>{refrigerantOptions.map((value) => <option value={value} key={value}>{labelState(value)}</option>)}</select></label><label>Measurement<input disabled={isLockedByOffice || !scopeGate.complete} value={item.measurement ?? ''} onChange={(event) => updateEquipment(item.assetId, { measurement: event.target.value })} placeholder="Pressure / temp / reading" /></label><label className={styles.wide}>Technical note<input disabled={isLockedByOffice || !scopeGate.complete} value={item.note ?? ''} onChange={(event) => updateEquipment(item.assetId, { note: event.target.value })} placeholder="Optional equipment-specific note" /></label></div>
            <footer><button type="button" disabled={isLockedByOffice || !scopeGate.complete} onClick={() => updateEquipment(item.assetId, { status: item.status === 'pending' ? 'in_progress' : 'pending' })}>{item.status === 'pending' ? 'Begin unit' : 'Reset unit'}</button><button type="button" disabled={isLockedByOffice || !scopeGate.complete} className={styles.primaryButton} onClick={() => updateEquipment(item.assetId, { status: 'complete' })}>Mark Complete</button></footer>
          </article>)}</div>
        </section>

        <section className={styles.twoColumn}>
          <article className={styles.panel}><div className={styles.sectionHead}><div><span>2</span><div><strong>Materials & Add-ons</strong><small>Captured before submission; downstream Inventory uses submitted quantities.</small></div></div></div><div className={styles.addonGrid}><label>220V switches<input disabled={isLockedByOffice} type="number" min="0" value={execution.addons.switches} onChange={(event) => updateAddon('switches', Number(event.target.value))}/></label><label>Brackets<input disabled={isLockedByOffice} type="number" min="0" value={execution.addons.brackets} onChange={(event) => updateAddon('brackets', Number(event.target.value))}/></label><label>Armaflex<input disabled={isLockedByOffice} type="number" min="0" value={execution.addons.armaflex} onChange={(event) => updateAddon('armaflex', Number(event.target.value))}/></label><label>Refrigerant lb<input disabled={isLockedByOffice} type="number" min="0" step="0.1" value={execution.addons.refrigerantLb} onChange={(event) => updateAddon('refrigerantLb', Number(event.target.value))}/></label></div></article>
          <article className={styles.panel}><div className={styles.sectionHead}><div><span>3</span><div><strong>Voice & Summary</strong><small>Voice is limited to 2 minutes and transcription does not block field progress.</small></div></div></div><div className={styles.voiceRow}><label>Voice duration (seconds)<input disabled={isLockedByOffice} type="number" min="0" max="180" value={execution.voiceSeconds} onChange={(event) => updateExecution((current) => ({ ...current, voiceSeconds: Math.max(0, Number(event.target.value) || 0), voiceTranscriptionStatus: 'none' }))}/></label><button type="button" disabled={isLockedByOffice || !execution.voiceSeconds || execution.voiceSeconds > 120} onClick={queueTranscription}>{execution.voiceTranscriptionStatus === 'transcribed' ? '✓ Transcribed' : 'Transcribe in background'}</button></div>{execution.voiceSeconds > 120 ? <p className={styles.errorText}>Voice note exceeds the 120-second limit.</p> : null}<label className={styles.summaryField}>Technician summary<textarea disabled={isLockedByOffice} rows={4} value={execution.technicianSummary} onChange={(event) => updateExecution((current) => ({ ...current, technicianSummary: event.target.value }))} placeholder="What was found, what was done, and what should the office/customer know?" /></label></article>
        </section>

        <section className={styles.submitPanel}><div><span>4 · SUBMIT GATE</span><strong>{selectedReview?.status === 'approved' ? 'Office Approved' : selectedReview?.status === 'pending' ? 'Awaiting Office Review' : canSubmit ? 'Ready for Office Review' : 'Field report is not ready yet'}</strong>{!scopeGate.complete ? <ul><li>{scopeGate.reason}</li></ul> : fieldGate.blockers.length ? <ul>{fieldGate.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p>All scoped equipment records are complete, required evidence is captured, and voice duration is valid.</p>}<small>Submitting never sends anything to the customer.</small></div><button type="button" disabled={!canSubmit || execution.technicianStatus === 'submitted'} onClick={submitForOffice}>{selectedReview?.status === 'pending' ? 'Awaiting Office Review' : selectedReview?.status === 'approved' ? 'Office Approved' : 'Submit for Office Review'}</button></section>
      </> : null}
    </section>
  );
}
