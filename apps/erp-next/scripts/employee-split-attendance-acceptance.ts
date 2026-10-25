import assert from 'node:assert/strict';
import { saveAttendanceDay, type EmployeeTimesheetEntry, type AttendanceDayDraft, type AttendanceSchedule } from '../lib/employee-attendance';
import { overtimeRateTotals } from '../lib/employee-attendance-calculation';

async function main() {
  const storage = require('../lib/firebase/firestore-rest') as typeof import('../lib/firebase/firestore-rest');
  const original = storage.mutateFirestoreDocumentWithReads;
  const docs: Record<string, EmployeeTimesheetEntry | null> = {};
  let commits = 0;
  storage.mutateFirestoreDocumentWithReads = async (collection, id, readIds, changesFor) => {
    assert.equal(collection, 'employeeTimesheets');
    const changes = changesFor(docs[id] as never ?? null, Object.fromEntries([id, ...readIds].map(key => [key, docs[key] ?? null])) as never);
    if (changes) { docs[id] = { ...docs[id], ...changes, id } as EmployeeTimesheetEntry; commits++; }
    return structuredClone(docs[id]) as never;
  };
  const employee = { id: 'synthetic-employee', name: 'Synthetic Employee' };
  const schedule: AttendanceSchedule = { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480, paidFreeMinutes: 0, label: 'Fixture' };
  const draft: AttendanceDayDraft = { status: 'Present', clockInTime: '08:00', clockOutTime: '17:00', breakMinutes: 60, overtimeMinutes: 0, notes: '', changeReason: 'Synthetic emergency return', workIntervals: [
    { startTime: '08:00', endTime: '17:00', startDayOffset: 0, endDayOffset: 0, breakMinutes: 60 },
    { startTime: '19:30', endTime: '05:00', startDayOffset: 0, endDayOffset: 1, breakMinutes: 0 },
  ], overtimePayAllocations: [{ rate: 150, minutes: 150 }, { rate: 200, minutes: 420 }] };
  const input = { employee, date: '2026-10-26', schedule, draft, updatedByUserId: 'synthetic-operator', adjacentEntries: [], nextScheduledStartTime: '08:00' };
  try {
    const first = await saveAttendanceDay(input);
    assert.equal(first.regularHours, 8); assert.equal(first.overtimeMinutes, 570);
    assert.equal(first.workedMinutes, 1050); assert.equal(first.payrollPeriodId, '2026-09-27_2026-10-26');
    assert.equal(first.attendanceHistory?.length, 1);
    await saveAttendanceDay(input); assert.equal(commits, 1, 'Lost-response retry must not append history or duplicate hours');
    const changed = { ...first, notes: 'Concurrent operator edit' }; docs[first.id] = changed;
    await assert.rejects(saveAttendanceDay({ ...input, existingEntry: first, draft: { ...draft, changeReason: 'Changed rate', overtimePayAllocations: [{ rate: 200, minutes: 570 }] } }), /changed/);
    assert.equal(commits, 1);
    docs[first.id] = first;
    const rerated = await saveAttendanceDay({ ...input, existingEntry: first, schedule: { ...schedule, endTime: '13:00', scheduledMinutes: 240 }, draft: { ...draft, changeReason: 'Approved 200%', overtimePayAllocations: [{ rate: 200, minutes: 570 }] } });
    for (const key of ['regularHours','workedMinutes','overtimeMinutes','scheduledStartTime','scheduledEndTime','scheduledWorkHours','createdAt'] as const) assert.equal(rerated[key], first[key]);
    const { attendanceHistory: _history, ...before } = first; assert.deepEqual(rerated.attendanceHistory?.at(-1)?.before, before);
    assert.equal(overtimeRateTotals(rerated).at200, 570);
    // Explicitly removing the additional interval clears its allocations, retaining the old record in history.
    const regular = await saveAttendanceDay({ ...input, existingEntry: rerated, draft: { ...draft, workIntervals: draft.workIntervals!.slice(0, 1), overtimePayAllocations: undefined } });
    assert.equal(regular.overtimeMinutes, 0); assert.deepEqual(regular.overtimePayAllocations, []);
    // Adjacent Work Order-only overnight evidence must also block a normal (non-split) next-day save.
    docs['synthetic-employee_2026-10-25'] = { id: 'synthetic-employee_2026-10-25', employeeId: employee.id, date: '2026-10-25', workOrderAttendanceSegments: [{ workOrderId: 'synthetic-work', startDate: '2026-10-25', startTime: '19:30', endDate: '2026-10-26', endTime: '09:00' }] } as EmployeeTimesheetEntry;
    await assert.rejects(saveAttendanceDay({ ...input, existingEntry: regular, draft: { ...draft, clockInTime: '07:00', workIntervals: [{ ...draft.workIntervals![0], startTime: '07:00' }], overtimePayAllocations: [{ rate: 150, minutes: 60 }] } }), /overlap/);
    assert.equal(commits, 3);
    const normalEmployee = { id: 'synthetic-normal', name: 'Synthetic Normal' };
    docs['synthetic-normal_2026-10-25'] = { ...docs['synthetic-employee_2026-10-25']!, id: 'synthetic-normal_2026-10-25', employeeId: normalEmployee.id };
    await assert.rejects(saveAttendanceDay({ ...input, employee: normalEmployee, existingEntry: undefined,
      existingAbsence: { id: 'synthetic-absence', active: true } as never,
      draft: { ...draft, workIntervals: undefined, overtimePayAllocations: undefined, changeReason: undefined },
    }), /overlap/);
    assert.equal(commits, 3, 'Ordinary absence-to-Present conversion must reject before writing either authority');
    delete docs['synthetic-employee_2026-10-25'];
    // Existing legacy identifiers and opaque metadata survive a rate-only update.
    const legacy = { ...first, id: 'legacy-id', workIntervals: undefined, overtimePayAllocations: undefined, attendanceHistory: undefined, overtimeMinutes: 123, overtimeHours: 2.05, unknownMetadata: { preserve: true } };
    docs[legacy.id] = legacy;
    const updated = await saveAttendanceDay({ ...input, existingEntry: legacy, draft: { ...draft, workIntervals: undefined, overtimePayAllocations: [{ rate: 150, minutes: 123 }] } });
    assert.equal(updated.id, 'legacy-id'); assert.equal(updated.overtimeMinutes, 123); assert.deepEqual((updated as typeof legacy).unknownMetadata, { preserve: true });
    await assert.rejects(saveAttendanceDay({ ...input, existingAbsence: { id: 'absence', active: true } as never }), /active absence/);
    console.log('PASS split persistence: exact totals, payroll boundary, retry, stale edit, historical schedule/rates, audit, zero-OT edit, adjacent evidence, legacy identity, absence conflict.');
  } finally { storage.mutateFirestoreDocumentWithReads = original; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
