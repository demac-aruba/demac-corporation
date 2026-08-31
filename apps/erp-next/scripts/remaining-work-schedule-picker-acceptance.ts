import assert from 'node:assert/strict';
import type { OfficeBookingOption } from '../lib/office-booking-authority';
import {
  addDays,
  laterDate,
  optionDurationMinutes,
  optionKey,
  optionPrimaryVanId,
  optionsForVan,
} from '../lib/remaining-work-schedule-picker-model';

const option = (overrides: Partial<OfficeBookingOption> = {}): OfficeBookingOption => ({
  id: 'OPT-1',
  date: '2026-09-02',
  time: '08:30',
  assignments: [{
    vanId: 'VAN-3',
    vanName: 'Van 3',
    quantity: 2,
    slots: 4,
    durationMinutes: 240,
    time: '08:30',
    endTime: '12:30',
    capacityEndTime: '12:30',
    role: 'primary',
  }],
  ...overrides,
});

assert.equal(addDays('2026-08-31', 1), '2026-09-01');
assert.equal(addDays('2026-09-01', -1), '2026-08-31');
assert.equal(laterDate('2026-09-02', '2026-09-01'), '2026-09-02');
assert.equal(optionPrimaryVanId(option()), 'VAN-3');
assert.equal(optionDurationMinutes(option()), 240);
assert.equal(optionKey(option()), 'OPT-1|2026-09-02|08:30');

const fallback = option({
  id: 'OPT-2',
  assignments: [{ vanId: 'VAN-2', quantity: 2, slots: 4, time: '09:30', endTime: '13:30', role: 'primary' }],
  workItems: [{
    id: 'work-1',
    presetId: 'installation_standard',
    quantity: 2,
    durationMinutes: 240,
    durationMinutesPerUnit: 120,
    durationMode: 'per_unit',
  }],
});
assert.equal(optionDurationMinutes(fallback), 240);

const options = [
  option({ id: 'LATE', time: '10:30', assignments: [{ vanId: 'VAN-3', quantity: 2, slots: 4, durationMinutes: 240, time: '10:30', endTime: '14:30', role: 'primary' }] }),
  option({ id: 'OTHER-VAN', assignments: [{ vanId: 'VAN-1', quantity: 2, slots: 4, durationMinutes: 240, time: '08:30', endTime: '12:30', role: 'primary' }] }),
  option({ id: 'EARLY', time: '08:30', assignments: [{ vanId: 'VAN-3', quantity: 2, slots: 4, durationMinutes: 240, time: '08:30', endTime: '12:30', role: 'primary' }] }),
];
assert.deepEqual(optionsForVan(options, '2026-09-02', 'VAN-3').map((item) => item.id), ['EARLY', 'LATE']);

console.log('remaining-work-schedule-picker acceptance: PASS');
