import { deriveDispatchConflicts, deriveProjectedDelayByAssignment, dispatchStageDecision } from '../lib/browser-dispatch-operations';
import type { BrowserFieldExecutionRecord } from '../lib/browser-field';
import type { BrowserJobReadiness } from '../lib/browser-job-readiness';
import type { BrowserWorkOrderRecord } from '../lib/browser-operational';
import type { BrowserWorkforceEmployee } from '../lib/browser-workforce';

const dateKey = '2026-08-11';

function order(args: {
  id: string;
  primaryVanId: string;
  start: string;
  end: string;
  sector: string;
  supportVanId?: string;
}): BrowserWorkOrderRecord {
  return {
    id: args.id,
    appointmentId: `APT-${args.id}`,
    customer: `Customer ${args.id}`,
    site: `Site ${args.id}`,
    sector: args.sector,
    presetId: 'standard_service',
    totalQuantity: args.supportVanId ? 8 : 1,
    customerFacingDescription: 'Standard service',
    scheduledDate: dateKey,
    scheduledStart: args.start,
    scheduledEnd: args.end,
    primaryVanId: args.primaryVanId,
    supportVanId: args.supportVanId,
    readiness: 'ready',
    lifecycle: 'scheduled',
    assignments: [
      { vanId: args.primaryVanId, role: 'primary', quantity: args.supportVanId ? 6 : 1, customerCommunicationOwner: true },
      ...(args.supportVanId ? [{ vanId: args.supportVanId, role: 'support' as const, quantity: 2, customerCommunicationOwner: false }] : []),
    ],
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

const orders: BrowserWorkOrderRecord[] = [
  order({ id: 'WO-A', primaryVanId: 'VAN-1', start: '08:30', end: '09:30', sector: 'Noord' }),
  order({ id: 'WO-B', primaryVanId: 'VAN-1', start: '09:20', end: '10:20', sector: 'Noord' }),
  order({ id: 'WO-C', primaryVanId: 'VAN-2', start: '08:30', end: '09:30', sector: 'Noord' }),
  order({ id: 'WO-D', primaryVanId: 'VAN-2', start: '09:40', end: '10:40', sector: 'Oranjestad' }),
  order({ id: 'WO-E', primaryVanId: 'VAN-1', supportVanId: 'VAN-3', start: '13:30', end: '14:30', sector: 'Santa Cruz' }),
  order({ id: 'WO-F', primaryVanId: 'VAN-3', start: '14:00', end: '15:00', sector: 'Santa Cruz' }),
  order({ id: 'WO-G', primaryVanId: 'VAN-4', start: '16:30', end: '17:30', sector: 'Paradera' }),
  order({ id: 'WO-H', primaryVanId: 'VAN-4', start: '08:30', end: '09:30', sector: 'Santa Cruz' }),
  order({ id: 'WO-I', primaryVanId: 'VAN-4', start: '09:45', end: '10:45', sector: 'Santa Cruz' }),
];

const roster: BrowserWorkforceEmployee[] = [
  { id: 'EMP-1', name: 'Tech 1', role: 'Technician', vanId: 'VAN-1', active: true, skills: ['Service'], skillsVerified: true, source: 'operator', updatedAt: '2026-08-10T12:00:00.000Z' },
  { id: 'EMP-2', name: 'Tech 2', role: 'Technician', vanId: 'VAN-2', active: true, skills: ['Service'], skillsVerified: true, source: 'operator', updatedAt: '2026-08-10T12:00:00.000Z' },
  { id: 'EMP-3', name: 'Tech 3', role: 'Technician', vanId: 'VAN-3', active: true, skills: ['Service'], skillsVerified: true, source: 'operator', updatedAt: '2026-08-10T12:00:00.000Z' },
  { id: 'EMP-4', name: 'Tech 4', role: 'Technician', vanId: 'VAN-4', active: true, skills: ['Service'], skillsVerified: true, source: 'operator', updatedAt: '2026-08-10T12:00:00.000Z' },
];

const conflicts = deriveDispatchConflicts(orders, dateKey, roster);

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Dispatch acceptance failed: ${message}`);
}

requireCondition(conflicts.some((conflict) => conflict.type === 'van_overlap' && conflict.vanIds.includes('VAN-1') && conflict.workOrderIds.includes('WO-A') && conflict.workOrderIds.includes('WO-B')), 'VAN-1 overlapping primary Work Orders must be detected.');
requireCondition(conflicts.some((conflict) => conflict.type === 'route_buffer' && conflict.vanIds.includes('VAN-2') && conflict.workOrderIds.includes('WO-C') && conflict.workOrderIds.includes('WO-D')), 'VAN-2 insufficient route buffer must be detected.');
requireCondition(conflicts.some((conflict) => conflict.type === 'van_overlap' && conflict.vanIds.includes('VAN-3') && conflict.workOrderIds.includes('WO-E') && conflict.workOrderIds.includes('WO-F')), 'Support-van overlap must be detected.');
requireCondition(conflicts.some((conflict) => conflict.type === 'workday_overrun' && conflict.vanIds.includes('VAN-4') && conflict.workOrderIds.includes('WO-G')), 'Configured workday overrun must be detected.');

const fieldExecution: BrowserFieldExecutionRecord = {
  workOrderId: 'WO-H',
  appointmentId: 'APT-WO-H',
  technicianStatus: 'in_progress',
  startedAt: '2026-08-11T12:30:00.000Z',
  updatedAt: '2026-08-11T13:30:00.000Z',
  equipment: [],
  addons: { switches: 0, brackets: 0, armaflex: 0, refrigerantLb: 0 },
  voiceSeconds: 0,
  voiceTranscriptionStatus: 'none',
  technicianSummary: '',
};

const delayMap = deriveProjectedDelayByAssignment({ orders: [orders.find((item) => item.id === 'WO-H')!, orders.find((item) => item.id === 'WO-I')!], executions: [fieldExecution], dateKey, now: new Date('2026-08-11T14:00:00.000Z') });
requireCondition(delayMap.get('WO-H:VAN-4') === 30, 'Active overrun should calculate 30 minutes on WO-H.');
requireCondition(delayMap.get('WO-I:VAN-4') === 15, '15-minute scheduled gap should absorb half of the 30-minute overrun before WO-I.');

const readyReadiness: BrowserJobReadiness = { workOrderId: 'WO-READY', status: 'ready', dimensions: [], blockers: [], risks: [], calculatedAt: '2026-08-11T12:00:00.000Z' };
const blockedReadiness: BrowserJobReadiness = { workOrderId: 'WO-BLOCKED', status: 'blocked', dimensions: [], blockers: [{ id: 'scope', label: 'Exact HVAC Scope', status: 'blocked', reason: 'Scope missing', source: 'test' }], risks: [], calculatedAt: '2026-08-11T12:00:00.000Z' };
requireCondition(dispatchStageDecision({ currentStage: 'not_ready', nextStage: 'ready_to_depart', readiness: readyReadiness }).allowed, 'READY Work Order must be eligible for Ready to Depart.');
requireCondition(!dispatchStageDecision({ currentStage: 'not_ready', nextStage: 'ready_to_depart', readiness: blockedReadiness }).allowed, 'BLOCKED Work Order must never be eligible for Ready to Depart.');

console.log(`Dispatch acceptance passed: ${conflicts.length} conflict(s) detected; four-van collision, route buffer, support conflict, workday overrun, delay propagation and departure gate verified.`);
