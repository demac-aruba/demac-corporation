'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createAppointmentCharges } = require('./appointmentCharges');
const { EDIT_TTL_MS } = require('./appointmentChargeEditing');
const A = 'tab-scarlet-0000000000001', B = 'tab-herlin-00000000000002';
function fixture() {
  let time = Date.parse('2026-10-12T15:00:00Z');
  const db = new TransactionalFirestore({ 'users/scarlet': { active: true, role: 'office', name: 'Scarlet de prueba' },
    'users/herlin': { active: true, role: 'office', name: 'Herlin de prueba' }, 'users/auditor': { active: true, role: 'auditor' },
    'appointments/a': { customerId: 'c', propertyId: 'p', status: 'confirmed', workOrderIds: [] },
    'appointments/b': { customerId: 'c', propertyId: 'p', status: 'confirmed', workOrderIds: [] } });
  const api = createAppointmentCharges({ db, clock: () => new Date(time) });
  const call = (action, data = {}, uid = 'scarlet') => api.execute({ action, data: { appointmentId: 'a', editSessionId: A, ...data }, uid });
  const acquire = (sessionId = A, uid = 'scarlet', appointmentId = 'a') => call('acquire_appointment_charge_edit', { editSessionId: sessionId, appointmentId }, uid);
  return { db, call, acquire, advance: ms => { time += ms; } };
}
test('two operators or two tabs of the same operator receive exactly one lease; readers do not acquire', async () => {
  for (const secondUid of ['herlin', 'scarlet']) {
    const { db, acquire, call } = fixture(); const before = [...db.store];
    await call('get_appointment_charges', {}, 'auditor'); assert.deepEqual([...db.store], before);
    const results = await Promise.all([acquire(), acquire(B, secondUid)]);
    assert.equal(results.filter(r => r.edit.mine).length, 1);
    const denied = results.find(r => !r.edit.mine); assert.ok(denied.edit.ownerName); assert.equal(denied.edit.token, undefined);
    assert.equal((await acquire(B, secondUid, 'b')).edit.mine, true, 'Different visits of the same customer stay independent');
    assert.equal(db.read('appointments/a').jobCharges, undefined);
  }
});
test('only active financial writers can acquire or renew; missing appointments create no coordination data', async () => {
  const { db, call, acquire } = fixture();
  await assert.rejects(acquire(A, 'auditor'), e => e.code === 'permission_denied');
  await assert.rejects(acquire(A, 'missing'), e => e.code === 'permission_denied');
  await assert.rejects(acquire(A, 'scarlet', 'missing'), e => e.code === 'not_found');
  assert.equal([...db.store.keys()].some(p => p.includes('chargeEditing')), false);
  const { edit } = await acquire(); db.write('users/scarlet', { active: false, role: 'office' });
  await assert.rejects(call('renew_appointment_charge_edit', { editToken: edit.token }), e => e.code === 'permission_denied');
});
test('lease expires logically; delayed renew/release cannot revive or remove a later owner or generation', async () => {
  const { call, acquire, advance } = fixture(); const first = (await acquire()).edit;
  advance(EDIT_TTL_MS + 1);
  await assert.rejects(call('renew_appointment_charge_edit', { editToken: first.token }), e => e.code === 'charge_edit_lost');
  const next = (await acquire()).edit; assert.notEqual(next.token, first.token);
  await call('release_appointment_charge_edit', { editToken: first.token });
  assert.equal((await acquire(B, 'herlin')).edit.mine, false);
  await call('release_appointment_charge_edit', { editToken: next.token });
  const other = (await acquire(B, 'herlin')).edit;
  await call('release_appointment_charge_edit', { editToken: next.token });
  await assert.rejects(call('renew_appointment_charge_edit', { editToken: next.token }), e => e.code === 'charge_edit_lost');
  assert.equal((await call('renew_appointment_charge_edit', { editSessionId: B, editToken: other.token }, 'herlin')).edit.mine, true);
});
test('all new financial writes require ownership; committed exact retry survives expiry without duplicate', async () => {
  const { db, call, acquire, advance } = fixture();
  for (const action of ['save_appointment_estimate', 'finalize_appointment_charges', 'record_appointment_payment', 'void_appointment_payment'])
    await assert.rejects(call(action, { requestId: 'no-session-request', expectedVersion: 0 }), e => e.code === 'charge_edit_lost');
  const token = (await acquire()).edit.token;
  const data = { editToken: token, requestId: 'single-payment-request', expectedVersion: 0, payment: { method: 'cash', amount: '10' } };
  await assert.rejects(call('record_appointment_payment', data, 'herlin'), e => e.code === 'charge_edit_lost');
  await call('record_appointment_payment', data); advance(EDIT_TTL_MS + 1); await acquire(B, 'herlin');
  const retry = await call('record_appointment_payment', data); assert.equal(retry.replayed, true); assert.equal(retry.state.receivedCents, 1000);
  assert.equal([...db.store.keys()].filter(p => p.startsWith('payments/')).length, 1);
  await assert.rejects(call('record_appointment_payment', { ...data, requestId: 'new-payment-request', expectedVersion: 1 }), e => e.code === 'charge_edit_lost');
});
