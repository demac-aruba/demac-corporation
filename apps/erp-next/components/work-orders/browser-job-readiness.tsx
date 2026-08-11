'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from '../../lib/browser-operational';
import type { BrowserFieldExecutionRecord } from '../../lib/browser-field';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import { createDispatchAtRiskRelease, defaultJobReadinessChecks, deriveBrowserJobReadiness, loadDispatchAtRiskReleases, loadJobReadinessChecks, saveJobReadinessChecks, validDispatchAtRiskRelease, type BrowserDispatchAtRiskRelease, type BrowserJobReadinessChecks, type ManualReadinessState } from '../../lib/browser-job-readiness';
import styles from './browser-job-readiness.module.css';

const commonOptions: Array<{ value: ManualReadinessState; label: string }> = [
  { value: 'not_checked', label: 'Not checked' },
  { value: 'ready', label: 'Ready / confirmed' },
  { value: 'not_required', label: 'Not required' },
  { value: 'blocked', label: 'Blocked' },
];

function sameChecks(a?: BrowserJobReadinessChecks, b?: BrowserJobReadinessChecks | null) {
  if (!a || !b) return false;
  return a.tools === b.tools && a.siteAccess === b.siteAccess && a.commercialClearance === b.commercialClearance;
}

export function BrowserJobReadiness() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [executions, setExecutions] = useState<BrowserFieldExecutionRecord[]>([]);
  const [checks, setChecks] = useState<BrowserJobReadinessChecks[]>([]);
  const [releases, setReleases] = useState<BrowserDispatchAtRiskRelease[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<BrowserJobReadinessChecks | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    setOrders(storedOrders);
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setExecutions(loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []));
    setChecks(loadJobReadinessChecks());
    setReleases(loadDispatchAtRiskReleases());
    setSelectedId(storedOrders[storedOrders.length - 1]?.id ?? '');
  }, [refreshKey]);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedExecution = executions.find((execution) => execution.workOrderId === selectedOrder?.id);

  useEffect(() => {
    if (!selectedOrder) return;
    setDraft(checks.find((item) => item.workOrderId === selectedOrder.id) ?? defaultJobReadinessChecks(selectedOrder.id));
    setReleaseReason('');
    setNotice(null);
  }, [selectedOrder?.id, checks]);

  const effectiveChecks = useMemo(() => {
    if (!draft) return checks;
    return checks.some((item) => item.workOrderId === draft.workOrderId)
      ? checks.map((item) => item.workOrderId === draft.workOrderId ? draft : item)
      : [...checks, draft];
  }, [checks, draft]);

  const readiness = selectedOrder ? deriveBrowserJobReadiness(selectedOrder, { checks: effectiveChecks, appointments, executions }) : null;
  const crewDimension = readiness?.dimensions.find((dimension) => dimension.id === 'crew_skill');
  const locked = selectedExecution?.technicianStatus === 'submitted';
  const persistedCheck = selectedOrder ? checks.find((item) => item.workOrderId === selectedOrder.id) : undefined;
  const checksDirty = !sameChecks(persistedCheck, draft);
  const validRelease = readiness ? validDispatchAtRiskRelease(readiness, releases) : undefined;

  const summary = useMemo(() => {
    const states = orders.map((order) => deriveBrowserJobReadiness(order, { checks, appointments, executions }));
    return {
      ready: states.filter((item) => item.status === 'ready').length,
      atRisk: states.filter((item) => item.status === 'at_risk').length,
      blocked: states.filter((item) => item.status === 'blocked').length,
      totalRisks: states.reduce((sum, item) => sum + item.risks.length, 0),
    };
  }, [appointments, checks, executions, orders, refreshKey]);

  const update = <K extends keyof Pick<BrowserJobReadinessChecks, 'tools' | 'siteAccess' | 'commercialClearance'>>(key: K, value: BrowserJobReadinessChecks[K]) => {
    setDraft((current) => current ? { ...current, [key]: value, updatedBy: 'Operations / Preview' } : current);
  };

  const save = () => {
    if (!draft || locked) return;
    const saved = saveJobReadinessChecks({ ...draft, updatedBy: 'Operations / Preview' });
    setChecks((current) => current.some((item) => item.workOrderId === saved.workOrderId) ? current.map((item) => item.workOrderId === saved.workOrderId ? saved : item) : [...current, saved]);
    setDraft(saved);
    setReleases(loadDispatchAtRiskReleases());
    setNotice(`${saved.workOrderId} readiness checks saved. Crew & Required Skill continues to come from the Workforce Registry; any previous AT RISK release remains valid only if the exact risk signature still matches.`);
  };

  const authorizeAtRisk = () => {
    if (!readiness || readiness.status !== 'at_risk' || checksDirty || locked) return;
    try {
      const release = createDispatchAtRiskRelease(readiness, releaseReason, 'Operations / Preview');
      setReleases(loadDispatchAtRiskReleases());
      setReleaseReason('');
      setNotice(`${release.id} authorized AT RISK start for the current risk signature. Field can start this Work Order unless the readiness risks change.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to authorize AT RISK dispatch release.');
    }
  };

  if (!orders.length || !selectedOrder || !draft || !readiness) return null;

  return (
    <section className={styles.workspace}>
      <header><div><span>PRE-DISPATCH DECISION</span><h2>Consolidated Job Readiness</h2><p>Customer confirmation, assignment, exact HVAC scope, materials and crew skill are derived from their owning modules. Remaining office checks are explicit until their dedicated subsystems become authoritative.</p></div><div className={styles.headerActions}><label>Work Order<select value={selectedOrder.id} onChange={(event) => setSelectedId(event.target.value)}>{orders.slice().reverse().map((order) => <option key={order.id} value={order.id}>{order.id} · {order.customer}</option>)}</select></label><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Facts</button></div></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}><article><span>READY</span><strong className={styles.goodText}>{summary.ready}</strong><small>All readiness dimensions resolved</small></article><article><span>AT RISK</span><strong className={summary.atRisk ? styles.warnText : ''}>{summary.atRisk}</strong><small>Pending checks or unverified dependencies</small></article><article><span>BLOCKED</span><strong className={summary.blocked ? styles.dangerText : ''}>{summary.blocked}</strong><small>Hard operational blocker exists</small></article><article><span>Open Risk Dimensions</span><strong>{summary.totalRisks}</strong><small>Across browser Work Orders</small></article></div>

      <section className={styles.hero}><div><span>{selectedOrder.id}</span><h3>{selectedOrder.customer} · {selectedOrder.site}</h3><p>{selectedOrder.customerFacingDescription} · {selectedOrder.scheduledDate} {selectedOrder.scheduledStart}–{selectedOrder.scheduledEnd}</p></div><div className={`${styles.overall} ${readiness.status === 'ready' ? styles.ready : readiness.status === 'blocked' ? styles.blocked : styles.risk}`}><span>OVERALL JOB READINESS</span><strong>{readiness.status.replace('_', ' ').toUpperCase()}</strong><small>{readiness.blockers.length} blocker(s) · {readiness.risks.length} risk(s)</small></div></section>

      {locked ? <div className={styles.locked}><span>HISTORICAL READINESS LOCK</span><strong>Field report has already been submitted.</strong><p>The preview does not allow pre-dispatch checks or releases to be silently rewritten after field submission.</p></div> : null}

      <div className={styles.layout}>
        <main>
          <div className={styles.sectionHead}><div><strong>Readiness Dimensions</strong><span>Source facts and explicit checks behind the overall decision</span></div><b>{readiness.dimensions.length}</b></div>
          <div className={styles.dimensionGrid}>{readiness.dimensions.map((dimension) => <article key={dimension.id} className={dimension.status === 'ready' ? styles.dimensionReady : dimension.status === 'blocked' ? styles.dimensionBlocked : styles.dimensionRisk}><header><div><span>{dimension.id.replaceAll('_', ' ').toUpperCase()}</span><strong>{dimension.label}</strong></div><b>{dimension.status.replace('_', ' ')}</b></header><p>{dimension.reason}</p><small>Evidence: {dimension.source}</small></article>)}</div>
        </main>

        <aside>
          <div className={styles.sectionHead}><div><strong>Readiness Controls</strong><span>Derived workforce evidence plus remaining explicit office checks</span></div></div>
          <div className={styles.checkForm}>
            <div className={`${styles.derivedCheck} ${crewDimension?.status === 'ready' ? styles.derivedReady : crewDimension?.status === 'blocked' ? styles.derivedBlocked : styles.derivedRisk}`}><span>Crew & required skill · derived</span><strong>{crewDimension?.status.replace('_', ' ').toUpperCase()}</strong><p>{crewDimension?.reason}</p><small>Source: {crewDimension?.source}</small><a href="/employees/">Open Workforce Registry →</a></div>
            <label><span>Required tools</span><select disabled={locked} value={draft.tools} onChange={(event) => update('tools', event.target.value as ManualReadinessState)}>{commonOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label><span>Site access</span><select disabled={locked} value={draft.siteAccess} onChange={(event) => update('siteAccess', event.target.value as ManualReadinessState)}>{commonOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label><span>Commercial clearance</span><select disabled={locked} value={draft.commercialClearance} onChange={(event) => update('commercialClearance', event.target.value as ManualReadinessState)}>{commonOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><small>Use Not required when the job legitimately needs no deposit/PO/financial clearance.</small></label>
          </div>
          <div className={styles.checkFooter}><span>Last manual check evidence</span><strong>{draft.updatedBy}</strong><small>{draft.updatedAt.startsWith('1970-') ? 'Never saved' : new Date(draft.updatedAt).toLocaleString()}</small><button type="button" disabled={locked || !checksDirty} onClick={save}>{checksDirty ? 'Save Manual Checks' : 'Manual Checks Saved'}</button></div>

          {readiness.status === 'at_risk' ? <section className={styles.releaseBox}><span>AT RISK FIELD RELEASE</span>{validRelease ? <><strong>Released by {validRelease.authorizedBy}</strong><p>{validRelease.reason}</p><small>{new Date(validRelease.authorizedAt).toLocaleString()} · valid only for current risk signature</small></> : <><strong>Field start is on hold.</strong><p>Operations may authorize start only after reviewing the current risks. A changed workforce, material or other risk signature invalidates the release automatically.</p><textarea rows={3} disabled={locked || checksDirty} value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder={checksDirty ? 'Save manual readiness checks before release...' : 'Why is it operationally acceptable to start AT RISK?'} /><button type="button" disabled={locked || checksDirty || releaseReason.trim().length < 8} onClick={authorizeAtRisk}>Authorize AT RISK Start</button></>}</section> : readiness.status === 'blocked' ? <section className={`${styles.releaseBox} ${styles.releaseBlocked}`}><span>HARD BLOCK</span><strong>No Field release is available.</strong><p>Resolve the blocking readiness dimension in its owning workflow.</p></section> : <section className={`${styles.releaseBox} ${styles.releaseReady}`}><span>DISPATCH RELEASE</span><strong>No override required.</strong><p>All readiness dimensions are READY; Field may start normally.</p></section>}
        </aside>
      </div>

      <footer><div><span>DECISION RULE</span><strong>BLOCKED cannot be released. AT RISK requires a risk-signature-bound Operations release. READY starts normally.</strong></div><p>Crew capability is now derived from verified Workforce Registry evidence rather than a manual Work Order toggle.</p></footer>
    </section>
  );
}
