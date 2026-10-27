import assert from 'node:assert/strict';
import { calculatePayrollDay } from '../lib/employee-payroll';
import { resolveCanonicalCrew, type CanonicalOperationsState } from '../lib/canonical-operations';
import { employeeVan } from '../lib/employee-work-schedule';
import { liveVanCrew, type LiveOperationalCapacityState } from '../lib/live-operational-capacity';
const employee = { id: 'synthetic-helper', name: 'Synthetic helper', active: true, employeeType: 'Técnico' };
const beforeA = { responsibleStaffId: 'driver-a', regularHelperId: employee.id, technicianIds: ['driver-a', employee.id] };
const afterA = { responsibleStaffId: 'driver-a', regularHelperId: 'other', technicianIds: ['driver-a', 'other'] };
const beforeB = { responsibleStaffId: 'driver-b', regularHelperId: 'other', technicianIds: ['driver-b', 'other'] };
const afterB = { responsibleStaffId: 'driver-b', regularHelperId: employee.id, technicianIds: ['driver-b', employee.id] };
function history(before: typeof beforeA, after: typeof afterA) { return [
  { effectiveFrom: '0001-01-01', value: before, at: '2026-10-26T16:00:00Z', actorId: 'synthetic-operator' },
  { effectiveFrom: '2026-10-26', value: after, at: '2026-10-26T16:00:00Z', actorId: 'synthetic-operator' },
]; }
const operations: CanonicalOperationsState = {
  staffProfiles: [employee, { id: 'other' }, { id: 'driver-a' }, { id: 'driver-b' }],
  vans: [{ id: 'legacy-a', name: 'Van 1', ...afterA, crewHistory: history(beforeA, afterA) }, { id: 'VAN-2', name: 'Van 2', ...afterB, crewHistory: history(beforeB, afterB) }],
  vanHalfDaySchedules: [{ id: 'a', vanId: 'VAN-1', weekday: 1, workdayStart: '08:00', workdayEnd: '13:00' }, { id: 'b', vanId: 'VAN-2', weekday: 2, workdayStart: '08:00', workdayEnd: '13:00' }],
  dailyVanAssignments: [], vanMaintenanceLogs: [], staffAbsences: [], calendarClosures: [], businessCalendar: { id: 'business-calendar', closedWeekdays: [0] },
};
const attendance = { timesheets: [], payrollSettings: [] };
for (const [date, hours] of [['2026-10-19', 5], ['2026-10-20', 8], ['2026-10-25', 0], ['2026-10-26', 8], ['2026-10-27', 5]] as const) {
  assert.equal(calculatePayrollDay({ employee, date, operations, attendance }).scheduledWorkHours, hours, date);
}
assert.equal(employeeVan(employee, operations.vans, '2026-10-19')?.id, 'legacy-a');
assert.equal(employeeVan(employee, operations.vans, '2026-10-26')?.id, 'VAN-2');
assert.equal(resolveCanonicalCrew(operations.vans[0], '2026-10-19', operations).helper?.id, employee.id);
assert.equal(resolveCanonicalCrew(operations.vans[1], '2026-10-26', operations).helper?.id, employee.id);
const live: LiveOperationalCapacityState = {
  vans: new Map(operations.vans.map((van, index) => [`VAN-${index + 1}`, { ...van, active: true, status: 'Disponible' }])),
  staffProfiles: operations.staffProfiles, dailyAssignments: [], halfDaySchedules: operations.vanHalfDaySchedules,
  calendarClosures: [], closedWeekdays: [0],
};
assert.equal(liveVanCrew(live, 'VAN-1', '2026-10-19').helperStaffId, employee.id);
assert.equal(liveVanCrew(live, 'VAN-2', '2026-10-26').helperStaffId, employee.id);
const saved = { id: `${employee.id}_2026-10-26`, employeeId: employee.id, employeeName: employee.name, updatedAt: '2026-10-26T16:00:00Z', date: '2026-10-26', scheduledWorkHours: 5,
  regularHours: 5, overtimeHours: 2, overtimeMinutes: 120, aoHours: 0, noWorkNoPayHours: 0, paidFreeHours: 0, status: 'Present', payrollPeriodId: '2026-09-27_2026-10-26' };
const day = calculatePayrollDay({ employee, date: saved.date, operations, attendance: { ...attendance, timesheets: [saved] } });
assert.equal(day.scheduledWorkHours, 5); assert.equal(day.regularHours, 5); assert.equal(day.overtime150Hours, 2); assert.equal(day.source, 'timesheet');
console.log('PASS Van transfer: historical/current schedule, partial day, Sunday closure and recorded payroll snapshots');
