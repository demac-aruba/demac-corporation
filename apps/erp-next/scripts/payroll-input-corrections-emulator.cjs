// Real Firebase Auth + Firestore Rules authorization for the correction write paths.
// Only the synthetic loopback demo project from attendance-emulator is accepted.
const assert = require('node:assert/strict');
const em = require('./test-support/attendance-emulator.cjs');
em.configure();
process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'false';
const root = '../.payroll-input-corrections-test/apps/erp-next/lib/';
let user, beforePatch = null, loseResponse = false;
require(root + 'firebase/session').requireFirebaseWebSession = async () => ({ idToken: user.idToken });
const rest = require(root + 'firebase/firestore-rest');
const { correctSalaryAdvance } = require(root + 'employee-advances');
const { correctEmployeeBonus } = require(root + 'employee-bonuses');
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
  const destination = em.destination(url);
  if (String(url).endsWith(':commit') && beforePatch) { const hook = beforePatch; beforePatch = null; await hook(); }
  const response = await realFetch(destination, init);
  if (String(url).endsWith(':commit') && loseResponse && response.ok) { loseResponse = false; throw Error('Synthetic lost response'); }
  return response;
};
const employee = { id: 'employee-one', name: 'Synthetic Employee' };
const period = '2026-10-27_2026-11-26';
const advance = { id: 'advance-one', recordType: 'salaryAdvance', employeeId: employee.id, employeeName: employee.name, date: '2026-11-10', payrollPeriodId: period,
  amount: 100, method: 'Cash', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z', recordedByName: 'Synthetic Creator' };
const bonus = { id: 'bonus-one', type: 'bonus', employeeId: employee.id, employeeName: employee.name, date: advance.date, payrollPeriodId: period,
  amountAfl: 50, category: 'achievement', concept: 'Original award', status: 'active', createdAt: advance.createdAt, updatedAt: advance.updatedAt };
const bonusTarget = { ...bonus, canonicalEmployeeId: employee.id, settingsId: employee.id };
const path = id => 'employeePayrollSettings/' + id;
const get = id => em.get(rest, path(id));
async function seed() { await em.seed(rest, path(advance.id), advance); await em.seed(rest, path(employee.id), { id: employee.id, sourceStaffId: employee.id, payrollAdjustments: [bonus], weeklyHalfDayWeekday: 2 }); }
const principal = () => ({ userId: user.uid, displayName: 'Synthetic Operator', active: true, role: 'super_admin', capabilities: new Set(['payroll_sensitive.view']) });
const correction = id => ({ requestId: id, action: 'delete', reason: 'Remove synthetic test', principal: principal() });
async function main() {
  await em.reset();
  const admin = await em.account(rest, 'correction-admin', 'admin');
  const accounting = await em.account(rest, 'correction-accounting', 'accounting');
  const office = await em.account(rest, 'correction-office', 'office');
  const tech = await em.account(rest, 'correction-tech', 'technician');
  const inactive = await em.account(rest, 'correction-inactive', 'admin', false);
  const unprovisioned = await em.account(rest, 'correction-unprovisioned', 'admin');
  await em.remove('users/' + unprovisioned.uid);
  for (const actor of [admin, accounting]) {
    user = actor; await seed();
    await correctSalaryAdvance({ advance, correction: correction('advance-delete') });
    await correctEmployeeBonus({ bonus: bonusTarget, employee, correction: correction('bonus-delete') });
    assert.equal((await get(advance.id)).status, 'voided');
    assert.equal((await get(employee.id)).payrollAdjustments[0].status, 'voided');
    assert.equal((await get(advance.id)).changeHistory[0].actorId, actor.uid);
    assert.equal((await get(employee.id)).weeklyHalfDayWeekday, 2);
  }
  await seed();
  for (const actor of [office, tech, inactive, unprovisioned]) {
    user = actor;
    await assert.rejects(correctSalaryAdvance({ advance, correction: correction('forbidden') }), /permission|PERMISSION|unauthenticated/i);
    await assert.rejects(correctEmployeeBonus({ bonus: bonusTarget, employee, correction: correction('forbidden') }), /permission|PERMISSION|unauthenticated/i);
    assert.equal((await get(advance.id)).amount, 100); assert.equal((await get(advance.id)).changeHistory, undefined);
    assert.equal((await get(employee.id)).payrollAdjustments[0].status, 'active');
  }
  user = { uid: 'anonymous', idToken: 'not-a-valid-token' };
  await assert.rejects(correctSalaryAdvance({ advance, correction: correction('anonymous') }), /permission|PERMISSION|unauthenticated|invalid/i);
  user = admin;
  beforePatch = () => em.seed(rest, 'users/' + admin.uid, { role: 'admin', active: false });
  await assert.rejects(correctSalaryAdvance({ advance, correction: correction('revoked') }), /permission|PERMISSION/i);
  assert.equal((await get(advance.id)).changeHistory, undefined);
  await em.seed(rest, 'users/' + admin.uid, { role: 'admin', active: true });
  const request = { advance, correction: correction('lost-response') };
  loseResponse = true; await assert.rejects(correctSalaryAdvance(request), /lost response/);
  await correctSalaryAdvance(request);
  assert.equal((await get(advance.id)).changeHistory.length, 1);
  console.log('PASS emulator: actual Rules allow admin/accounting; deny office, technician, inactive, unprovisioned, invalid token, and access revoked before commit; exact committed retry retains one audit event.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
