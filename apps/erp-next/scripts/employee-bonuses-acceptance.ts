import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AuthPrincipal } from '../lib/security';
import type { EmployeePayrollSettings } from '../lib/employee-attendance';
import type { PayrollAdjustment, BonusDraft } from '../lib/employee-bonuses';

process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-demac-bonuses';
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'synthetic';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'synthetic';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'demo-demac-bonuses.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'demo-demac-bonuses.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '123';
const session = require('../lib/firebase/session');
session.requireFirebaseWebSession = async () => ({ idToken: 'synthetic' });
const rest = require('../lib/firebase/firestore-rest') as typeof import('../lib/firebase/firestore-rest');
const { payrollBonusReport, payrollBonusCsv, saveEmployeeBonus, voidEmployeeBonus } = require('../lib/employee-bonuses') as typeof import('../lib/employee-bonuses');
const { payrollPeriodBounds } = require('../lib/employee-attendance') as typeof import('../lib/employee-attendance');
const { buildPayrollAccountingPdf } = require('../lib/payroll-accounting-pdf') as typeof import('../lib/payroll-accounting-pdf');
const { summarizeEmployee, payrollPeriodFromDates } = require('../lib/employee-payroll') as typeof import('../lib/employee-payroll');
const principal: AuthPrincipal = { userId: 'synthetic-owner', displayName: 'Synthetic Owner', role: 'super_admin', active: true, capabilities: new Set(['payroll_sensitive.view']) };
const employees = [{ id: 'staff-one', name: 'Synthetic One', active: true }, { id: 'staff-two', name: 'Synthetic Two', active: true }];
const period = payrollPeriodBounds('2026-09-14');
const legacy: PayrollAdjustment = { id: 'legacy-bonus', employeeId: 'legacy-one', employeeName: 'Synthetic One', type: 'bonus', amountAfl: 100, date: '2026-09-14', concept: 'Legacy attendance award', payrollPeriodId: period.id, status: 'active', createdAt: '2026-09-14T12:00:00Z', updatedAt: '2026-09-14T12:00:00Z' };
const deduction: PayrollAdjustment = { ...legacy, id: 'legacy-deduction', type: 'deduction', amountAfl: 50 };
const database = new Map<string, EmployeePayrollSettings>([['legacy-one', { id: 'legacy-one', name: 'Synthetic One', weekdayHours: 8, weeklyHalfDayWeekday: 3, payrollAdjustments: [legacy, deduction] }]]);
const versions = new Map([['legacy-one', 1]]);
let patchCount = 0, denied = false, unknownOutcome = false;
let concurrentWrite: (() => void) | null = null;
const stamp = (id: string) => `2026-09-14T12:00:00.${String(versions.get(id) ?? 0).padStart(6, '0')}Z`;
const document = (id: string) => ({ name: `projects/demo-demac-bonuses/databases/(default)/documents/employeePayrollSettings/${id}`, fields: rest.encodeFirestoreFields(database.get(id) as unknown as Record<string, unknown>), updateTime: stamp(id) });
const reply = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (request, init) => {
  const url = new URL(String(request)), id = decodeURIComponent(url.pathname.split('/').at(-1)!);
  assert.equal(url.hostname, 'firestore.googleapis.com');
  assert.match(url.pathname, /projects\/demo-demac-bonuses\/databases\/\(default\)\/documents\/employeePayrollSettings\//);
  if (denied) return reply({ error: { status: 'PERMISSION_DENIED', message: 'Synthetic rules denial' } }, 403);
  if (init?.method !== 'PATCH') return database.has(id) ? reply(document(id)) : reply({}, 404);
  patchCount += 1;
  if (concurrentWrite) { const run = concurrentWrite; concurrentWrite = null; run(); }
  if ((database.has(id) && url.searchParams.get('currentDocument.updateTime') !== stamp(id)) || (!database.has(id) && url.searchParams.get('currentDocument.exists') !== 'false')) return reply({ error: { status: 'FAILED_PRECONDITION', message: 'Version changed' } }, 409);
  const changes = rest.decodeFirestoreFields(JSON.parse(String(init.body)).fields);
  assert.deepEqual(url.searchParams.getAll('updateMask.fieldPaths').sort(), Object.keys(changes).sort());
  database.set(id, { ...database.get(id), ...changes, id }); versions.set(id, (versions.get(id) ?? 0) + 1);
  if (unknownOutcome) { unknownOutcome = false; throw new Error('Connection lost after commit'); }
  return reply(document(id));
};
const settings = () => [...database.values()];
const draft = (id: string, employeeId = 'staff-one', category: BonusDraft['category'] = 'service_sales'): BonusDraft => ({ id, employeeId, date: '2026-09-14', amount: '25.50', category, concept: 'Approved service sales commission' });
const save = (value: BonusDraft, actor = principal) => saveEmployeeBonus({ employee: employees.find((item) => item.id === value.employeeId)!, employees, settings: settings(), period, draft: value, principal: actor });

async function main() {
  let report = payrollBonusReport(settings(), employees, period);
  assert.equal(report.total, 100); assert.equal(report.byEmployee['staff-one'], 100); assert.deepEqual(report.issues, []);
  assert.equal(payrollBonusReport(settings(), employees, payrollPeriodBounds('2026-09-27')).total, 0);
  await save(draft('one'));
  assert.equal(database.size, 1, 'Legacy settings are reused, not duplicated');
  assert.equal(database.get('legacy-one')!.weeklyHalfDayWeekday, 3);
  assert.deepEqual(database.get('legacy-one')!.payrollAdjustments![1], deduction, 'Deductions remain byte-for-byte unchanged');
  const beforeRetry = patchCount; await save(draft('one')); assert.equal(patchCount, beforeRetry, 'Exact replay performs no second write');
  await assert.rejects(save({ ...draft('one'), amount: '26.00' }), /different details/);
  for (const amount of ['', '0', '-1', 'Infinity', 'NaN', '1.001', '1e3', '9'.repeat(40)]) await assert.rejects(save({ ...draft('invalid'), amount }), /positive Afl/);
  for (const date of ['2026-08-26', '2026-09-27', '2026-02-30']) await assert.rejects(save({ ...draft('invalid'), date }));
  await assert.rejects(save({ ...draft('invalid'), concept: '  ' }), /concept/);
  await assert.rejects(save(draft('unauthorized'), { ...principal, role: 'technician', capabilities: new Set() }), /restricted/);
  await assert.rejects(save(draft('inactive'), { ...principal, active: false }), /restricted/);
  denied = true; await assert.rejects(save(draft('denied')), /Synthetic rules denial/); denied = false;
  assert.equal(database.get('legacy-one')!.payrollAdjustments!.length, 3);

  concurrentWrite = () => {
    const record = database.get('legacy-one')!;
    database.set('legacy-one', { ...record, weeklyHalfDayWeekday: 5, payrollAdjustments: [...record.payrollAdjustments!, { ...legacy, id: 'concurrent', amountAfl: 10, concept: 'Other approved award' }] });
    versions.set('legacy-one', versions.get('legacy-one')! + 1);
  };
  await save(draft('race'));
  assert.equal(database.get('legacy-one')!.weeklyHalfDayWeekday, 5);
  assert.deepEqual(database.get('legacy-one')!.payrollAdjustments!.map((item) => item.id), ['legacy-bonus', 'legacy-deduction', 'one', 'concurrent', 'race']);
  unknownOutcome = true;
  await assert.rejects(save(draft('unknown')), /Connection lost/);
  await save(draft('unknown'));
  assert.equal(database.get('legacy-one')!.payrollAdjustments!.filter((item) => item.id === 'unknown').length, 1);
  for (const category of ['perfect_attendance', 'achievement', 'service_sales', 'equipment_sales', 'other'] as const) await save(draft(`category-${category}`, 'staff-two', category));
  assert.equal(database.size, 2);
  assert.equal(database.get('staff-two')!.sourceStaffId, 'staff-two');

  report = payrollBonusReport(settings(), employees, period);
  const cancelling = report.bonuses.find((item) => item.id === 'legacy-bonus')!;
  await assert.rejects(voidEmployeeBonus({ bonus: { ...cancelling, amountAfl: 999 }, employee: employees[0], principal, reason: 'Stale amount' }), /details changed/);
  await assert.rejects(voidEmployeeBonus({ bonus: cancelling, employee: employees[0], principal, reason: '' }), /cancellation reason/);
  await voidEmployeeBonus({ bonus: cancelling, employee: employees[0], principal, reason: 'Duplicate legacy award' });
  await voidEmployeeBonus({ bonus: cancelling, employee: employees[0], principal, reason: 'Repeated cancellation' });
  const cancelled = database.get('legacy-one')!.payrollAdjustments![0];
  assert.equal(cancelled.status, 'voided'); assert.equal(cancelled.voidReason, 'Duplicate legacy award'); assert.equal(cancelled.voidedByUserId, principal.userId);
  report = payrollBonusReport(settings(), employees, period);
  assert.equal(report.byEmployee['staff-one'], 86.5); assert.equal(report.byEmployee['staff-two'], 127.5); assert.equal(report.total, 214);
  assert.match(report.detailsByEmployee['staff-two'], /Air Conditioner Sales/);
  assert.doesNotMatch(report.detailsByEmployee['staff-one'], /Legacy attendance award/);
  const csv = payrollBonusCsv(report.bonuses); assert.match(csv, /voided/); assert.match(csv, /Duplicate legacy award/); assert.match(csv, /25.50/);
  assert.match(payrollBonusCsv([{ ...report.bonuses[0], concept: '=1+1' }]), /"'=1\+1"/);
  const ambiguous = [{ id: 'old', name: 'Repeated', payrollAdjustments: [{ ...legacy, employeeId: 'old' }] }];
  assert.equal(payrollBonusReport(ambiguous, [{ id: 'a', name: 'Repeated' }, { id: 'b', name: 'Repeated' }], period).issues.length, 1);
  assert.equal(payrollBonusReport([{ ...database.get('legacy-one')!, sourceStaffId: 'wrong-identity' }], employees, period).total, 0);

  const operations = { staffProfiles: employees, vans: [], vanHalfDaySchedules: [], staffAbsences: [] } as unknown as import('../lib/canonical-operations').CanonicalOperationsState;
  const attendance = { payrollSettings: settings(), timesheets: [], advances: [] };
  const payrollPeriod = payrollPeriodFromDates(period.start, period.end);
  const summaries = employees.map((employee) => summarizeEmployee({ employee, period: payrollPeriod, operations, attendance }));
  const pdf = buildPayrollAccountingPdf({ periodLabel: payrollPeriod.label, summaries, bonusesByEmployee: report.byEmployee, advancesByEmployee: { 'staff-one': 40 } });
  const text = Buffer.from(pdf).toString('latin1');
  assert.match(text, /Bonuses/); assert.match(text, /Afl. 214.00/); assert.match(text, /Afl. 40.00/);
  const withoutBonuses = employees.map((employee) => summarizeEmployee({ employee, period: payrollPeriod, operations, attendance: { ...attendance, payrollSettings: settings().map(({ payrollAdjustments: _ignored, ...item }) => item) } }));
  assert.deepEqual(summaries, withoutBonuses, 'Bonuses do not change any attendance/payroll hour value');
  if (process.env.BONUS_TEST_OUTPUT) {
    fs.mkdirSync(process.env.BONUS_TEST_OUTPUT, { recursive: true });
    const twelve = Array.from({ length: 12 }, (_, index) => ({ ...summaries[index % 2], employee: { ...employees[index % 2], id: `synthetic-${index}`, name: `Synthetic Employee ${index + 1} Long Surname` } }));
    const amounts = Object.fromEntries(twelve.map((item, i) => [item.employee.id, i * 100.25]));
    fs.writeFileSync(`${process.env.BONUS_TEST_OUTPUT}/accounting-bonuses.pdf`, buildPayrollAccountingPdf({ periodLabel: payrollPeriod.label, summaries: twelve, advancesByEmployee: amounts, bonusesByEmployee: amounts }));
  }
  console.log('PASS bonuses: legacy compatibility, identity, 27–26 periods, five categories, validation, denied writes, version conflicts, unknown outcomes, cancellation, CSV/PDF totals and unchanged hours.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
