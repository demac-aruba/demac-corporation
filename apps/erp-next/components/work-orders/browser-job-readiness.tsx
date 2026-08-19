'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from '../../lib/browser-operational';
import type { BrowserFieldExecutionRecord } from '../../lib/browser-field';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import { canonicalCrewReadinessRoster, loadCanonicalOperationsState, type CanonicalOperationsState } from '../../lib/canonical-operations';
import { createDispatchAtRiskRelease, deriveBrowserJobReadiness, loadDispatchAtRiskReleases, validDispatchAtRiskRelease, type BrowserDispatchAtRiskRelease } from '../../lib/browser-job-readiness';
import styles from './browser-job-readiness.module.css';

function derivedClass(status?: string) {
  if (status === 'ready') return styles.derivedReady;
  if (status === 'blocked') return styles.derivedBlocked;
  return styles.derivedRisk;
}

export function BrowserJobReadiness() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [executions, setExecutions] = useState<BrowserFieldExecutionRecord[]>([]);
  const [releases, setReleases] = useState<BrowserDispatchAtRiskRelease[]>([]);
  const [canonicalOperations, setCanonicalOperations] = useState<CanonicalOperationsState | null>(null);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);
  const [canonicalLoading, setCanonicalLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    setOrders(storedOrders);
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setExecutions(loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []));
    setReleases(loadDispatchAtRiskReleases());
    setSelectedId((current) => current && storedOrders.some((order) => order.id === current) ? current : storedOrders[storedOrders.length - 1]?.id ?? '');
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setCanonicalLoading(true);
    setCanonicalError(null);
    void loadCanonicalOperationsState()
      .then((state) => { if (!cancelled) setCanonicalOperations(state); })
      .catch((error) => { if (!cancelled) { setCanonicalOperations(null); setCanonicalError(error instanceof Error ? error.message : String(error)); } })
      .finally(() => { if (!cancelled) setCanonicalLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const readinessFor = (order: BrowserWorkOrderRecord) => {
    if (!canonicalOperations) return null;
    const crewRoster = canonicalCrewReadinessRoster(canonicalOperations, order.scheduledDate);
    return deriveBrowserJobReadiness(order, { appointments, executions, crewRoster });
  };

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedExecution = executions.find((execution) => execution.workOrderId === selectedOrder?.id);
  const readiness = selectedOrder ? readinessFor(selectedOrder) : null;
  const locked = selectedExecution?.technicianStatus === 'submitted';
  const validRelease = readiness ? validDispatchAtRiskRelease(readiness, releases) : undefined;

  useEffect(() => {
    setReleaseReason('');
    setNotice(null);
  }, [selectedOrder?.id]);

  const summary = useMemo(() => {
    if (!canonicalOperations) return { ready: 0, atRisk: 0, blocked: 0, totalRisks: 0 };
    const states = orders.map((order) => {
      const crewRoster = canonicalCrewReadinessRoster(canonicalOperations, order.scheduledDate);
      return deriveBrowserJobReadiness(order, { appointments, executions, crewRoster });
    });
    return {
      ready: states.filter((item) => item.status === 'ready').length,
      atRisk: states.filter((item) => item.status === 'at_risk').length,
      blocked: states.filter((item) => item.status === 'blocked').length,
      totalRisks: states.reduce((sum, item) => sum + item.risks.length, 0),
    };
  }, [appointments, canonicalOperations, executions, orders, refreshKey]);

  const authorizeAtRisk = () => {
    if (!readiness || readiness.status !== 'at_risk' || locked) return;
    try {
      const release = createDispatchAtRiskRelease(readiness, releaseReason, 'Operations / Preview');
      setReleases(loadDispatchAtRiskReleases());
      setReleaseReason('');
      setNotice(`${release.id} authorized AT RISK start for the current risk signature. Field can start unless any source-owned readiness fact changes.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to authorize AT RISK dispatch release.');
    }
  };

  if (!orders.length || !selectedOrder) return null;

  if (canonicalLoading && !canonicalOperations) {
    return <section className={styles.workspace}><header><div><span>PRE-DISPATCH DECISION</span><h2>Consolidated Job Readiness</h2><p>Loading canonical Firestore crew and availability before calculating dispatch readiness…</p></div></header></section>;
  }

  if (canonicalError || !readiness) {
    return <section className={styles.workspace}><header><div><span>PRE-DISPATCH DECISION · SOURCE ERROR</span><h2>Consolidated Job Readiness</h2><p>Job readiness is not calculated with a browser workforce fallback when canonical staff data is unavailable.</p></div><div className={styles.headerActions}><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Retry Canonical Facts</button></div></header><div className={styles.notice}><span>{canonicalError || 'Canonical workforce data is unavailable.'}</span></div></section>;
  }

  const crewDimension = readiness.dimensions.find((dimension) => dimension.id === 'crew_skill');
  const toolsDimension = readiness.dimensions.find((dimension) => dimension.id === 'tools');
  const siteAccessDimension = readiness.dimensions.find((dimension) => dimension.id === 'site_access');
  const commercialDimension = readiness.dimensions.find((dimension) => dimension.id === 'commercial');

  return (
    <section className={styles.workspace}>
      <header><div><span>PRE-DISPATCH DECISION · CANONICAL CREW</span><h2>Consolidated Job Readiness</h2><p>All eight readiness dimensions are calculated from their owning operational modules. Crew & Required Skill now resolves the work-date crew from Firestore staffProfiles, vans, dailyVanAssignments and staffAbsences.</p></div><div className={styles.headerActions}><label>Work Order<select value={selectedOrder.id} onChange={(event) => setSelectedId(event.target.value)}>{orders.slice().reverse().map((order) => <option key={order.id} value={order.id}>{order.id} · {order.customer}</option>)}</select></label><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Facts</button></div></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}><article><span>READY</span><strong className={styles.goodText}>{summary.ready}</strong><small>All source-owned dimensions resolved</small></article><article><span>AT RISK</span><strong className={summary.atRisk ? styles.warnText : ''}>{summary.atRisk}</strong><small>Unverified or pending source evidence</small></article><article><span>BLOCKED</span><strong className={summary.blocked ? styles.dangerText : ''}>{summary.blocked}</strong><small>Hard operational blocker exists</small></article><article><span>Open Risk Dimensions</span><strong>{summary.totalRisks}</strong><small>Across current Work Orders</small></article></div>

      <section className={styles.hero}><div><span>{selectedOrder.id}</span><h3>{selectedOrder.customer} · {selectedOrder.site}</h3><p>{selectedOrder.customerFacingDescription} · {selectedOrder.scheduledDate} {selectedOrder.scheduledStart}–{selectedOrder.scheduledEnd}</p></div><div className={`${styles.overall} ${readiness.status === 'ready' ? styles.ready : readiness.status === 'blocked' ? styles.blocked : styles.risk}`}><span>OVERALL JOB READINESS</span><strong>{readiness.status.replace('_', ' ').toUpperCase()}</strong><small>{readiness.blockers.length} blocker(s) · {readiness.risks.length} risk(s)</small></div></section>

      {locked ? <div className={styles.locked}><span>HISTORICAL READINESS CONTEXT</span><strong>Field report has already been submitted.</strong><p>Current source facts may continue evolving, but the original Field start authority remains preserved separately in execution/audit evidence.</p></div> : null}

      <div className={styles.layout}>
        <main>
          <div className={styles.sectionHead}><div><strong>Eight Readiness Dimensions</strong><span>Evidence and reasons behind the overall decision</span></div><b>{readiness.dimensions.length}</b></div>
          <div className={styles.dimensionGrid}>{readiness.dimensions.map((dimension) => <article key={dimension.id} className={dimension.status === 'ready' ? styles.dimensionReady : dimension.status === 'blocked' ? styles.dimensionBlocked : styles.dimensionRisk}><header><div><span>{dimension.id.replaceAll('_', ' ').toUpperCase()}</span><strong>{dimension.label}</strong></div><b>{dimension.status.replace('_', ' ')}</b></header><p>{dimension.reason}</p><small>Evidence: {dimension.source}</small></article>)}</div>
        </main>

        <aside>
          <div className={styles.sectionHead}><div><strong>Source-Owned Controls</strong><span>Fix the fact in its owning module; do not override it here</span></div></div>
          <div className={styles.checkForm}>
            <div className={`${styles.derivedCheck} ${derivedClass(crewDimension?.status)}`}><span>Crew & required skill</span><strong>{crewDimension?.status.replace('_', ' ').toUpperCase()}</strong><p>{crewDimension?.reason}</p><small>Source: {crewDimension?.source}</small><a href="/employees/">Open Workforce Registry →</a></div>
            <div className={`${styles.derivedCheck} ${derivedClass(toolsDimension?.status)}`}><span>Required tools</span><strong>{toolsDimension?.status.replace('_', ' ').toUpperCase()}</strong><p>{toolsDimension?.reason}</p><small>Source: {toolsDimension?.source}</small><a href="/inventory/">Open Tool Registry & Policy →</a></div>
            <div className={`${styles.derivedCheck} ${derivedClass(siteAccessDimension?.status)}`}><span>Site access</span><strong>{siteAccessDimension?.status.replace('_', ' ').toUpperCase()}</strong><p>{siteAccessDimension?.reason}</p><small>Source: {siteAccessDimension?.source}</small><a href="/work-orders/">Open Access Plan above →</a></div>
            <div className={`${styles.derivedCheck} ${derivedClass(commercialDimension?.status)}`}><span>Commercial clearance</span><strong>{commercialDimension?.status.replace('_', ' ').toUpperCase()}</strong><p>{commercialDimension?.reason}</p><small>Source: {commercialDimension?.source}</small><a href="/work-orders/">Open Terms & Clearance above →</a></div>
          </div>

          {readiness.status === 'at_risk' ? <section className={styles.releaseBox}><span>AT RISK FIELD RELEASE</span>{validRelease ? <><strong>Released by {validRelease.authorizedBy}</strong><p>{validRelease.reason}</p><small>{new Date(validRelease.authorizedAt).toLocaleString()} · valid only for current risk signature</small></> : <><strong>Field start is on hold.</strong><p>Operations may authorize start only after reviewing the current unresolved risks. Any changed source fact changes the risk signature and invalidates this authority for future start.</p><textarea rows={3} disabled={locked} value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder="Why is it operationally acceptable to start with these exact unresolved risks?" /><button type="button" disabled={locked || releaseReason.trim().length < 8} onClick={authorizeAtRisk}>Authorize AT RISK Start</button></>}</section> : readiness.status === 'blocked' ? <section className={`${styles.releaseBox} ${styles.releaseBlocked}`}><span>HARD BLOCK</span><strong>No Field release is available.</strong><p>Resolve the blocking fact in its owning workflow.</p></section> : <section className={`${styles.releaseBox} ${styles.releaseReady}`}><span>DISPATCH RELEASE</span><strong>No override required.</strong><p>All eight source-owned readiness dimensions are READY; Field may start normally.</p></section>}
        </aside>
      </div>

      <footer><div><span>AUTHORITY MODEL</span><strong>Readiness facts are source-owned. Job Readiness calculates. Operations may release AT RISK. Field records actual start authority.</strong></div><p>Canonical crew facts do not fall back to stale browser workforce data.</p></footer>
    </section>
  );
}
