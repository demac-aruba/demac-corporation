'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserFieldExecutionRecord } from '../../lib/browser-field';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import { deriveBrowserJobReadiness, fieldStartDecision, loadDispatchAtRiskReleases } from '../../lib/browser-job-readiness';
import { loadBrowserWorkforce } from '../../lib/browser-workforce';
import { loadWorkOrderScopes } from '../../lib/browser-workorder-scope';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import { assignmentStateFor, deriveDailyClose, deriveDispatchConflicts, deriveDispatchTimingAlerts, deriveProjectedDelayByAssignment, effectiveDispatchStage, loadDispatchAssignmentStates, saveDispatchAssignmentStage, type BrowserDispatchAssignmentState, type DispatchAssignmentStage } from '../../lib/browser-dispatch-operations';
import styles from './browser-dispatch-operations.module.css';

const vanIds = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'] as const;
const preFieldStages: Array<{ value: DispatchAssignmentStage; label: string }> = [
  { value: 'not_ready', label: 'Not Ready' },
  { value: 'ready_to_depart', label: 'Ready to Depart' },
  { value: 'departed', label: 'Departed' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'on_site', label: 'On Site' },
];

function timeLabel(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function stageLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readinessClass(value: 'ready' | 'at_risk' | 'blocked') {
  return value === 'ready' ? styles.good : value === 'blocked' ? styles.danger : styles.warn;
}

export function BrowserDispatchOperations() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [executions, setExecutions] = useState<BrowserFieldExecutionRecord[]>([]);
  const [states, setStates] = useState<BrowserDispatchAssignmentState[]>([]);
  const [activeDate, setActiveDate] = useState(currentArubaDateKey());
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [clockKey, setClockKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const nextOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    setOrders(nextOrders);
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setExecutions(loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []));
    setStates(loadDispatchAssignmentStates());
    const todayOrder = nextOrders.find((order) => order.scheduledDate === currentArubaDateKey());
    setSelectedOrderId((current) => current || todayOrder?.id || nextOrders[nextOrders.length - 1]?.id || '');
  }, [refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockKey((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const dates = useMemo(() => {
    const values = new Set([currentArubaDateKey(), ...orders.map((order) => order.scheduledDate)]);
    return [...values].sort();
  }, [orders]);

  const dayOrders = useMemo(() => orders.filter((order) => order.scheduledDate === activeDate).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)), [activeDate, orders]);
  const workforce = useMemo(() => loadBrowserWorkforce(), [refreshKey]);
  const scopes = useMemo(() => loadWorkOrderScopes(), [refreshKey]);
  const releases = useMemo(() => loadDispatchAtRiskReleases(), [refreshKey]);
  const readinessByWorkOrder = useMemo(() => new Map(dayOrders.map((order) => [order.id, deriveBrowserJobReadiness(order, { appointments, executions })])), [appointments, dayOrders, executions, refreshKey]);
  const conflicts = useMemo(() => deriveDispatchConflicts(orders, activeDate, workforce), [activeDate, orders, workforce, refreshKey]);
  const delays = useMemo(() => deriveProjectedDelayByAssignment({ orders, executions, dateKey: activeDate }), [activeDate, clockKey, executions, orders]);
  const timingAlerts = useMemo(() => deriveDispatchTimingAlerts({ orders, appointments, executions, readinessByWorkOrder, dateKey: activeDate, states }), [activeDate, appointments, clockKey, executions, orders, readinessByWorkOrder, states]);
  const close = useMemo(() => deriveDailyClose({ orders, executions, dateKey: activeDate }), [activeDate, clockKey, executions, orders]);
  const selectedOrder = dayOrders.find((order) => order.id === selectedOrderId) ?? dayOrders[0];
  const selectedReadiness = selectedOrder ? readinessByWorkOrder.get(selectedOrder.id) : undefined;
  const selectedExecution = selectedOrder ? executions.find((execution) => execution.workOrderId === selectedOrder.id) : undefined;
  const selectedScope = selectedOrder ? scopes.find((scope) => scope.workOrderId === selectedOrder.id) : undefined;
  const selectedCrew = selectedOrder ? workforce.filter((employee) => employee.active && selectedOrder.assignments.some((assignment) => assignment.vanId === employee.vanId)) : [];
  const selectedDecision = selectedReadiness ? fieldStartDecision(selectedReadiness, releases) : undefined;

  const exceptionItems = useMemo(() => [
    ...conflicts.map((conflict) => ({ id: conflict.id, severity: conflict.severity, title: conflict.title, detail: conflict.detail, workOrderId: conflict.workOrderIds[0] })),
    ...timingAlerts.map((alert) => ({ id: alert.id, severity: alert.severity === 'information' ? 'warning' as const : alert.severity, title: alert.title, detail: alert.detail, workOrderId: alert.workOrderId })),
  ].sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1)), [conflicts, timingAlerts]);

  const changeStage = (order: BrowserWorkOrderRecord, vanId: string, nextStage: DispatchAssignmentStage) => {
    const readiness = readinessByWorkOrder.get(order.id);
    if (!readiness) return;
    try {
      const saved = saveDispatchAssignmentStage({ order, vanId, nextStage, readiness });
      const next = loadDispatchAssignmentStates();
      setStates(next);
      setNotice(`${order.id} · ${vanId} → ${stageLabel(saved.stage)}. Physical Field start remains a separate technician event.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to update dispatch stage.');
    }
  };

  const openException = (workOrderId?: string) => {
    if (workOrderId) setSelectedOrderId(workOrderId);
    window.setTimeout(() => document.getElementById('dispatch-briefing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  };

  return (
    <section className={styles.workspace}>
      <header>
        <div><span>AGENDA & DISPATCH · OPERATIONS V2</span><h2>Daily Dispatch Control</h2><p>Conflicts, time pressure, van departure, briefing and downstream delay impact are controlled here. Scheduling remains the owner of the appointment date/time; this layer does not silently rewrite customer bookings.</p></div>
        <div className={styles.headerActions}><label>Operational date<select value={activeDate} onChange={(event) => { setActiveDate(event.target.value); setSelectedOrderId(''); setNotice(null); }}>{dates.map((date) => <option key={date} value={date}>{date}</option>)}</select></label><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Operations</button></div>
      </header>

      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}>
        <article><span>Scheduled</span><strong>{close.scheduled}</strong><small>Primary Work Orders</small></article>
        <article><span>Conflicts</span><strong className={conflicts.some((item) => item.severity === 'critical') ? styles.danger : conflicts.length ? styles.warn : styles.good}>{conflicts.length}</strong><small>{conflicts.filter((item) => item.severity === 'critical').length} critical</small></article>
        <article><span>Time Exceptions</span><strong className={timingAlerts.length ? styles.warn : styles.good}>{timingAlerts.length}</strong><small>Real-time Aruba clock</small></article>
        <article><span>In Field</span><strong>{close.inField}</strong><small>Technician execution active</small></article>
        <article><span>Submitted</span><strong>{close.submitted}</strong><small>Passed pre-dispatch stage</small></article>
        <article><span>Carryover Required</span><strong className={close.carryoverRequired ? styles.danger : ''}>{close.carryoverRequired}</strong><small>Past-date pending Work Orders</small></article>
        <article><span>Overtime Close</span><strong className={close.overtime ? styles.warn : ''}>{close.overtime}</strong><small>Submitted after configured day end</small></article>
      </div>

      <div className={styles.topGrid}>
        <section className={styles.exceptions}>
          <div className={styles.sectionHead}><div><strong>Operations Exception Queue</strong><span>Resolve exceptions instead of scanning four calendars manually.</span></div><b>{exceptionItems.length}</b></div>
          <div className={styles.exceptionList}>{exceptionItems.length ? exceptionItems.slice(0, 12).map((item) => <button type="button" key={item.id} className={item.severity === 'critical' ? styles.exceptionCritical : styles.exceptionWarning} onClick={() => openException(item.workOrderId)}><i /><div><div><strong>{item.title}</strong><b>{item.severity}</b></div><p>{item.detail}</p></div></button>) : <div className={styles.empty}><strong>No active dispatch exceptions</strong><p>The selected day has no detected overlap, route-buffer, timing or overrun exception in browser test data.</p></div>}</div>
        </section>

        <section className={styles.delayPanel}>
          <div className={styles.sectionHead}><div><strong>Delay Propagation</strong><span>Late work can consume the buffer of following jobs.</span></div></div>
          <div className={styles.delayList}>{vanIds.map((vanId) => {
            const lane = dayOrders.flatMap((order) => order.assignments.filter((assignment) => assignment.vanId === vanId).map(() => ({ order, delay: delays.get(`${order.id}:${vanId}`) ?? 0 }))).filter((row) => row.delay > 0);
            const worst = lane.reduce((max, row) => Math.max(max, row.delay), 0);
            return <article key={vanId}><div><span>{vanId}</span><strong>{worst ? `${worst} min projected` : 'On schedule'}</strong></div><small>{lane.length ? `${lane.length} assignment(s) affected downstream` : 'No propagated delay detected'}</small><i><em style={{ width: `${Math.min(100, worst * 2)}%` }} /></i></article>;
          })}</div>
          <div className={styles.communicationGuard}><span>CUSTOMER COMMUNICATION</span><strong>Delay detection never auto-messages the customer.</strong><p>Operations receives the exception first and retains explicit control over any WhatsApp/email update.</p></div>
        </section>
      </div>

      <section className={styles.vans}>
        <div className={styles.sectionHead}><div><strong>Four-Van Departure Control</strong><span>Each linked assignment has its own physical movement status; the customer appointment remains singular.</span></div></div>
        <div className={styles.vanGrid}>{vanIds.map((vanId) => {
          const laneOrders = dayOrders.filter((order) => order.assignments.some((assignment) => assignment.vanId === vanId));
          return <article className={styles.vanCard} key={vanId}><header><div><span>{vanId}</span><strong>{laneOrders.length} assignment{laneOrders.length === 1 ? '' : 's'}</strong></div><b>{workforce.filter((employee) => employee.active && employee.vanId === vanId).map((employee) => employee.name).join(' · ') || 'Crew not resolved'}</b></header><div>{laneOrders.length ? laneOrders.map((order) => {
            const readiness = readinessByWorkOrder.get(order.id)!;
            const execution = executions.find((item) => item.workOrderId === order.id);
            const stage = effectiveDispatchStage(order, vanId, execution, states);
            const assignment = order.assignments.find((item) => item.vanId === vanId)!;
            const delay = delays.get(`${order.id}:${vanId}`) ?? 0;
            return <button type="button" className={styles.vanJob} key={`${order.id}-${vanId}`} onClick={() => { setSelectedOrderId(order.id); openException(order.id); }}><div><span>{timeLabel(order.scheduledStart)}–{timeLabel(order.scheduledEnd)} · {assignment.role}</span><strong>{order.customer}</strong><small>{order.site} · {order.sector}</small></div><div><b className={readinessClass(readiness.status)}>{stageLabel(stage)}</b>{delay ? <em>{delay}m delay</em> : null}</div></button>;
          }) : <div className={styles.emptyVan}><strong>Available</strong><span>No assigned Work Order</span></div>}</div></article>;
        })}</div>
      </section>

      {selectedOrder && selectedReadiness ? <section className={styles.briefing} id="dispatch-briefing">
        <div className={styles.briefingHead}><div><span>PRE-DEPARTURE / VAN BRIEFING</span><h3>{selectedOrder.id} · {selectedOrder.customer}</h3><p>{selectedOrder.site} · {selectedOrder.sector} · {timeLabel(selectedOrder.scheduledStart)}–{timeLabel(selectedOrder.scheduledEnd)}</p></div><div><b className={readinessClass(selectedReadiness.status)}>{selectedReadiness.status.replace('_', ' ').toUpperCase()}</b><small>{selectedDecision?.mode === 'released_at_risk' ? `Released by ${selectedDecision.release?.authorizedBy}` : selectedDecision?.reason}</small></div></div>

        <div className={styles.briefingGrid}>
          <section><span>CUSTOMER / WORK</span><strong>{selectedOrder.customerFacingDescription}</strong><p>{selectedOrder.technicianInstructions || 'No technician-only instructions recorded.'}</p></section>
          <section><span>EXACT HVAC SCOPE</span><strong>{selectedScope?.items.length ?? 0} / {selectedOrder.totalQuantity} units</strong><p>{selectedScope?.items.length ? selectedScope.items.map((item) => `${item.name}${item.capacity ? ` (${item.capacity})` : ''}`).join(' · ') : 'Exact equipment scope is not resolved.'}</p></section>
          <section><span>CREW</span><strong>{selectedCrew.length ? selectedCrew.map((employee) => employee.name).join(' · ') : 'No active crew resolved'}</strong><p>{selectedCrew.length ? selectedCrew.map((employee) => `${employee.vanId}: ${employee.skillsVerified ? 'skills verified' : 'skills not verified'}`).join(' · ') : 'Open Employees & Capacity.'}</p></section>
          {selectedReadiness.dimensions.slice(3).map((dimension) => <section key={dimension.id}><span>{dimension.label.toUpperCase()}</span><strong className={readinessClass(dimension.status)}>{dimension.status.replace('_', ' ').toUpperCase()}</strong><p>{dimension.reason}</p></section>)}
        </div>

        <div className={styles.assignmentControls}>{selectedOrder.assignments.map((assignment) => {
          const currentStage = effectiveDispatchStage(selectedOrder, assignment.vanId, selectedExecution, states);
          const saved = assignmentStateFor(selectedOrder.id, assignment.vanId, states);
          return <article key={`${selectedOrder.id}-${assignment.vanId}`}><header><div><span>{assignment.vanId} · {assignment.role.toUpperCase()}</span><strong>{stageLabel(currentStage)}</strong></div><small>{assignment.customerCommunicationOwner ? 'Customer communication owner' : 'Linked support · no duplicate customer messages'}</small></header>{currentStage === 'in_field' || currentStage === 'submitted' ? <div className={styles.fieldOwned}><strong>{currentStage === 'submitted' ? 'Field submitted' : 'Field execution has started'}</strong><p>Dispatch no longer controls physical start. Original start authority stays in Field evidence.</p></div> : <div className={styles.stageButtons}>{preFieldStages.map((stage) => <button type="button" key={stage.value} className={currentStage === stage.value ? styles.stageActive : ''} onClick={() => changeStage(selectedOrder, assignment.vanId, stage.value)}>{stage.label}</button>)}</div>}{saved ? <footer>{saved.updatedBy} · {new Date(saved.updatedAt).toLocaleString()}</footer> : null}</article>;
        })}</div>
      </section> : <section className={styles.noBriefing}><strong>No Work Order on this date</strong><p>Create/confirm an appointment before a departure briefing can exist.</p></section>}

      <section className={styles.closePanel}>
        <div className={styles.sectionHead}><div><strong>Daily Close</strong><span>Operational close-out for the selected date.</span></div></div>
        <div className={styles.closeGrid}><article><span>Scheduled</span><strong>{close.scheduled}</strong><small>Primary Work Orders</small></article><article><span>Completed / Submitted</span><strong>{close.submitted}</strong><small>Field reports reached Office Review</small></article><article><span>Still In Field</span><strong>{close.inField}</strong><small>Execution remains open</small></article><article><span>Pending / Not Started</span><strong className={close.pending ? styles.warn : ''}>{close.pending}</strong><small>{close.carryoverRequired ? `${close.carryoverRequired} require next-day action` : 'No past-date carryover'}</small></article><article><span>Overtime Completions</span><strong>{close.overtime}</strong><small>Submitted after configured workday end</small></article></div>
        <footer><span>CLOSE-OUT GUARDRAIL</span><strong>Daily Close reports what happened; it does not automatically reschedule pending work or alter payroll/overtime. Those remain explicit operational/payroll actions.</strong></footer>
      </section>
    </section>
  );
}
