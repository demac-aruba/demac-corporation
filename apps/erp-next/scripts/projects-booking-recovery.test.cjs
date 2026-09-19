'use strict';
// Test the actual TS modules. Full typechecking remains a separate CI gate.
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', { paths: [path.resolve(__dirname, '..'), process.env.TS_TEST_TOOLS || ''] }));
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProjectBookingRecovery } = require('../lib/projects/booking-recovery.ts');
const { OfficeBookingResponseError } = require('../lib/office-booking-errors.ts');
const { centralChoice, centralSlotPlan, centralBudgetForecast } = require('../lib/projects/scheduling-choice.ts');
const UID = 'USER-TEST';
function fixture() {
  const expectation = { actorId: UID, selection: { projectId: 'PROJECT-TEST', phaseId: null, expectedVersion: 2 }, customerId: 'CLIENT-TEST', propertyId: 'PROPERTY-TEST', offerId: 'OFFER-TEST', offerVersion: 1, optionId: 'OPTION-TEST', mode: 'confirmed' };
  const command = { requestId: 'SAME-REQUEST-TEST', offerId: expectation.offerId, offerVersion: 1, optionId: expectation.optionId };
  const workOrderIds = ['WORK-A', 'WORK-B'];
  const result = { success: true, createMode: 'confirmed', appointmentId: 'APPOINTMENT-TEST', workOrderIds,
    appointment: { appointmentId: 'APPOINTMENT-TEST', customerId: expectation.customerId, propertyId: expectation.propertyId, status: 'confirmed', offerId: expectation.offerId, offerVersion: 1, selectedOptionId: expectation.optionId, workOrderIds: [...workOrderIds], projectContext: { schemaVersion: 1, ...expectation.selection, actorId: UID } } };
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const recovery = send => createProjectBookingRecovery({ storage, uid: UID, authorized: () => true, send });
  return { expectation, command, result, data, storage, recovery };
}
test('verified all-Work-Order acknowledgement clears only its pending intent', async () => {
  const f = fixture(); const c = f.recovery(async () => f.result);
  const r = await c.start(f); assert.equal(r.workOrderIds.length, 2); assert.equal(c.pending(), null); assert.equal(f.data.size, 0);
});
test('lost response, changed form, reload and exact retry do not produce replacement commands', async () => {
  const f = fixture(); let calls = 0; let original;
  const c = f.recovery(async (mode, cmd) => { calls++; original = JSON.stringify(cmd); throw Error('body interrupted'); });
  await assert.rejects(c.start({ command: f.command, expectation: f.expectation })); f.command.optionId = 'CHANGED';
  await assert.rejects(c.start({ command: f.command, expectation: f.expectation })); assert.equal(calls, 1);
  const retry = f.recovery(async (mode, cmd) => { calls++; assert.equal(JSON.stringify(cmd), original); return { ...f.result, replayed: true }; });
  assert.equal(calls, 1); assert.equal((await retry.retry()).replayed, true); assert.equal(calls, 2); assert.equal(f.data.size, 0);
});
test('first atomic version rejection releases a new intent, without claiming any worked hours', async () => {
  const f = fixture(); const c = f.recovery(async () => { throw new OfficeBookingResponseError('stale', 409, 'invalid_request', 'version_conflict'); });
  await assert.rejects(c.start(f)); assert.equal(c.pending(), null); assert.equal(f.data.size, 0);
});
test('authentication or an unknown failure after commit must retain recovery evidence', async () => {
  const f = fixture(); const c = f.recovery(async () => { throw new OfficeBookingResponseError('expired', 401, 'unauthenticated'); });
  await assert.rejects(c.start(f)); assert.ok(c.pending());
});
test('later definite rejection cannot erase an earlier unknown result', async () => {
  const f = fixture(); let count = 0; const c = f.recovery(async () => { if (++count === 1) throw Error('lost'); throw new OfficeBookingResponseError('stale', 409, 'slot_conflict'); });
  await assert.rejects(c.start(f)); await assert.rejects(c.retry()); assert.ok(c.pending());
});
test('bad or incomplete acknowledgement is never shown as linked', async () => {
  for (const patch of [{ workOrderIds: ['WORK-A'] }, { appointmentId: 'WRONG' }, { success: false }]) {
    const f = fixture(); const c = f.recovery(async () => ({ ...f.result, ...patch })); await assert.rejects(c.start(f)); assert.ok(c.pending());
  }
});
test('storage unavailable prevents the network write', async () => {
  const f = fixture(); let sent = 0; f.storage.setItem = () => { throw Error('storage'); }; const c = f.recovery(async () => { sent++; return f.result; });
  await assert.rejects(c.start(f)); assert.equal(sent, 0);
});
test('cleanup failure retains a verified original request for idempotent replay', async () => {
  const f = fixture(); f.storage.removeItem = () => { throw Error('storage'); }; const c = f.recovery(async () => f.result);
  await assert.rejects(c.start(f)); assert.ok(c.pending());
});
test('another user cannot submit or see the original user pending record', async () => {
  const f = fixture(); const c = f.recovery(async () => { throw Error('unknown'); }); await assert.rejects(c.start(f));
  const other = createProjectBookingRecovery({ storage: f.storage, uid: 'OTHER', authorized: () => false, send: () => assert.fail() });
  assert.equal(other.pending(), null); await assert.rejects(other.start(f)); assert.equal(f.data.size, 1);
});
test('concurrent controller cannot overwrite an already-journaled request', async () => {
  const f = fixture(); const first = f.recovery(async () => { throw Error('unknown'); }); const second = f.recovery(async () => assert.fail());
  await assert.rejects(first.start(f)); await assert.rejects(second.start(f), /another view/); assert.equal(f.data.size, 1);
});
test('corrupt saved intent blocks recovery without deleting bytes', () => {
  const f = fixture(); f.data.set('demac.projects.booking.pending.v1:' + UID, '{bad'); assert.throws(() => f.recovery(async () => assert.fail())); assert.equal(f.data.size, 1);
});
test('central planning choices do not synthesize local actuals or cap against budget', () => {
  const p = { id: 'PROJECT', projectNumber: 'PRJ-T', name: 'Test', type: 'VRF Project', schemaVersion: 1, version: 2, customerId: 'CLIENT', propertyId: 'PROPERTY', planningStatus: 'Planned', phases: [], budget: { unit: 'van_minutes', currentMinutes: 180, originalMinutes: 3960 } };
  const choice = centralChoice(p); assert.equal(choice.actualLaborHours, undefined); assert.equal(choice.scheduledFutureHours, undefined);
  const plan = centralSlotPlan(choice, 6); assert.equal(plan.scheduledHours, 6); assert.equal(plan.remainingHoursBefore, null); assert.equal(p.budget.currentMinutes, 180);
  assert.throws(() => centralSlotPlan(choice, 0)); assert.throws(() => centralSlotPlan(choice, 6.5));
});
test('full allocation forecast shows 66/63/+6=69; partial and stale evidence stays unknown', () => {
  const p = { id: 'PROJECT', version: 2, budget: { currentMinutes: 3960 } };
  const activity = { projectId: p.id, projectVersion: 2, coverage: { pageIsValid: true, allProjectLinksIncluded: true }, projectForecast: { budgetMinutes: 3960, plannedMinutes: 3780 } };
  assert.deepEqual(centralBudgetForecast(activity, p, 360), { budgetMinutes: 3960, priorMinutes: 3780, totalMinutes: 4140, overMinutes: 180 });
  assert.equal(centralBudgetForecast({ ...activity, projectVersion: 1 }, p, 360), null);
  assert.equal(centralBudgetForecast({ ...activity, coverage: { pageIsValid: true, allProjectLinksIncluded: false } }, p, 360), null);
  assert.equal(centralBudgetForecast(null, p, 360), null);
});

test('imported planning slot duration is preserved instead of silently changed to an hour', () => {
  const plan = { id: 'PROJECT', schemaVersion: 1, version: 1, phases: [], budget: { unit: 'van_minutes', currentMinutes: 180 }, details: { scheduleEstimate: { slotMinutes: 30, slotsPerDay: 6 } } };
  assert.equal(centralSlotPlan(centralChoice(plan), 6).scheduledHours, 3);
  assert.throws(() => centralChoice({ ...plan, details: { scheduleEstimate: { slotMinutes: -1, slotsPerDay: 6 } } }));
});
