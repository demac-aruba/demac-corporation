import type { LiveOperationalCapacityState } from '../lib/live-operational-capacity';
import {
  visualOptionFitsVanPolicy,
  visualVanDayStatus,
  visualVanSlotAvailableByPolicy,
} from '../lib/visual-schedule-operational-policy';

function expectEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

const state: LiveOperationalCapacityState = {
  vans: new Map([
    ['VAN-2', { id: 'VAN-2', active: true, status: 'ACTIVE' }],
    ['VAN-4', { id: 'VAN-4', active: true, status: 'ACTIVE' }],
  ]),
  staffProfiles: [],
  dailyAssignments: [],
  halfDaySchedules: [
    {
      id: 'HALF-VAN-2-TUE',
      active: true,
      vanId: 'VAN-2',
      weekday: 2,
      workdayStart: '08:00',
      workdayEnd: '13:00',
    },
  ],
  calendarClosures: [],
  closedWeekdays: [0],
};

const date = '2026-09-01'; // Tuesday

expectEqual(visualVanDayStatus(state, 'VAN-2', date).label, 'HALF-DAY TO 1:00 PM', 'Van 2 half-day label');
expectEqual(visualVanSlotAvailableByPolicy(state, 'VAN-2', date, '10:30'), true, 'Van 2 morning slot');
expectEqual(visualVanSlotAvailableByPolicy(state, 'VAN-2', date, '13:30'), false, 'Van 2 afternoon slot');
expectEqual(visualOptionFitsVanPolicy(state, 'VAN-2', date, '08:30', '12:30'), true, 'Van 2 valid morning allocation');
expectEqual(visualOptionFitsVanPolicy(state, 'VAN-2', date, '10:30', '14:30'), false, 'Van 2 invalid afternoon allocation');

expectEqual(visualVanDayStatus(state, 'VAN-4', date).label, 'ACTIVE', 'Van 4 full-day label');
expectEqual(visualVanSlotAvailableByPolicy(state, 'VAN-4', date, '13:30'), true, 'Van 4 afternoon slot');
expectEqual(visualOptionFitsVanPolicy(state, 'VAN-4', date, '13:30', '16:30'), true, 'Van 4 afternoon allocation');

console.log('Visual schedule policy acceptance passed: half-day Vans stop showing false afternoon availability while full-day Vans remain available.');
