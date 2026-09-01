import { deriveDispatchConflicts, deriveProjectedDelayByAssignment, dispatchStageDecision } from '../lib/browser-dispatch-operations';
import type { BrowserFieldExecutionRecord } from '../lib/browser-field';
import type { BrowserJobReadiness } from '../lib/browser-job-readiness';
import type { BrowserWorkOrderRecord } from '../lib/browser-operational';
import type { BrowserWorkforceEmployee } from '../lib/browser-workforce';
import { deriveRequiredToolsReadiness } from '../lib/browser-tools';
import { diagnoseBookingRequest } from '../lib/scheduling-booking-diagnostics';
import { findCandidateSlots, type BookingRequest, type DispatchJob } from '../lib/scheduling';
import { findCandidateSlotsForDay, findSupportReflowPlansForDay, type OperationalDay } from '../lib/scheduling-capacity';
import { legacySchedulingSimulatorVans } from '../lib/legacy-scheduling-simulator-fixtures';

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
      { vanId: args.primaryVanId, role: 'primary', quantity: args.supportVanId ? 7 : 1, customerCommunicationOwner: true, start: args.start, end: args.end },
      ...(args.supportVanId ? [{ vanId: args.supportVanId, role: 'support' as const, quantity: 1, customerCommunicationOwner: false, start: args.start, end: args.end }] : []),
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

const opaqueVanId = 'RESOURCE-FIELD-ALPHA';
const opaqueToolReadiness = deriveRequiredToolsReadiness(order({
  id: 'WO-OPAQUE-TOOLS', primaryVanId: opaqueVanId, start: '10:30', end: '11:30', sector: 'Noord',
}), {
  assets: [{
    id: 'TOOL-OPAQUE-1',
    name: 'Service Kit Alpha',
    toolClass: 'Service Toolkit',
    locationId: opaqueVanId,
    status: 'available',
    verified: true,
    updatedAt: '2026-08-10T12:00:00.000Z',
  }],
  policies: [{
    presetId: 'standard_service',
    requiredClasses: ['Service Toolkit'],
    coverageMode: 'per_assigned_van',
    reviewed: true,
    updatedAt: '2026-08-10T12:00:00.000Z',
    updatedBy: 'acceptance',
  }],
});
requireCondition(opaqueToolReadiness.status === 'ready', 'Tool custody must accept an opaque canonical Van location ID instead of limiting readiness to VAN-1–VAN-4.');

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

const noordAnchor: DispatchJob = {
  id: 'ANCHOR-NOORD',
  customer: 'Anchor Customer',
  site: 'Noord Property',
  sector: 'Noord',
  start: '08:30',
  end: '09:30',
  segment: 'am',
  vanId: 'VAN-1',
  presetId: 'standard_service',
  quantity: 1,
  status: 'confirmed',
  readiness: 'ready',
  isPrimaryAssignment: true,
  customerCommunicationOwner: true,
};
const farRequest: BookingRequest = { customer: 'San Nicolas Customer', site: 'San Nicolas Property', sector: 'San Nicolas', presetId: 'standard_service', quantity: 1 };
const farCandidates = findCandidateSlots(farRequest, [noordAnchor], legacySchedulingSimulatorVans);
const farIssues = diagnoseBookingRequest({ request: farRequest, jobs: [noordAnchor], preferred: { vanId: 'VAN-1', start: '10:30' }, candidateSlots: farCandidates, quantityValid: true });
requireCondition(farIssues.some((issue) => issue.code === 'route-anchor-conflict' && issue.field === 'property' && issue.severity === 'error'), 'Noord morning anchor versus San Nicolas preferred spot must produce an immediate property-level route error.');

const tenUnitRequest: BookingRequest = { customer: 'Large Customer', site: 'Large Property', sector: 'Noord', presetId: 'standard_service', quantity: 10 };
const tenUnitPlans = findCandidateSlots(tenUnitRequest, [], legacySchedulingSimulatorVans);
requireCondition(tenUnitPlans.some((slot) => slot.requiresSupportVan && slot.primaryUnits === 7 && slot.supportUnits === 3 && Boolean(slot.supportStart) && Boolean(slot.supportEnd)), '10 same-site units must automatically plan 7 primary + 3 support with explicit support timing.');

const fourteenUnitRequest: BookingRequest = { customer: 'Very Large Customer', site: 'Very Large Property', sector: 'Noord', presetId: 'standard_service', quantity: 14 };
const fourteenUnitPlans = findCandidateSlots(fourteenUnitRequest, [], legacySchedulingSimulatorVans);
requireCondition(fourteenUnitPlans.some((slot) => slot.requiresSupportVan && slot.primaryUnits === 7 && slot.supportUnits === 7 && slot.supportSegment === 'full_day'), '14 same-site units must automatically plan 7 + 7 across two linked full-day vans.');

const recoveryDay: OperationalDay = {
  dateKey,
  weekday: 'Tue',
  shortDate: 'Aug 11',
  isToday: true,
  isOpen: true,
  shiftLabel: '8:00 AM–5:00 PM',
};
const recoveryJobs: DispatchJob[] = [
  {
    id: 'APT-MORNING-P', customer: 'Morning Customer', site: 'Noord Home', sector: 'Noord', start: '08:30', end: '10:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 2, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true,
  },
  {
    id: 'APT-CHRISTIAN-P', customer: 'Christian Marquez', site: 'Wayaca Residence', sector: 'Oranjestad', start: '08:30', end: '16:30', segment: 'full_day', vanId: 'VAN-3', presetId: 'standard_service', quantity: 7, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true,
  },
  {
    id: 'APT-CHRISTIAN-S', customer: 'Christian Marquez', site: 'Wayaca Residence', sector: 'Oranjestad', start: '13:30', end: '14:30', segment: 'pm', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: false, customerCommunicationOwner: false, supportForJobId: 'APT-CHRISTIAN-P',
  },
  {
    id: 'APT-BLOCK-V2', customer: 'Van 2 Full Day', site: 'Noord', sector: 'Noord', start: '08:30', end: '16:30', segment: 'full_day', vanId: 'VAN-2', presetId: 'standard_service', quantity: 7, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true,
  },
  {
    id: 'APT-BLOCK-V4', customer: 'Van 4 Full Day', site: 'Noord', sector: 'Noord', start: '08:30', end: '16:30', segment: 'full_day', vanId: 'VAN-4', presetId: 'standard_service', quantity: 7, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true,
  },
];

const threeHourRequest: BookingRequest = { customer: 'Three Unit Customer', site: 'Noord Property', sector: 'Noord', presetId: 'standard_service', quantity: 3 };
const threeHourCandidates = findCandidateSlotsForDay(recoveryDay, threeHourRequest, recoveryJobs, legacySchedulingSimulatorVans);
requireCondition(
  threeHourCandidates.some((slot) => slot.vanId === 'VAN-1' && slot.start === '10:30' && slot.end === '13:30'),
  'Flexible lunch must allow a continuous three-hour Van 1 appointment from 10:30 to 13:30 when the next job starts exactly at 13:30.',
);
requireCondition(
  findSupportReflowPlansForDay(recoveryDay, threeHourRequest, recoveryJobs, legacySchedulingSimulatorVans).length === 0,
  'Support reflow must not move existing work when the request already fits continuously across lunch.',
);

const recoveryRequest: BookingRequest = { customer: 'Four Unit Customer', site: 'Noord Property', sector: 'Noord', presetId: 'standard_service', quantity: 4 };
const fragmentedCandidates = findCandidateSlotsForDay(recoveryDay, recoveryRequest, recoveryJobs, legacySchedulingSimulatorVans);
requireCondition(fragmentedCandidates.length === 0, 'A real Van 1 conflict at 13:30 must prevent the continuous four-hour 10:30–14:30 appointment.');
const recoveryPlans = findSupportReflowPlansForDay(recoveryDay, recoveryRequest, recoveryJobs, legacySchedulingSimulatorVans);
requireCondition(
  recoveryPlans.some((plan) => plan.supportJobId === 'APT-CHRISTIAN-S'
    && plan.vanId === 'VAN-1'
    && plan.fromStart === '13:30'
    && plan.toStart === '14:30'
    && plan.unlockedSlot.vanId === 'VAN-1'
    && plan.unlockedSlot.start === '10:30'
    && plan.unlockedSlot.end === '14:30'),
  'Booking Intelligence must move only the one-unit SUPPORT to 14:30 and recover the real continuous Van 1 span from 10:30–14:30.',
);
requireCondition(recoveryPlans.every((plan) => plan.supportJobId !== 'APT-CHRISTIAN-P'), 'Capacity recovery must never move a primary assignment.');

console.log(`Dispatch acceptance passed: ${conflicts.length} conflict(s) detected; collision, route buffer, support conflict, workday overrun, delay propagation, departure gate, flexible-lunch capacity, linked support planning and support-only capacity recovery verified.`);
