import assert from 'node:assert/strict';
import {
  attendanceExceptionTotals,
  calculateAttendanceVariance,
  classifyAttendanceExceptions,
  scheduledBreakMinutes,
  type AttendanceScheduleForCalculation,
} from '../lib/employee-attendance-calculation';
import { hasAttendanceTimeChange, payrollPeriodForDate, saveAttendanceDay, type AttendanceDayDraft, type AttendanceSchedule, type EmployeeTimesheetEntry } from '../lib/employee-attendance';
import { calculatePayrollDay, payrollPeriodFromDates, shiftPayrollPeriod } from '../lib/employee-payroll';
import type { CanonicalOperationsState, CanonicalStaffProfile } from '../lib/canonical-operations';

const nineToSix: AttendanceScheduleForCalculation = {
  startTime: '09:00',
  endTime: '18:00',
  scheduledMinutes: 480,
};

function variance(clockInTime: string, clockOutTime: string, breakMinutes: number) {
  return calculateAttendanceVariance({ schedule: nineToSix, clockInTime, clockOutTime, breakMinutes });
}

assert.equal(variance('09:00', '18:00', 60).overtimeMinutes, 0, 'Normal 09:00–18:00 with 60-minute break must have zero overtime.');
assert.equal(variance('08:00', '18:00', 60).overtimeMinutes, 60, 'One-hour early start must create 60 overtime minutes.');
assert.equal(variance('09:00', '18:30', 60).overtimeMinutes, 30, 'Thirty-minute late finish must create 30 overtime minutes.');
assert.equal(variance('08:00', '18:30', 60).overtimeMinutes, 90, 'Early start and late finish must stack to 90 overtime minutes.');
assert.equal(variance('09:00', '18:00', 30).overtimeMinutes, 30, 'Thirty unused break minutes must create 30 overtime minutes.');
assert.equal(variance('09:00', '18:00', 0).overtimeMinutes, 60, 'Fully skipped scheduled break must create 60 overtime minutes.');
assert.equal(variance('08:00', '18:30', 30).overtimeMinutes, 120, 'Early start, late finish and unused break must stack without netting.');

const exactPartialDay: AttendanceScheduleForCalculation = {
  startTime: '09:00',
  endTime: '13:00',
  scheduledMinutes: 240,
};
assert.equal(scheduledBreakMinutes(exactPartialDay), 0, 'Exact 09:00–13:00 partial day must not synthesize a break.');
assert.deepEqual(
  calculateAttendanceVariance({ schedule: exactPartialDay, clockInTime: '09:00', clockOutTime: '13:00', breakMinutes: 0 }),
  {
    expectedBreakMinutes: 0,
    workedMinutes: 240,
    earlyStartMinutes: 0,
    lateFinishMinutes: 0,
    unusedBreakMinutes: 0,
    breakAppliedToEarlyDepartureMinutes: 0,
    overtimeMinutes: 0,
    lateArrivalMinutes: 0,
    earlyDepartureMinutes: 0,
    extendedBreakMinutes: 0,
    missingScheduledMinutes: 0,
    missingSegments: [],
  },
  'Attendance calculation must preserve the exact partial-day schedule merged in PR #452.',
);

const splitAbsence = variance('11:00', '16:30', 60);
assert.deepEqual(
  splitAbsence.missingSegments,
  [
    { kind: 'late_arrival', minutes: 120, fromTime: '09:00', toTime: '11:00' },
    { kind: 'early_departure', minutes: 90, fromTime: '16:30', toTime: '18:00' },
  ],
  'Late arrival and early departure must remain separate missing-time segments.',
);
assert.equal(splitAbsence.overtimeMinutes, 0, 'Missing scheduled time must never invent overtime.');
assert.equal(splitAbsence.missingScheduledMinutes, 210, '09:00–18:00 employee working 11:00–16:30 must have 210 missing scheduled minutes.');
assert.equal(splitAbsence.workedMinutes, 270, 'Actual work for 11:00–16:30 with a 60-minute break must be 270 minutes.');

const extendedBreak = variance('09:00', '18:00', 90);
assert.deepEqual(
  extendedBreak.missingSegments,
  [{ kind: 'extended_break', minutes: 30 }],
  'Break time beyond the scheduled allowance must be a separate missing-time segment.',
);
assert.equal(extendedBreak.overtimeMinutes, 0, 'An extended break must not be treated as negative overtime.');

const afterShiftOnly = variance('19:00', '20:00', 0);
assert.equal(afterShiftOnly.workedMinutes, 60, 'A one-hour clock interval after the shift contains at most 60 worked minutes.');
assert.equal(afterShiftOnly.overtimeMinutes, 60, 'Derived overtime must never exceed actual worked minutes.');
assert.equal(afterShiftOnly.missingScheduledMinutes, 480, 'Clocking entirely after the shift must cap missing scheduled time at the scheduled 480 minutes.');
assert.deepEqual(
  afterShiftOnly.missingSegments,
  [{ kind: 'late_arrival', minutes: 480, fromTime: '09:00', toTime: '18:00' }],
  'A clock-in after the scheduled shift must classify only the bounded scheduled interval as late arrival.',
);

const beforeShiftOnly = variance('08:00', '08:30', 0);
assert.equal(beforeShiftOnly.workedMinutes, 30, 'A 30-minute clock interval before the shift contains at most 30 worked minutes.');
assert.equal(beforeShiftOnly.overtimeMinutes, 30, 'Early-start overtime must be bounded by the actual clock interval.');
assert.equal(beforeShiftOnly.missingScheduledMinutes, 480, 'Clocking entirely before the shift must cap missing scheduled time at the scheduled 480 minutes.');
assert.deepEqual(
  beforeShiftOnly.missingSegments,
  [{ kind: 'early_departure', minutes: 480, fromTime: '09:00', toTime: '18:00' }],
  'A clock-out before the scheduled shift must classify only the bounded scheduled interval as early departure.',
);

const oversizedBreak = variance('09:00', '18:00', 600);
assert.equal(oversizedBreak.workedMinutes, 0, 'Break minutes cannot create negative worked time.');
assert.equal(oversizedBreak.extendedBreakMinutes, 480, 'Extended-break missing time must be capped at scheduled worked minutes.');
assert.equal(oversizedBreak.missingScheduledMinutes, 480, 'Missing scheduled time must never exceed the scheduled worked minutes.');

const classified = classifyAttendanceExceptions(splitAbsence, [
  { kind: 'late_arrival', treatment: 'paid', reason: 'Doctor appointment' },
  { kind: 'early_departure', treatment: 'no_work_no_pay', reason: 'Personal permission' },
]);
assert.deepEqual(
  attendanceExceptionTotals(classified),
  { paidMinutes: 120, noWorkNoPayMinutes: 90 },
  'Paid and No Work No Pay missing-time segments must remain independently auditable.',
);

assert.throws(
  () => classifyAttendanceExceptions(splitAbsence, [{ kind: 'late_arrival', treatment: 'paid', reason: 'Doctor appointment' }]),
  /Choose Paid or No Work No Pay for early departure/,
  'Saving must fail when any detected segment is missing a payment treatment.',
);
assert.throws(
  () => classifyAttendanceExceptions(splitAbsence, [
    { kind: 'late_arrival', treatment: 'paid', reason: '' },
    { kind: 'early_departure', treatment: 'no_work_no_pay', reason: 'Personal permission' },
  ]),
  /Enter a reason for late arrival/,
  'Saving must fail when a detected segment has no reason.',
);

const septemberPayroll = payrollPeriodFromDates('2026-08-27', '2026-09-26');
const augustPayroll = shiftPayrollPeriod(septemberPayroll, -1);
assert.deepEqual(
  { start: augustPayroll.startDate, end: augustPayroll.endDate },
  { start: '2026-07-27', end: '2026-08-26' },
  'One previous action from September payroll must land on August payroll without skipping it.',
);
const julyPayroll = shiftPayrollPeriod(augustPayroll, -1);
assert.deepEqual(
  { start: julyPayroll.startDate, end: julyPayroll.endDate },
  { start: '2026-06-27', end: '2026-07-26' },
  'A second previous action must land on July payroll.',
);
assert.equal(
  payrollPeriodForDate('2026-07-27'),
  '2026-07-27_2026-08-26',
  'July 27 belongs to August payroll and must not be reclassified as July payroll.',
);
assert.equal(
  payrollPeriodForDate('2026-08-26'),
  '2026-07-27_2026-08-26',
  'August 26 remains the final date of August payroll.',
);
assert.equal(
  payrollPeriodForDate('2026-08-27'),
  '2026-08-27_2026-09-26',
  'August 27 starts September payroll.',
);

console.log('Employee attendance acceptance passed: payroll navigation, schedule-derived overtime, bounded edge cases, exact partial-day compatibility, independent partial exceptions, classification and 27–26 membership.');

async function verifyShiftedBreakSaveAndPayroll() {
  // Stub only persistence: exercise the production save calculation and payroll consumer
  // without credentials or any network/production write.
  const storage = require('../lib/firebase/firestore-rest') as typeof import('../lib/firebase/firestore-rest');
  const originalSave = storage.saveFirestoreDocument;
  const writes: EmployeeTimesheetEntry[] = [];
  storage.saveFirestoreDocument = async (collection, document) => {
    assert.equal(collection, 'employeeTimesheets');
    writes.push(document as unknown as EmployeeTimesheetEntry);
    return document;
  };
  const employee: CanonicalStaffProfile = { id: 'staff-break-test', name: 'Attendance Fixture', active: true };
  const schedule: AttendanceSchedule = { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480, paidFreeMinutes: 0, label: 'Test shift' };
  const draft: AttendanceDayDraft = { status: 'Present', clockInTime: '08:00', clockOutTime: '16:00', breakMinutes: 0, overtimeMinutes: 999, notes: '' };
  const operations = { staffProfiles: [employee], vans: [], vanHalfDaySchedules: [], staffAbsences: [] } as unknown as CanonicalOperationsState;
  const input = { employee, date: '2026-09-22', schedule, draft, updatedByUserId: 'test-operator', updatedByName: 'Test Operator' };
  try {
    assert.equal(hasAttendanceTimeChange(schedule, { ...draft, clockOutTime: '17:00', breakMinutes: 60 }), false);
    for (const [clockOutTime, overtimeMinutes] of [['16:00', 0], ['16:30', 30], ['17:00', 60]] as const) {
      const changedDraft = { ...draft, clockOutTime };
      assert.equal(hasAttendanceTimeChange(schedule, changedDraft), true, 'A shifted break must remain saveable even with no notes or overtime.');
      const entry = await saveAttendanceDay({ ...input, draft: changedDraft });
      assert.equal(entry.clockOutTime, clockOutTime);
      assert.equal(entry.breakMinutes, 0);
      assert.equal(entry.regularHours, 8);
      assert.equal(entry.overtimeMinutes, overtimeMinutes);
      assert.equal(entry.paidFreeHours, 0);
      assert.equal(entry.noWorkNoPayHours, 0);
      assert.equal(entry.scheduledBreakMinutes, 60);
      assert.equal(entry.updatedByUserId, 'test-operator');
      assert.deepEqual(entry.attendanceExceptions, []);
      const payroll = calculatePayrollDay({ employee, date: input.date, operations, attendance: { payrollSettings: [], timesheets: [entry], advances: [] } });
      assert.equal(payroll.regularHours, 8);
      assert.equal(payroll.overtimeHours, overtimeMinutes / 60);
      assert.equal(payroll.noWorkNoPayHours, 0);
      const repeat = await saveAttendanceDay({ ...input, draft: changedDraft, existingEntry: entry });
      assert.equal(repeat.id, entry.id, 'Retry must use the same employee/date document.');
      assert.equal(repeat.createdAt, entry.createdAt);
      assert.equal(repeat.overtimeMinutes, entry.overtimeMinutes, 'Retry must not accumulate overtime.');
    }
    const count = writes.length;
    await assert.rejects(saveAttendanceDay({ ...input, draft: { ...draft, clockOutTime: '15:30' } }), /Choose Paid or No Work No Pay for no work/);
    await assert.rejects(saveAttendanceDay({ ...input, draft: { ...draft, clockOutTime: '07:30' } }), /Clock Out must be later/);
    assert.equal(writes.length, count, 'Invalid or unclassified inputs must not write.');
    const partial = await saveAttendanceDay({ ...input, draft: { ...draft, clockOutTime: '15:30', attendanceExceptionClassifications: [{ kind: 'partial_day', treatment: 'no_work_no_pay', reason: 'Test reason' }] } });
    assert.equal(partial.regularHours, 7.5);
    assert.equal(partial.noWorkNoPayHours, 0.5);
    assert.equal(partial.overtimeMinutes, 0);
    const corrected = await saveAttendanceDay({ ...input, existingEntry: partial });
    assert.equal(corrected.regularHours, 8);
    assert.equal(corrected.noWorkNoPayHours, 0);
    assert.deepEqual(corrected.attendanceExceptions, [], 'Editing to a covered departure removes stale classifications.');
    for (const employeeId of ['staff-partial-one', 'staff-partial-two']) {
      const partialEmployee = { ...employee, id: employeeId };
      const partialInput = { ...input, employee: partialEmployee, date: '2026-09-14', draft: { ...draft, clockInTime: '13:00', clockOutTime: '16:00' } };
      const before = writes.length;
      await assert.rejects(saveAttendanceDay(partialInput), /Choose Paid or No Work No Pay for no work/);
      await assert.rejects(saveAttendanceDay({ ...partialInput, draft: { ...partialInput.draft, attendanceExceptionClassifications: [{ kind: 'late_arrival', treatment: 'paid', reason: 'Old classification' }] } }), /Choose Paid or No Work No Pay for no work/, 'An old arrival classification must not silently approve the new aggregate.');
      assert.equal(writes.length, before);
      for (const treatment of ['paid', 'no_work_no_pay'] as const) {
        const classifiedDraft = { ...partialInput.draft, attendanceExceptionClassifications: [{ kind: 'partial_day' as const, treatment, reason: 'Test absence decision' }] };
        const entry = await saveAttendanceDay({ ...partialInput, draft: classifiedDraft });
        assert.equal(entry.workedMinutes, 180);
        assert.equal(entry.regularHours, 3);
        assert.equal(entry.overtimeMinutes, 0);
        assert.equal(entry.breakMinutes, 0);
        assert.equal(entry.paidFreeHours, treatment === 'paid' ? 5 : 0);
        assert.equal(entry.noWorkNoPayHours, treatment === 'paid' ? 0 : 5);
        assert.deepEqual(entry.attendanceExceptions, [{ kind: 'partial_day', minutes: 300, treatment, reason: 'Test absence decision' }]);
        const payroll = calculatePayrollDay({ employee: partialEmployee, date: partialInput.date, operations, attendance: { payrollSettings: [], timesheets: [entry], advances: [] } });
        assert.equal(payroll.regularHours, 3, 'Paid permission must not turn no-work time into worked time.');
        assert.equal(payroll.regularHours + payroll.paidFreeHours, treatment === 'paid' ? 8 : 3);
        assert.equal(payroll.noWorkNoPayHours, treatment === 'paid' ? 0 : 5);
        const repeated = await saveAttendanceDay({ ...partialInput, draft: classifiedDraft, existingEntry: entry });
        assert.equal(repeated.id, entry.id);
        assert.equal(repeated.paidFreeHours, entry.paidFreeHours);
        assert.equal(repeated.noWorkNoPayHours, entry.noWorkNoPayHours);
        const changedTreatment = treatment === 'paid' ? 'no_work_no_pay' : 'paid';
        const changed = await saveAttendanceDay({ ...partialInput, existingEntry: entry, draft: { ...classifiedDraft, attendanceExceptionClassifications: [{ kind: 'partial_day', treatment: changedTreatment, reason: 'Corrected decision' }] } });
        assert.equal(changed.regularHours, 3);
        assert.equal(changed.paidFreeHours, changedTreatment === 'paid' ? 5 : 0);
        assert.equal(changed.noWorkNoPayHours, changedTreatment === 'paid' ? 0 : 5);
      }
    }
    storage.saveFirestoreDocument = async () => { throw new Error('Permission denied'); };
    await assert.rejects(saveAttendanceDay(input), /Permission denied/, 'Save must surface a denied/failed write instead of reporting success.');
  } finally {
    storage.saveFirestoreDocument = originalSave;
  }
  console.log('Attendance acceptance passed: full-day shifted breaks, partial days for multiple employees, paid/unpaid no-work, save/retry, payroll and failed-write propagation.');
}

void verifyShiftedBreakSaveAndPayroll().catch((error) => { console.error(error); process.exitCode = 1; });
