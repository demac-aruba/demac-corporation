'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { createOfficeBookingAuthorityFacade, recoveryInspectionError } = require('./officeBookingAuthorityFacade');
const ACTION = 'inspect_maya_recovery_candidates';
const DATA = { cancelledAppointmentId: 'cancelled-future' };
function database(profile) {
  return new MemoryDb({
    users: profile === null ? [] : [{ id: 'office', ...profile }],
    businessSettings: [{ id: 'whatsapp', communicationAccountId: 'controlled-account' }],
    appointments: [{ id: 'cancelled-future', status: 'cancelled', cancelledAtIso: '2026-01-01T12:00:00Z',
      date: '2098-12-22', startTime: '09:30', endTime: '10:30',
      assignments: [{ vanId: 'VAN-1', role: 'primary', time: '09:30' }], capacityLockIds: ['controlled-capacity'] }],
  });
}
function request(data = DATA) {
  return { method: 'POST', headers: { authorization: 'Bearer controlled-test' }, body: { action: ACTION, data } };
}
function api(db, tokenRole = 'admin') {
  return createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: 'office', role: tokenRole }) });
}
for (const [name, profile] of [
  ['absent profile', null], ['inactive profile', { active: false, role: 'admin' }],
  ['missing active state', { role: 'admin' }], ['missing canonical role', { active: true }],
  ['technician despite token role', { active: true, role: 'technician' }],
]) {
  test(`cross-customer matching denies ${name} before business-data reads`, async () => {
    const db = database(profile);
    const result = await api(db).handle(request());
    assert.equal(result.status, 403, JSON.stringify(result));
    assert.equal(result.body.error.code, 'permission_denied');
    assert.equal(db.queries.length, 0);
    assert.ok(db.reads.every(path => path.startsWith('users/')));
    assert.equal(db.writes.length, 0);
  });
}

test('an active canonical office profile can inspect an empty account-scoped list without writes', async () => {
  const db = database({ active: true, role: 'admin' });
  const result = await api(db).handle(request());
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.readOnly, true);
  assert.deepEqual(result.body.rows, []);
  assert.equal(result.body.proactiveContactAuthorized, false);
  assert.equal(result.body.capacityReserved, false);
  assert.equal(db.writes.length, 0);
});

test('expected inspection errors preserve actionable codes rather than becoming internal failures', async () => {
  const db = database({ active: true, role: 'admin' });
  for (const [data, status, code] of [
    [{ cancelledAppointmentId: 'missing' }, 409, 'not_cancelled'],
    [{ ...DATA, pageSize: 100 }, 400, 'invalid_request'],
    [{ ...DATA, afterId: 'missing' }, 409, 'invalid_cursor'],
  ]) {
    const result = await api(db).handle(request(data));
    assert.equal(result.status, status, JSON.stringify(result));
    assert.equal(result.body.error.code, code);
    assert.deepEqual(result.body.error.details, {});
  }
  assert.equal(db.writes.length, 0);
});

test('unexpected storage failure remains an error without leaking raw provider diagnostics', async () => {
  const db = database({ active: true, role: 'admin' });
  db.runTransaction = async () => { throw Object.assign(new Error('PRIVATE-CUSTOMER-ID and credential diagnostic'), { code: 9 }); };
  const result = await api(db).handle(request());
  assert.equal(result.status, 500);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error.code, 'internal_error');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-CUSTOMER|credential/);
  assert.equal(db.writes.length, 0);
});

test('the recovery error formatter uses only known codes and fixed public messages', () => {
  for (const error of [new Error('private stack'), { code: '__proto__', message: 'private' }, null]) {
    const result = recoveryInspectionError(error);
    assert.equal(result.status, 500); assert.equal(result.body.error.code, 'internal_error');
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
  const expected = recoveryInspectionError({ code: 'not_cancelled', message: 'private foreign appointment' });
  assert.equal(expected.status, 409); assert.equal(expected.body.error.code, 'not_cancelled');
  assert.doesNotMatch(JSON.stringify(expected), /private/);
});
