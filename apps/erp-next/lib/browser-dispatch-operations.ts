import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import type { BrowserFieldExecutionRecord } from './browser-field';
import type { BrowserJobReadiness } from './browser-job-readiness';
import { fieldStartDecision, loadDispatchAtRiskReleases } from './browser-job-readiness';
import { loadBrowserBusinessSettings } from './browser-scheduling-settings';
import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';
import { loadBrowserWorkforce, type BrowserWorkforceEmployee } from './browser-workforce';
import { sectorsCompatible, timeToMinutes } from './scheduling';

export type DispatchAssignmentStage = 'not_ready' | 'ready_to_depart' | 'departed' | 'in_transit' | 'on_site';

export type BrowserDispatchAssignmentState = {
  id: string;
  workOrderId: string;
  vanId: string;
  stage: DispatchAssignmentStage;
  updatedAt: string;
  updatedBy: string;
  note?: string;
};

export type DispatchConflict = {
  id: string;
  severity: 'critical' | 'warning';
  type: 'van_overlap' | 'route_buffer' | 'route_sector' | 'workday_overrun' | 'workforce_registry';
  title: string;
  detail: string;
  workOrderIds: string[];
  vanIds: string[];
};

export type DispatchTimingAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'information';
  title: string;
  detail: string;
  workOrderId: string;
  vanId: string;
  minutesToStart?: number;
  projectedDelayMinutes?: number;
};

export type DispatchStageDecision = {
  allowed: boolean;
  reason: string;
};

type AssignmentRow = {
  order: BrowserWorkOrderRecord;
  vanId: string;
  role: 'primary' | 'support';
};

function assignmentId(workOrderId: string, vanId: string) {
  return `${workOrderId}:${vanId}`;
}

export function loadDispatchAssignmentStates() {
  return loadBrowserValue<BrowserDispatchAssignmentState[]>(browserKeys.dispatchAssignments, []);
}

export function assignmentStateFor(workOrderId: string, vanId: string, states = loadDispatchAssignmentStates()) {
  return states.find((state) => state.workOrderId === workOrderId && state.vanId === vanId);
}

export function effectiveDispatchStage(order: BrowserWorkOrderRecord, vanId: string, execution?: BrowserFieldExecutionRecord, states = loadDispatchAssignmentStates()) {
  if (execution?.technicianStatus === 'submitted') return 'submitted' as const;
  if (execution?.startedAt || execution?.technicianStatus === 'in_progress') return 'in_field' as const;
  return assignmentStateFor(order.id, vanId, states)?.stage ?? 'not_ready';
}

export function dispatchStageDecision(args: {
  currentStage: DispatchAssignmentStage;
  nextStage: DispatchAssignmentStage;
  readiness: BrowserJobReadiness;
}) : DispatchStageDecision {
  const { currentStage, nextStage, readiness } = args;
  const start = fieldStartDecision(readiness, loadDispatchAtRiskReleases());

  if (currentStage === nextStage) return { allowed: true, reason: 'No status change.' };
  if (nextStage === 'not_ready' && currentStage === 'ready_to_depart') return { allowed: true, reason: 'Pre-departure readiness can be reset before physical departure.' };
  if (nextStage === 'ready_to_depart') {
    if (currentStage !== 'not_ready') return { allowed: false, reason: 'Ready to Depart must begin from Not Ready.' };
    if (!start.allowed) return { allowed: false, reason: start.reason };
    return { allowed: true, reason: start.mode === 'released_at_risk' ? 'Operations release allows pre-departure preparation.' : 'All readiness dimensions permit departure preparation.' };
  }
  if (nextStage === 'departed') {
    if (currentStage !== 'ready_to_depart') return { allowed: false, reason: 'Mark Ready to Depart before physical departure.' };
    if (!start.allowed) return { allowed: false, reason: 'Readiness changed after pre-departure preparation. Re-resolve the blocker/risk before departure.' };
    return { allowed: true, reason: 'Physical departure may be recorded.' };
  }
  if (nextStage === 'in_transit') return currentStage === 'departed'
    ? { allowed: true, reason: 'Assignment is physically in transit.' }
    : { allowed: false, reason: 'Departed must be recorded before In Transit.' };
  if (nextStage === 'on_site') return currentStage === 'in_transit' || currentStage === 'departed'
    ? { allowed: true, reason: 'Arrival at the customer site may be recorded.' }
    : { allowed: false, reason: 'The assignment must leave the office/previous site before On Site.' };
  return { allowed: false, reason: 'Unsupported dispatch transition.' };
}

export function saveDispatchAssignmentStage(args: {
  order: BrowserWorkOrderRecord;
  vanId: string;
  nextStage: DispatchAssignmentStage;
  readiness: BrowserJobReadiness;
  updatedBy?: string;
  note?: string;
}) {
  const states = loadDispatchAssignmentStates();
  const current = assignmentStateFor(args.order.id, args.vanId, states);
  const currentStage = current?.stage ?? 'not_ready';
  const decision = dispatchStageDecision({ currentStage, nextStage: args.nextStage, readiness: args.readiness });
  if (!decision.allowed) throw new Error(decision.reason);
  const record: BrowserDispatchAssignmentState = {
    id: assignmentId(args.order.id, args.vanId),
    workOrderId: args.order.id,
    vanId: args.vanId,
    stage: args.nextStage,
    updatedAt: new Date().toISOString(),
    updatedBy: args.updatedBy ?? 'Operations / Preview',
    note: args.note?.trim() || undefined,
  };
  const next = states.some((state) => state.id === record.id)
    ? states.map((state) => state.id === record.id ? record : state)
    : [record, ...states];
  saveBrowserValue(browserKeys.dispatchAssignments, next);
  return record;
}

function rowsForDate(orders: BrowserWorkOrderRecord[], dateKey: string): AssignmentRow[] {
  return orders
    .filter((order) => order.scheduledDate === dateKey)
    .flatMap((order) => order.assignments.map((assignment) => ({ order, vanId: assignment.vanId, role: assignment.role })));
}

function intervalOverlaps(a: BrowserWorkOrderRecord, b: BrowserWorkOrderRecord) {
  return timeToMinutes(a.scheduledStart) < timeToMinutes(b.scheduledEnd) && timeToMinutes(a.scheduledEnd) > timeToMinutes(b.scheduledStart);
}

export function deriveDispatchConflicts(orders: BrowserWorkOrderRecord[], dateKey: string, roster: BrowserWorkforceEmployee[] = loadBrowserWorkforce()) {
  const conflicts: DispatchConflict[] = [];
  const rows = rowsForDate(orders, dateKey);
  const settings = loadBrowserBusinessSettings();

  const byVan = new Map<string, AssignmentRow[]>();
  for (const row of rows) byVan.set(row.vanId, [...(byVan.get(row.vanId) ?? []), row]);

  for (const [vanId, lane] of byVan) {
    const sorted = lane.slice().sort((a, b) => a.order.scheduledStart.localeCompare(b.order.scheduledStart));
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      const end = timeToMinutes(current.order.scheduledEnd);
      const afterHours = timeToMinutes(settings.afterHours);
      if (end > afterHours) {
        conflicts.push({ id: `CONFLICT-${vanId}-${current.order.id}-afterhours`, severity: 'warning', type: 'workday_overrun', title: `${vanId} scheduled beyond configured workday`, detail: `${current.order.id} ends at ${current.order.scheduledEnd}, later than ${settings.afterHours}.`, workOrderIds: [current.order.id], vanIds: [vanId] });
      }
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j];
        if (intervalOverlaps(current.order, next.order)) {
          const supportContext = current.role === 'support' || next.role === 'support' ? ' A linked support assignment is part of this conflict.' : '';
          conflicts.push({ id: `CONFLICT-${vanId}-${current.order.id}-${next.order.id}-overlap`, severity: 'critical', type: 'van_overlap', title: `${vanId} has overlapping Work Orders`, detail: `${current.order.id} ${current.order.scheduledStart}–${current.order.scheduledEnd} overlaps ${next.order.id} ${next.order.scheduledStart}–${next.order.scheduledEnd}.${supportContext}`, workOrderIds: [current.order.id, next.order.id], vanIds: [vanId] });
          continue;
        }
        const gap = timeToMinutes(next.order.scheduledStart) - timeToMinutes(current.order.scheduledEnd);
        if (gap < 0) continue;
        if (current.order.sector !== next.order.sector && gap < settings.bufferMinutes) {
          conflicts.push({ id: `CONFLICT-${vanId}-${current.order.id}-${next.order.id}-buffer`, severity: 'warning', type: 'route_buffer', title: `${vanId} has insufficient route buffer`, detail: `${gap} minutes between ${current.order.sector} and ${next.order.sector}; configured buffer is ${settings.bufferMinutes} minutes.`, workOrderIds: [current.order.id, next.order.id], vanIds: [vanId] });
        }
        const sameHalfDay = (timeToMinutes(current.order.scheduledStart) < 720) === (timeToMinutes(next.order.scheduledStart) < 720);
        if (sameHalfDay && !sectorsCompatible(current.order.sector, next.order.sector)) {
          conflicts.push({ id: `CONFLICT-${vanId}-${current.order.id}-${next.order.id}-sector`, severity: 'warning', type: 'route_sector', title: `${vanId} crosses incompatible half-day sectors`, detail: `${current.order.sector} → ${next.order.sector} does not match the current DEMAC sector-compatibility map.`, workOrderIds: [current.order.id, next.order.id], vanIds: [vanId] });
        }
      }
    }
  }

  const activeByEmployee = new Map<string, Set<string>>();
  for (const employee of roster.filter((item) => item.active)) {
    const set = activeByEmployee.get(employee.id) ?? new Set<string>();
    set.add(employee.vanId);
    activeByEmployee.set(employee.id, set);
  }
  for (const [employeeId, vanIds] of activeByEmployee) {
    if (vanIds.size <= 1) continue;
    const employee = roster.find((item) => item.id === employeeId);
    conflicts.push({ id: `CONFLICT-WORKFORCE-${employeeId}`, severity: 'critical', type: 'workforce_registry', title: `${employee?.name ?? employeeId} is assigned to multiple vans`, detail: `Active Workforce Registry shows ${[...vanIds].join(', ')}. Resolve the roster before relying on dispatch capacity.`, workOrderIds: [], vanIds: [...vanIds] });
  }

  return conflicts;
}

function arubaParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function deriveProjectedDelayByAssignment(args: {
  orders: BrowserWorkOrderRecord[];
  executions: BrowserFieldExecutionRecord[];
  dateKey: string;
  now?: Date;
}) {
  const result = new Map<string, number>();
  const { dateKey, minutes: nowMinutes } = arubaParts(args.now ?? new Date());
  const selectedIsToday = dateKey === args.dateKey;
  const rows = rowsForDate(args.orders, args.dateKey);
  const byVan = new Map<string, AssignmentRow[]>();
  for (const row of rows) byVan.set(row.vanId, [...(byVan.get(row.vanId) ?? []), row]);

  for (const [vanId, lane] of byVan) {
    const sorted = lane.slice().sort((a, b) => a.order.scheduledStart.localeCompare(b.order.scheduledStart));
    let carry = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const row = sorted[i];
      const execution = args.executions.find((item) => item.workOrderId === row.order.id);
      let ownDelay = 0;
      if (selectedIsToday) {
        const start = timeToMinutes(row.order.scheduledStart);
        const end = timeToMinutes(row.order.scheduledEnd);
        if (execution?.technicianStatus === 'in_progress' && nowMinutes > end) ownDelay = nowMinutes - end;
        else if (!execution?.startedAt && nowMinutes > start) ownDelay = nowMinutes - start;
      }
      const rowDelay = Math.max(carry, ownDelay);
      result.set(assignmentId(row.order.id, vanId), rowDelay);
      const next = sorted[i + 1];
      if (next) {
        const scheduledGap = Math.max(0, timeToMinutes(next.order.scheduledStart) - timeToMinutes(row.order.scheduledEnd));
        carry = Math.max(0, rowDelay - scheduledGap);
      }
    }
  }
  return result;
}

export function deriveDispatchTimingAlerts(args: {
  orders: BrowserWorkOrderRecord[];
  appointments: BrowserAppointmentRecord[];
  executions: BrowserFieldExecutionRecord[];
  readinessByWorkOrder: Map<string, BrowserJobReadiness>;
  dateKey: string;
  states?: BrowserDispatchAssignmentState[];
  now?: Date;
}) {
  const alerts: DispatchTimingAlert[] = [];
  const clock = arubaParts(args.now ?? new Date());
  if (clock.dateKey !== args.dateKey) return alerts;
  const states = args.states ?? loadDispatchAssignmentStates();
  const delays = deriveProjectedDelayByAssignment({ orders: args.orders, executions: args.executions, dateKey: args.dateKey, now: args.now });

  for (const order of args.orders.filter((item) => item.scheduledDate === args.dateKey)) {
    const execution = args.executions.find((item) => item.workOrderId === order.id);
    const readiness = args.readinessByWorkOrder.get(order.id);
    if (!readiness) continue;
    const startDecision = fieldStartDecision(readiness, loadDispatchAtRiskReleases());
    for (const assignment of order.assignments) {
      const stage = effectiveDispatchStage(order, assignment.vanId, execution, states);
      const minutesToStart = timeToMinutes(order.scheduledStart) - clock.minutes;
      const projectedDelayMinutes = delays.get(assignmentId(order.id, assignment.vanId)) ?? 0;
      const physicallyLeft = stage === 'departed' || stage === 'in_transit' || stage === 'on_site' || stage === 'in_field' || stage === 'submitted';

      if (!physicallyLeft && minutesToStart < 0) {
        alerts.push({ id: `ALERT-${order.id}-${assignment.vanId}-late`, severity: 'critical', title: `${assignment.vanId} is late for ${order.id}`, detail: `${Math.abs(minutesToStart)} minutes past scheduled start and physical departure/on-site/start is not recorded.`, workOrderId: order.id, vanId: assignment.vanId, minutesToStart, projectedDelayMinutes });
      } else if (!physicallyLeft && minutesToStart <= 30 && readiness.status === 'blocked') {
        alerts.push({ id: `ALERT-${order.id}-${assignment.vanId}-blocked`, severity: 'critical', title: `${order.id} starts in ${Math.max(0, minutesToStart)} min but is BLOCKED`, detail: readiness.blockers[0]?.reason ?? 'A hard readiness blocker remains.', workOrderId: order.id, vanId: assignment.vanId, minutesToStart, projectedDelayMinutes });
      } else if (!physicallyLeft && minutesToStart <= 30 && readiness.status === 'at_risk' && !startDecision.allowed) {
        alerts.push({ id: `ALERT-${order.id}-${assignment.vanId}-risk`, severity: 'warning', title: `${order.id} is AT RISK without release`, detail: `${Math.max(0, minutesToStart)} minutes to start. ${readiness.risks[0]?.reason ?? startDecision.reason}`, workOrderId: order.id, vanId: assignment.vanId, minutesToStart, projectedDelayMinutes });
      } else if (!physicallyLeft && minutesToStart <= 30 && startDecision.allowed && stage === 'not_ready') {
        alerts.push({ id: `ALERT-${order.id}-${assignment.vanId}-prep`, severity: 'warning', title: `${assignment.vanId} is not marked Ready to Depart`, detail: `${order.id} can dispatch, but pre-departure preparation has not been acknowledged.`, workOrderId: order.id, vanId: assignment.vanId, minutesToStart, projectedDelayMinutes });
      }

      if (execution?.technicianStatus === 'in_progress' && clock.minutes > timeToMinutes(order.scheduledEnd)) {
        const overrun = clock.minutes - timeToMinutes(order.scheduledEnd);
        alerts.push({ id: `ALERT-${order.id}-${assignment.vanId}-overrun`, severity: 'critical', title: `${order.id} is running ${overrun} min past schedule`, detail: `Following ${assignment.vanId} work may be delayed. Customer communication remains an explicit Operations action.`, workOrderId: order.id, vanId: assignment.vanId, projectedDelayMinutes: Math.max(projectedDelayMinutes, overrun) });
      } else if (projectedDelayMinutes >= 15) {
        alerts.push({ id: `ALERT-${order.id}-${assignment.vanId}-propagated`, severity: projectedDelayMinutes >= 30 ? 'critical' : 'warning', title: `${order.id} projected ${projectedDelayMinutes} min late`, detail: `Delay is propagated from an earlier assignment in ${assignment.vanId}. Review route/customer communication before it becomes a missed promise.`, workOrderId: order.id, vanId: assignment.vanId, projectedDelayMinutes });
      }
    }
  }

  return alerts;
}

export function deriveDailyClose(args: { orders: BrowserWorkOrderRecord[]; executions: BrowserFieldExecutionRecord[]; dateKey: string; now?: Date }) {
  const settings = loadBrowserBusinessSettings();
  const primaryOrders = args.orders.filter((order) => order.scheduledDate === args.dateKey);
  const submitted = primaryOrders.filter((order) => args.executions.some((execution) => execution.workOrderId === order.id && execution.technicianStatus === 'submitted'));
  const inField = primaryOrders.filter((order) => args.executions.some((execution) => execution.workOrderId === order.id && execution.technicianStatus === 'in_progress'));
  const pending = primaryOrders.filter((order) => !args.executions.some((execution) => execution.workOrderId === order.id && (execution.technicianStatus === 'in_progress' || execution.technicianStatus === 'submitted')));
  const afterHours = timeToMinutes(settings.afterHours);
  const overtime = submitted.filter((order) => {
    const execution = args.executions.find((item) => item.workOrderId === order.id);
    if (!execution?.submittedAt) return false;
    const clock = arubaParts(new Date(execution.submittedAt));
    return clock.dateKey === args.dateKey && clock.minutes > afterHours;
  });
  const today = arubaParts(args.now ?? new Date()).dateKey;
  return {
    scheduled: primaryOrders.length,
    submitted: submitted.length,
    inField: inField.length,
    pending: pending.length,
    carryoverRequired: args.dateKey < today ? pending.length : 0,
    overtime: overtime.length,
  };
}
