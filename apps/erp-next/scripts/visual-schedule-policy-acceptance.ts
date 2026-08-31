import assert from 'node:assert/strict';
import type { LiveOperationalCapacityState } from '../lib/live-operational-capacity';
import {
  visualOptionFitsVanPolicy,
  visualVanDayStatus,
  visualVanSlotAvailableByPolicy,
} from '../lib/visual-schedule-operational-policy';

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

assert.equal(visualVanDayStatus(state, 'VAN-2', date).label, 'HALF-DAY TO 1:00 PM');
assert.equal(visualVanSlotAvailableByPolicy(state, 'VAN-2', date, '10:30'), true);
assert.equal(visualVanSlotAvailableByPolicy(state, 'VAN-2', date, '13:30'), false);
assert.equal(visualOptionFitsVanPolicy(state, 'VAN-2', date, '08:30', '12:30'), true);
assert.equal(visualOptionFitsVanPolicy(state, 'VAN-2', date, '10:30', '14:30'), false);

assert.equal(visualVanDayStatus(state, 'VAN-4', date).label, 'ACTIVE');
assert.equal(visualVanSlotAvailableByPolicy(state, 'VAN-4', date, '13:30'), true);
assert.equal(visualOptionFitsVanPolicy(state, 'VAN-4', date, '13:30', '16:30'), true);

console.log('Visual schedule policy acceptance passed: half-day Vans stop showing false afternoon availability while full-day Vans remain available.');
