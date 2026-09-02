import assert from 'node:assert/strict';
import type { OfficeBookingOption } from '../lib/office-booking-authority';
import {
  addDays,
  emptyManualRescheduleSelection,
  laterDate,
  manualRescheduleCandidateOption,
  manualReschedulePrimaryChoices,
  manualRescheduleSupportChoices,
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

const pairedOption = (
  id: string,
  primaryVanId: string,
  supportVanId: string,
  primaryTime = '08:30',
  supportTime = primaryTime,
  date = '2026-09-03',
): OfficeBookingOption => option({
  id,
  date,
  time: primaryTime,
  endTime: '14:30',
  capacityEndTime: '14:30',
  assignments: [{
    vanId: primaryVanId,
    vanName: primaryVanId.replace('VAN-', 'Van '),
    quantity: 3,
    slots: 6,
    durationMinutes: 360,
    time: primaryTime,
    endTime: '14:30',
    capacityEndTime: '14:30',
    role: 'primary',
  }, {
    vanId: supportVanId,
    vanName: supportVanId.replace('VAN-', 'Van '),
    quantity: 3,
    slots: 6,
    durationMinutes: 360,
    time: supportTime,
    endTime: supportTime === '09:30' ? '15:30' : '14:30',
    capacityEndTime: supportTime === '09:30' ? '15:30' : '14:30',
    role: 'support',
  }],
});

const manualOptions = [
  pairedOption('V1-V2', 'VAN-1', 'VAN-2'),
  pairedOption('V2-V1', 'VAN-2', 'VAN-1'),
  pairedOption('V2-V4-EARLY', 'VAN-2', 'VAN-4'),
  pairedOption('V2-V4-LATE', 'VAN-2', 'VAN-4', '09:30', '09:30'),
  pairedOption('V3-V4', 'VAN-3', 'VAN-4'),
  pairedOption('OTHER-DATE', 'VAN-4', 'VAN-3', '08:30', '08:30', '2026-09-04'),
];

const emptySelection = emptyManualRescheduleSelection();
assert.deepEqual(emptySelection, { primaryVanId: '', optionId: '' });
assert.deepEqual(manualRescheduleSupportChoices(manualOptions, '2026-09-03', emptySelection.primaryVanId), []);
assert.equal(
  manualRescheduleCandidateOption(
    manualOptions,
    '2026-09-03',
    emptySelection.primaryVanId,
    emptySelection.optionId,
  ),
  null,
  'manual rescheduling must not silently preselect the first Van or candidate option',
);

assert.deepEqual(
  manualReschedulePrimaryChoices(manualOptions, '2026-09-03'),
  [
    { vanId: 'VAN-1', vanName: 'Van 1', quantity: 3, slots: 6, durationMinutes: 360, optionCount: 1 },
    { vanId: 'VAN-2', vanName: 'Van 2', quantity: 3, slots: 6, durationMinutes: 360, optionCount: 3 },
    { vanId: 'VAN-3', vanName: 'Van 3', quantity: 3, slots: 6, durationMinutes: 360, optionCount: 1 },
  ],
  'primary choices must be unique, ordered, and limited to the selected date',
);

const vanTwoSupportChoices = manualRescheduleSupportChoices(manualOptions, '2026-09-03', 'VAN-2');
assert.deepEqual(
  vanTwoSupportChoices.map((choice) => choice.optionId),
  ['V2-V1', 'V2-V4-EARLY', 'V2-V4-LATE'],
  'support choices must preserve every exact option instead of collapsing repeated Vans with different windows',
);
assert.deepEqual(
  vanTwoSupportChoices.map((choice) => ({
    optionId: choice.optionId,
    vanId: choice.supportVans[0]?.vanId,
    start: choice.supportVans[0]?.start,
    primaryQuantity: choice.primaryQuantity,
    primarySlots: choice.primarySlots,
    primaryDurationMinutes: choice.primaryDurationMinutes,
    supportQuantity: choice.supportVans[0]?.quantity,
    supportSlots: choice.supportVans[0]?.slots,
    supportDurationMinutes: choice.supportVans[0]?.durationMinutes,
  })),
  [
    { optionId: 'V2-V1', vanId: 'VAN-1', start: '08:30', primaryQuantity: 3, primarySlots: 6, primaryDurationMinutes: 360, supportQuantity: 3, supportSlots: 6, supportDurationMinutes: 360 },
    { optionId: 'V2-V4-EARLY', vanId: 'VAN-4', start: '08:30', primaryQuantity: 3, primarySlots: 6, primaryDurationMinutes: 360, supportQuantity: 3, supportSlots: 6, supportDurationMinutes: 360 },
    { optionId: 'V2-V4-LATE', vanId: 'VAN-4', start: '09:30', primaryQuantity: 3, primarySlots: 6, primaryDurationMinutes: 360, supportQuantity: 3, supportSlots: 6, supportDurationMinutes: 360 },
  ],
);

assert.equal(
  manualRescheduleCandidateOption(manualOptions, '2026-09-03', 'VAN-2', 'V2-V4-LATE')?.id,
  'V2-V4-LATE',
  'the exact option selected by the operator must be the option sent for confirmation',
);
assert.equal(manualRescheduleCandidateOption(manualOptions, '2026-09-03', 'VAN-1', 'V2-V4-LATE'), null);
assert.equal(manualRescheduleCandidateOption(manualOptions, '2026-09-04', 'VAN-2', 'V2-V4-LATE'), null);

console.log('remaining-work-schedule-picker acceptance: PASS');
