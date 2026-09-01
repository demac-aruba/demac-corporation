'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from '../../lib/browser-operational';
import type { BrowserFieldExecutionRecord } from '../../lib/browser-field';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import { canonicalCrewReadinessRoster, loadCanonicalOperationsState, type CanonicalOperationsState } from '../../lib/canonical-operations';
import { deriveBrowserJobReadiness, fieldStartDecision, loadDispatchAtRiskReleases } from '../../lib/browser-job-readiness';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import { deriveDynamicVanLanes } from '../../lib/dynamic-van-lanes';
import styles from './browser-dispatch-readiness-board.module.css';

type DispatchRow = {
  order: BrowserWorkOrderRecord;
  vanId: string;
  role: 'primary' | 'support';
  readiness: ReturnType<typeof deriveBrowserJobReadiness>;
  startDecision: ReturnType<typeof fieldStartDecision>;
  execution?: BrowserFieldExecutionRecord;
};

function labelStatus(value: string) {
  return value.replaceAll('_', ' ').toUpperCase();
}

function timeLabel(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function executionStarted(row: DispatchRow) {
  return Boolean(row.execution?.startedAt) || row.execution?.technicianStatus === 'in_progress' || row.execution?.technicianStatus === 'submitted';
}

export function BrowserDispatchReadinessBoard() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [executions, setExecutions] = useState<BrowserFieldExecutionRecord[]>([]);
  const [activeDate, setActiveDate] = useState(currentArubaDateKey());
  const [refreshKey, setRefreshKey] = useState(0);
  const [canonicalOperations, setCanonicalOperations] = useState<CanonicalOperationsState | null>(null);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);

  useEffect(() => {
    setOrders(loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []));
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setExecutions(loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []));
  }, [refreshKey]);

  useEffect(() => {
    let current = true;
    setCanonicalError(null);
    void loadCanonicalOperationsState()
      .then((state) => {
        if (current) setCanonicalOperations(state);
      })
      .catch((error) => {
        if (current) {
          setCanonicalOperations(null);
          setCanonicalError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => { current = false; };
  }, [refreshKey]);

  const dates = useMemo(() => {
    const values = new Set([currentArubaDateKey(), ...orders.map((order) => order.scheduledDate), ...appointments.filter((appointment) => appointment.status === 'temporary_hold').map((appointment) => appointment.dateKey)]);
    return [...values].sort();
  }, [appointments, orders]);

  const rows = useMemo(() => {
    const releases = loadDispatchAtRiskReleases();
    const crewRoster = canonicalOperations ? canonicalCrewReadinessRoster(canonicalOperations, activeDate) : [];
    return orders
      .filter((order) => order.scheduledDate === activeDate)
      .flatMap((order): DispatchRow[] => {
        const readiness = deriveBrowserJobReadiness(order, { appointments, executions, crewRoster });
        const startDecision = fieldStartDecision(readiness, releases);
        const execution = executions.find((item) => item.workOrderId === order.id);
        return order.assignments.map((assignment) => ({ order, vanId: assignment.vanId, role: assignment.role, readiness, startDecision, execution }));
      })
      .sort((a, b) => a.order.scheduledStart.localeCompare(b.order.scheduledStart) || a.order.id.localeCompare(b.order.id));
  }, [activeDate, appointments, canonicalOperations, executions, orders, refreshKey]);
  const vanLanes = useMemo(
    () => deriveDynamicVanLanes(canonicalOperations?.vans, rows.map((row) => row.vanId)),
    [canonicalOperations, rows],
  );

  const holds = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'temporary_hold');
  const primaryRows = rows.filter((row) => row.role === 'primary');
  const preDispatchRows = primaryRows.filter((row) => !executionStarted(row));
  const inFieldRows = primaryRows.filter((row) => row.execution?.technicianStatus === 'in_progress');
  const submittedRows = primaryRows.filter((row) => row.execution?.technicianStatus === 'submitted');
  const readyCount = preDispatchRows.filter((row) => row.readiness.status === 'ready').length;
  const riskHoldCount = preDispatchRows.filter((row) => row.readiness.status === 'at_risk' && row.startDecision.mode === 'at_risk_hold').length;
  const riskReleasedCount = preDispatchRows.filter((row) => row.readiness.status === 'at_risk' && row.startDecision.mode === 'released_at_risk').length;
  const blockedCount = preDispatchRows.filter((row) => row.readiness.status === 'blocked').length;

  return (
    <section className={styles.board}>
      <header>
        <div><span>LIVE PRE-DISPATCH CONTROL</span><h2>Dispatch Readiness Board</h2><p>Scheduling owns date, time and van assignment. This board projects the current eight-dimension readiness decision before start, then preserves separate visibility for jobs already in Field.</p></div>
        <div className={styles.headerActions}><label>Dispatch date<select value={activeDate} onChange={(event) => setActiveDate(event.target.value)}>{dates.map((date) => <option value={date} key={date}>{date}</option>)}</select></label><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Readiness</button></div>
      </header>

      <div className={styles.metrics}>
        <article><span>READY</span><strong className={styles.good}>{readyCount}</strong><small>Not started · can start normally</small></article>
        <article><span>AT RISK · HOLD</span><strong className={riskHoldCount ? styles.warn : ''}>{riskHoldCount}</strong><small>Not started · no valid release</small></article>
        <article><span>AT RISK · RELEASED</span><strong className={riskReleasedCount ? styles.warn : ''}>{riskReleasedCount}</strong><small>Not started · authority available</small></article>
        <article><span>BLOCKED</span><strong className={blockedCount ? styles.danger : ''}>{blockedCount}</strong><small>Not started · no Field override</small></article>
        <article><span>IN FIELD</span><strong>{inFieldRows.length}</strong><small>Physical start already recorded</small></article>
        <article><span>SUBMITTED</span><strong>{submittedRows.length}</strong><small>Past pre-dispatch stage</small></article>
        <article><span>TEMPORARY HOLDS</span><strong>{holds.length}</strong><small>Not Work Orders yet</small></article>
      </div>

      {holds.length ? <section className={styles.holdStrip}><div><span>UNCONFIRMED CAPACITY</span><strong>{holds.length} temporary appointment hold{holds.length === 1 ? '' : 's'} on this date</strong><p>Temporary holds are visible for capacity awareness but are intentionally excluded from Work Order readiness because confirmation has not created the Work Order yet.</p></div><a href="/scheduling/">Review holds in Scheduling →</a></section> : null}
      {canonicalError ? <section className={styles.holdStrip}><div><span>CANONICAL SOURCE ERROR</span><strong>Dispatch readiness is failing closed.</strong><p>{canonicalError}. Browser workforce seeds are not used when canonical staff/Van facts are unavailable.</p></div></section> : null}

      <div className={styles.lanes} style={{ gridTemplateColumns: `repeat(${Math.max(1, vanLanes.length)}, minmax(220px, 1fr))` }}>
        {vanLanes.length ? vanLanes.map((van) => {
          const vanId = van.id;
          const laneRows = rows.filter((row) => row.vanId === vanId);
          const lanePrimary = laneRows.filter((row) => row.role === 'primary').length;
          return <section className={styles.lane} key={vanId}>
            <header><div><span>{van.name}</span><strong>{vanId} · {laneRows.length ? `${laneRows.length} assignment${laneRows.length === 1 ? '' : 's'}` : 'No assignments'}</strong></div><b>{lanePrimary} primary</b></header>
            <div className={styles.cards}>{laneRows.length ? laneRows.map((row) => {
              const riskReasons = row.readiness.risks.map((item) => item.label).join(', ');
              const blockerReasons = row.readiness.blockers.map((item) => item.label).join(', ');
              const started = executionStarted(row);
              const submitted = row.execution?.technicianStatus === 'submitted';
              const statusClass = submitted ? styles.cardSubmitted : started ? styles.cardStarted : row.readiness.status === 'ready' ? styles.cardReady : row.readiness.status === 'blocked' ? styles.cardBlocked : row.startDecision.mode === 'released_at_risk' ? styles.cardReleased : styles.cardRisk;
              return <article className={`${styles.jobCard} ${statusClass}`} key={`${row.order.id}-${row.vanId}-${row.role}`}>
                <div className={styles.cardTop}><div><span>{timeLabel(row.order.scheduledStart)}–{timeLabel(row.order.scheduledEnd)}</span><strong>{row.order.customer}</strong><small>{row.order.site} · {row.order.sector}</small></div><b>{row.role}</b></div>
                <div className={styles.scope}><span>{row.order.id}</span><strong>{row.order.customerFacingDescription}</strong><small>{row.role === 'support' ? 'Linked support assignment · customer communication remains with primary' : 'Primary assignment · customer communication owner'}</small></div>
                {!started ? <div className={styles.readiness}><div><span>PRE-DISPATCH READINESS</span><strong>{labelStatus(row.readiness.status)}</strong></div><p>{row.readiness.status === 'blocked' ? blockerReasons || row.startDecision.reason : row.readiness.status === 'at_risk' ? riskReasons || row.startDecision.reason : 'All eight readiness dimensions are resolved.'}</p></div> : <div className={styles.readiness}><div><span>CURRENT SOURCE READINESS</span><strong>{labelStatus(row.readiness.status)}</strong></div><p>Informational only after physical start; original start authority is preserved separately below.</p></div>}
                {!started && row.readiness.status === 'at_risk' ? <div className={styles.authority}><span>{row.startDecision.mode === 'released_at_risk' ? 'OPERATIONS RELEASE ACTIVE' : 'START AUTHORITY ON HOLD'}</span><strong>{row.startDecision.release ? row.startDecision.release.reason : row.startDecision.reason}</strong>{row.startDecision.release ? <small>{row.startDecision.release.id} · {row.startDecision.release.authorizedBy}</small> : null}</div> : null}
                {started ? <div className={styles.started}><span>{submitted ? 'FIELD SUBMITTED' : 'FIELD STARTED'}</span><strong>{row.execution?.startedAt ? new Date(row.execution.startedAt).toLocaleString() : 'Start recorded'}</strong><small>{row.execution?.startAuthority === 'released_at_risk' ? `Original authority: release ${row.execution.dispatchReleaseId ?? 'unknown'}` : row.execution?.startAuthority === 'ready' ? 'Original authority: READY' : 'Legacy start authority'}</small></div> : null}
                <footer><a href="/work-orders/">Readiness</a><a href="/field/">Field</a></footer>
              </article>;
            }) : <div className={styles.emptyLane}><span>AVAILABLE</span><strong>No Work Order assigned</strong><p>Scheduling remains the authority for placing work into this lane.</p></div>}</div>
          </section>;
        }) : <div className={styles.emptyLane}><span>NO VAN LANES</span><strong>No canonical or observed Van IDs</strong><p>The registry could not be loaded and this date has no assigned Work Orders.</p></div>}
      </div>

      <footer><span>READ-ONLY PROJECTION</span><strong>Pre-dispatch metrics stop counting a Work Order once physical Field start occurs. Current source facts remain visible, but the original start authority is preserved as historical execution evidence.</strong></footer>
    </section>
  );
}
