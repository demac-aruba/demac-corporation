import assert from 'node:assert/strict';
import type { AuthPrincipal } from '../lib/security';
import type { EmployeeSalaryAdvance, EmployeePayrollSettings } from '../lib/employee-attendance';
import type { BonusDraft } from '../lib/employee-bonuses';

process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'false';
for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) process.env['NEXT_PUBLIC_FIREBASE_' + key] = 'demo-payroll-corrections';
require('../lib/firebase/session').requireFirebaseWebSession = async () => ({ idToken: 'synthetic' });
const rest = require('../lib/firebase/firestore-rest') as typeof import('../lib/firebase/firestore-rest');
const { payrollPeriodBounds } = require('../lib/employee-attendance') as typeof import('../lib/employee-attendance');
const { correctSalaryAdvance, activeSalaryAdvance } = require('../lib/employee-advances') as typeof import('../lib/employee-advances');
const { correctEmployeeBonus, payrollBonusReport } = require('../lib/employee-bonuses') as typeof import('../lib/employee-bonuses');
const principal: AuthPrincipal = { userId: 'operator-two', displayName: 'Synthetic Editor', active: true, role: 'finance', capabilities: new Set(['payroll_sensitive.view']) };
const employee = { id: 'staff-one', name: 'Synthetic Employee', active: true };
const period = payrollPeriodBounds('2026-11-10');
const advance: EmployeeSalaryAdvance = { id: 'advance-one', recordType: 'salaryAdvance', employeeId: employee.id, employeeName: employee.name,
  amount: 100, date: '2026-11-10', payrollPeriodId: period.id, method: 'Cash', reference: 'test', notes: 'Original note',
  createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z', recordedByName: 'Synthetic Creator', recordedByUserId: 'operator-one' };
const bonus = { id: 'bonus-one', type: 'bonus' as const, employeeId: employee.id, employeeName: employee.name, date: advance.date,
  payrollPeriodId: period.id, amountAfl: 200, category: 'achievement' as const, concept: 'Original award', status: 'active' as const,
  createdAt: advance.createdAt, updatedAt: advance.updatedAt, createdByUserId: 'operator-one', createdByName: 'Synthetic Creator' };
const deduction = { ...bonus, id: 'deduction-one', type: 'deduction' as const, amountAfl: 50 };
const db = new Map<string, any>([[advance.id, structuredClone(advance)], [employee.id, { id: employee.id, sourceStaffId: employee.id, weeklyHalfDayWeekday: 2, payrollAdjustments: [bonus, deduction] }]]);
const versions = new Map<string, number>();
let patches = 0, denied = false, loseResponse = false, concurrent: (() => void) | null = null;
const stamp = (id: string) => `2026-11-10T12:00:00.${String(versions.get(id) ?? 0).padStart(6, '0')}Z`;
const document = (id: string) => ({ name: `projects/demo-payroll-corrections/databases/(default)/documents/employeePayrollSettings/${id}`, fields: rest.encodeFirestoreFields(db.get(id)), updateTime: stamp(id) });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
globalThis.fetch = async (url, init) => {
  const parsed = new URL(String(url));
  assert.equal(parsed.hostname, 'firestore.googleapis.com'); assert.match(parsed.pathname, /projects\/demo-payroll-corrections\//);
  if (denied) return reply({ error: { status: 'PERMISSION_DENIED', message: 'Synthetic permission denial' } }, 403);
  const body = JSON.parse(String(init?.body));
  if (parsed.pathname.endsWith(':batchGet')) return reply(body.documents.map((name: string) => {
    const id = name.split('/').at(-1)!; return db.has(id) ? { found: document(id) } : { missing: name };
  }));
  assert.ok(parsed.pathname.endsWith(':commit')); assert.equal(body.writes.length, 1);
  const write = body.writes[0], id = write.update.name.split('/').at(-1)!;
  patches++;
  if (concurrent) { const hook = concurrent; concurrent = null; hook(); }
  if (write.currentDocument.updateTime !== stamp(id)) return reply({ error: { status: 'FAILED_PRECONDITION', message: 'Version conflict' } }, 409);
  const changes = rest.decodeFirestoreFields(write.update.fields);
  assert.deepEqual(write.updateMask.fieldPaths.sort(), Object.keys(changes).sort());
  db.set(id, { ...db.get(id), ...changes }); versions.set(id, (versions.get(id) ?? 0) + 1);
  if (loseResponse) { loseResponse = false; throw new Error('Lost response after commit'); }
  return reply({ commitTime: stamp(id) });
};

const correction = (requestId: string, action: 'edit' | 'delete' = 'edit') => ({ requestId, action, reason: 'Corrected test input', principal });
const advanceDraft = { date: advance.date, amount: '125.50', method: 'Bank Transfer' as const, reference: '', notes: 'Updated note' };
const currentAdvance = () => structuredClone(db.get(advance.id)) as EmployeeSalaryAdvance;
const settings = () => [structuredClone(db.get(employee.id))] as EmployeePayrollSettings[];
const currentBonus = (date = advance.date) => payrollBonusReport(settings(), [employee], payrollPeriodBounds(date)).bonuses.find((item) => item.id === bonus.id)!;
const bonusDraft: Pick<BonusDraft, 'date' | 'amount' | 'category' | 'concept'> = { date: advance.date, amount: '250.25', category: 'service_sales', concept: 'Corrected award' };

async function main() {
  assert.equal(activeSalaryAdvance(advance), true, 'Pre-status historical records count');
  assert.equal(activeSalaryAdvance({ ...advance, status: 'voided' }), false);
  const before = structuredClone([...db]);
  for (const actor of [{ ...principal, role: 'technician' as const, capabilities: new Set<never>() }, { ...principal, active: false }]) {
    await assert.rejects(correctSalaryAdvance({ advance, draft: advanceDraft, correction: { ...correction('denied'), principal: actor } }), /restricted/);
    await assert.rejects(correctEmployeeBonus({ bonus: currentBonus(), employee, draft: bonusDraft, correction: { ...correction('denied'), principal: actor } }), /restricted/);
  }
  for (const amount of ['0', '-1', '1.001', 'NaN', 'Infinity', '1e3', '999999999999999999']) {
    await assert.rejects(correctSalaryAdvance({ advance, draft: { ...advanceDraft, amount }, correction: correction('invalid') }), /positive Afl/);
    await assert.rejects(correctEmployeeBonus({ bonus: currentBonus(), employee, draft: { ...bonusDraft, amount }, correction: correction('invalid') }), /positive Afl/);
  }
  for (const date of ['', '2026-02-30', '2026-13-01', 'bad']) {
    await assert.rejects(correctSalaryAdvance({ advance, draft: { ...advanceDraft, date }, correction: correction('invalid') }), /valid date/);
    await assert.rejects(correctEmployeeBonus({ bonus: currentBonus(), employee, draft: { ...bonusDraft, date }, correction: correction('invalid') }), /valid date/);
  }
  for (const action of ['edit', 'delete'] as const) {
    await assert.rejects(correctSalaryAdvance({ advance, draft: advanceDraft, correction: { ...correction('reason', action), reason: ' ' } }), /reason/);
    await assert.rejects(correctEmployeeBonus({ bonus: currentBonus(), employee, draft: bonusDraft, correction: { ...correction('reason', action), reason: ' ' } }), /reason/);
  }
  denied = true;
  await assert.rejects(correctSalaryAdvance({ advance, draft: advanceDraft, correction: correction('server-denied') }), /PERMISSION_DENIED/);
  await assert.rejects(correctEmployeeBonus({ bonus: currentBonus(), employee, draft: bonusDraft, correction: correction('server-denied') }), /PERMISSION_DENIED/);
  denied = false;
  assert.deepEqual([...db], before); assert.equal(patches, 0);

  const edit = { advance, draft: advanceDraft, correction: correction('advance-edit') };
  loseResponse = true;
  await assert.rejects(correctSalaryAdvance(edit), /Lost response/);
  const retried = await correctSalaryAdvance(edit);
  assert.equal(patches, 1); assert.equal(retried.amount, 125.5); assert.equal(retried.reference, '');
  assert.equal(retried.recordedByName, advance.recordedByName); assert.equal(retried.createdAt, advance.createdAt);
  assert.equal(retried.changeHistory!.length, 1); assert.equal(retried.changeHistory![0].before.amount, 100);
  assert.equal(retried.changeHistory![0].after.amount, 125.5); assert.equal(retried.changeHistory![0].actorName, principal.displayName);
  await assert.rejects(correctSalaryAdvance({ ...edit, draft: { ...advanceDraft, amount: '500' } }), /different details/);
  await assert.rejects(correctSalaryAdvance({ ...edit, correction: correction('stale-edit') }), /details changed/);
  await assert.rejects(correctSalaryAdvance({ advance: currentAdvance(), draft: advanceDraft, correction: correction('noop') }), /at least one/);
  const changedPeriod = await correctSalaryAdvance({ advance: currentAdvance(), draft: { ...advanceDraft, date: '2026-11-27' }, correction: correction('advance-period') });
  assert.equal(changedPeriod.payrollPeriodId, payrollPeriodBounds('2026-11-27').id);
  assert.equal((await correctSalaryAdvance(edit)).date, '2026-11-27', 'Old exact replay returns latest state without overwriting');
  assert.equal(currentAdvance().changeHistory!.length, 2);
  const deletingAdvance = { advance: currentAdvance(), correction: correction('advance-delete', 'delete') };
  await correctSalaryAdvance(deletingAdvance); await correctSalaryAdvance(deletingAdvance);
  const deleted = currentAdvance(); assert.equal(activeSalaryAdvance(deleted), false); assert.equal(deleted.changeHistory!.length, 3);
  assert.equal(deleted.amount, 125.5); assert.equal(deleted.voidedByName, principal.displayName); assert.equal(deleted.voidReason, 'Corrected test input');
  await assert.rejects(correctSalaryAdvance({ advance: deleted, draft: advanceDraft, correction: correction('revive') }), /Deleted/);
  assert.equal([deleted].filter(activeSalaryAdvance).reduce((sum, item) => sum + item.amount, 0), 0);

  const originalBonus = currentBonus();
  const bonusEdit = { bonus: originalBonus, employee, draft: bonusDraft, correction: correction('bonus-edit') };
  concurrent = () => { const item = db.get(employee.id); item.weeklyHalfDayWeekday = 4; item.payrollAdjustments.push({ ...bonus, id: 'other-award', amountAfl: 10 }); versions.set(employee.id, 1); };
  await correctEmployeeBonus(bonusEdit);
  assert.equal(db.get(employee.id).weeklyHalfDayWeekday, 4); assert.deepEqual(db.get(employee.id).payrollAdjustments[1], deduction);
  assert.equal(currentBonus().amountAfl, 250.25); assert.equal(currentBonus().createdByName, bonus.createdByName);
  assert.equal(currentBonus().changeHistory!.length, 1); assert.equal(currentBonus().changeHistory![0].before.amount, 200);
  assert.equal(payrollBonusReport(settings(), [employee], period).total, 260.25);
  const beforeBonusReplay = patches; await correctEmployeeBonus(bonusEdit); assert.equal(patches, beforeBonusReplay);
  await assert.rejects(correctEmployeeBonus({ ...bonusEdit, correction: correction('bonus-stale-delete', 'delete') }), /details changed/);
  const latest = currentBonus();
  concurrent = () => { db.get(employee.id).payrollAdjustments[0].category = 'equipment_sales'; versions.set(employee.id, 3); };
  await assert.rejects(correctEmployeeBonus({ bonus: latest, employee, draft: { ...bonusDraft, amount: '300' }, correction: correction('category-race') }), /details changed/);
  assert.equal(currentBonus().amountAfl, 250.25);
  const move = { bonus: currentBonus(), employee, draft: { ...bonusDraft, date: '2026-11-27' }, correction: correction('bonus-period') };
  loseResponse = true; await assert.rejects(correctEmployeeBonus(move), /Lost response/); await correctEmployeeBonus(move);
  assert.equal(payrollBonusReport(settings(), [employee], period).total, 10);
  assert.equal(payrollBonusReport(settings(), [employee], payrollPeriodBounds('2026-11-27')).total, 250.25);
  const deletingBonus = { bonus: currentBonus('2026-11-27'), employee, correction: correction('bonus-delete', 'delete') };
  await correctEmployeeBonus(deletingBonus); await correctEmployeeBonus(deletingBonus);
  assert.equal(currentBonus('2026-11-27').changeHistory!.length, 3);
  assert.equal(payrollBonusReport(settings(), [employee], payrollPeriodBounds('2026-11-27')).total, 0);
  assert.deepEqual(db.get(employee.id).payrollAdjustments[1], deduction);
  await assert.rejects(correctEmployeeBonus({ bonus: currentBonus('2026-11-27'), employee, draft: bonusDraft, correction: correction('revive-bonus') }), /Deleted/);
  db.set(advance.id, { ...advance, updatedAt: '2026-11-10T12:00:00Z' });
  await correctSalaryAdvance({ advance: { ...advance, updatedAt: '2026-11-10T12:00:00.000Z' }, draft: advanceDraft, correction: correction('timestamp-normalization') });
  assert.equal(currentAdvance().amount, 125.5);
  db.set(advance.id, { ...advance, changeHistory: 'corrupt' });
  await assert.rejects(correctSalaryAdvance({ advance, draft: advanceDraft, correction: correction('corrupt-history') }), /Invalid correction history/);
  db.set(advance.id, { ...advance, employeeId: 'other-employee' });
  await assert.rejects(correctSalaryAdvance({ advance, draft: advanceDraft, correction: correction('wrong-owner') }), /no longer matches/);
  db.delete(advance.id);
  await assert.rejects(correctSalaryAdvance({ advance, draft: advanceDraft, correction: correction('missing-target') }), /no longer matches/);
  console.log('PASS payroll corrections: edit/delete/history, creator preservation, reasons, 27–26 moves, monetary validation, permission denial, independent write preservation, stale category/target conflicts, lost responses, exact/altered replay, no-op and terminal states.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
