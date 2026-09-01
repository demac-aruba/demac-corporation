import type { BrowserAppointmentRecord } from '../lib/browser-operational';
import {
  liveOperationalStartTimes,
  type LiveOperationalCapacityState,
} from '../lib/live-operational-capacity';
import { liveDragMoveCandidates, liveMoveTargetKey } from '../lib/live-scheduling-move';
import { getRuntimeSchedulingSettings } from '../lib/scheduling';
import { legacySchedulingSimulatorVans } from '../lib/legacy-scheduling-simulator-fixtures';
import { buildOperationalWeek, type CalendarDispatchJob } from '../lib/scheduling-capacity';

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Saturday live drag acceptance failed: ${message}`);
}

const dateKey = '2026-08-29';
const saturday = buildOperationalWeek(dateKey).find((day) => day.dateKey === dateKey);
requireCondition(Boolean(saturday) && saturday!.isOpen, 'Saturday must be an open normal operating day.');

const capacityState: LiveOperationalCapacityState = {
  vans: new Map(legacySchedulingSimulatorVans.map((van, index) => [van.id, {
    id: van.id,
    active: true,
    status: '',
    responsibleStaffId: `STAFF-SATURDAY-DRIVER-${index + 1}`,
  }])),
  staffProfiles: legacySchedulingSimulatorVans.map((_van, index) => ({
    id: `STAFF-SATURDAY-DRIVER-${index + 1}`,
    name: `Saturday Driver ${index + 1}`,
    active: true,
    availability: 'Disponible',
    canDriveVan: true,
  })),
  staffAbsences: [],
  dailyAssignments: [],
  halfDaySchedules: [],
  calendarClosures: [],
  closedWeekdays: [0],
};

const assignment: CalendarDispatchJob = {
  dateKey,
  id: 'APT-SATURDAY-PRIMARY',
  customer: 'Saturday Drag Test',
  site: 'Oranjestad / Airport',
  sector: 'Oranjestad / Airport',
  start: '08:30',
  end: '09:30',
  segment: 'am',
  vanId: 'VAN-2',
  presetId: 'standard_service',
  quantity: 1,
  status: 'confirmed',
  readiness: 'ready',
  isPrimaryAssignment: true,
  customerCommunicationOwner: true,
};

const appointment = {
  id: 'APT-SATURDAY',
  dateKey,
  customer: assignment.customer,
  site: assignment.site,
  sector: assignment.sector,
  presetId: 'standard_service',
  totalQuantity: 1,
  status: 'confirmed',
  assignments: [assignment],
  primaryVanId: 'VAN-2',
  scheduledSlotCount: 1,
  scheduledDurationMinutes: 60,
  createdAt: new Date('2026-08-22T12:00:00Z').toISOString(),
} as BrowserAppointmentRecord;

const candidates = liveDragMoveCandidates(saturday!, appointment, [assignment], capacityState);
requireCondition(candidates.length > 0, 'A Saturday appointment must expose live drag destinations.');

const settings = getRuntimeSchedulingSettings();
const normalStarts = new Set(settings.serviceStartTimes);
const legacySaturdayStarts = new Set(['09:00', '10:00', '11:00', '12:00']);

for (const candidate of candidates) {
  requireCondition(normalStarts.has(candidate.start), `Candidate ${liveMoveTargetKey(candidate.vanId, candidate.start)} must use the same canonical start-time grid rendered by Live Scheduling.`);
  requireCondition(!legacySaturdayStarts.has(candidate.start), `Legacy Saturday-only start ${candidate.start} must never re-enter live drag capacity.`);
  const renderedStarts = new Set(liveOperationalStartTimes(capacityState, candidate.vanId, dateKey, settings.serviceStartTimes));
  requireCondition(renderedStarts.has(candidate.start), `Candidate ${liveMoveTargetKey(candidate.vanId, candidate.start)} must map to a rendered drop target.`);
}

requireCondition(candidates.some((candidate) => candidate.start === '13:30'), 'Saturday drag must preserve normal afternoon capacity.');
requireCondition(candidates.some((candidate) => candidate.start === '08:30'), 'Saturday drag must preserve the normal 08:30 morning start.');

console.log('Saturday live drag acceptance passed: candidate keys and rendered drop targets share one canonical Monday-Saturday schedule.');
