'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createCustomerAlerts, normalizePhone, addressKey } = require('./customerAlerts');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const seed = () => ({
  'users/operator': { active: true, role: 'office', name: 'Synthetic operator' },
  'users/manager': { active: true, role: 'admin', name: 'Synthetic manager' },
  'clients/old': { name: 'Synthetic old customer', phone: '560 0000', whatsapp: '+2975600000', unknown: { keep: true } },
  'clients/new': { name: 'Synthetic new occupant', phone: '+297 5600001' },
  'clients/third': { name: 'Synthetic third occupant', phone: '+297 5600002' },
  'properties/old-home': { clientId: 'old', address: 'Example Street 54-C', active: true },
  'properties/new-home': { clientId: 'new', address: '  Éxample street 54 c ', active: true },
  'properties/third-home': { clientId: 'third', address: 'Example Street 54-C', active: true },
  'appointments/existing': { customerId: 'old', status: 'confirmed', chargeVersion: 12, unknown: 'keep' },
  'payments/existing': { amount: 145 }, 'workOrders/existing': { status: 'completed' },
  'whatsappOutboundQueue/existing': { status: 'pending' },
});
const create = () => ({ id: 'alert-1', requestId: 'create-1', customerId: 'old', propertyId: 'old-home', category: 'debt', comment: 'Synthetic incident only.', matchPhone: true, matchAddress: true });
function setup(extra = {}) {
  const db = new TransactionalFirestore({ ...seed(), ...extra });
  const api = createCustomerAlerts({ db, clock: () => new Date('2026-10-27T17:00:00Z') });
  const call = (action, data = {}, uid = 'operator') => api.execute({ action, data, uid });
  return { db, call };
}
test('creation is private, customer-owned, replay-safe and leaves every existing operational record untouched', async () => {
  const { db, call } = setup(), before = new Map(db.store);
  const result = await call('create_customer_alert', create());
  assert.equal(result.alert.customerId, 'old'); assert.equal(result.alert.createdBy.id, 'operator');
  assert.equal(result.alert.status, 'active'); assert.equal(result.alert.version, 1);
  for (const [path, value] of before) assert.deepEqual(db.read(path), value, path);
  assert.ok([...db.store.keys()].filter(p => !before.has(p)).every(p => p.startsWith('customerAlerts/')));
  const saved = new Map(db.store);
  assert.equal((await call('create_customer_alert', create())).replayed, true);
  assert.deepEqual(db.store, saved);
  await assert.rejects(call('create_customer_alert', { ...create(), comment: 'Altered retry' }), { code: 'alert_replay' });
});
test('exact phone normalization matches country/local forms without interpreting an address as a phone', async () => {
  assert.equal(normalizePhone('560-0000'), '2975600000'); assert.equal(normalizePhone('00297 560 0000'), '2975600000');
  assert.equal(normalizePhone('Street 5600000'), ''); assert.equal(normalizePhone('123'), '');
  const { call } = setup(); await call('create_customer_alert', create());
  const result = await call('match_customer_alerts', { query: '+297 (560) 0000' });
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].matchKind, 'phone'); assert.equal(result.matches[0].canDismiss, false);
});
test('new-occupant exception applies only to that customer and matching identifiers; original alert remains active', async () => {
  const { db, call } = setup(); await call('create_customer_alert', create());
  const context = { customerId: 'new', propertyId: 'new-home' };
  const result = await call('match_customer_alerts', context);
  assert.equal(result.matches[0].matchKind, 'address'); assert.equal(result.matches[0].customerId, 'old');
  const data = { id: 'alert-1', requestId: 'dismiss-1', expectedVersion: 1, context, contextToken: result.contextToken, decision: 'different_customer', reason: 'Verified a different occupant.' };
  await call('review_customer_alert', data);
  assert.equal((await call('review_customer_alert', data)).replayed, true);
  assert.equal((await call('match_customer_alerts', context)).matches.length, 0);
  assert.equal((await call('match_customer_alerts', { customerId: 'third', propertyId: 'third-home' })).matches.length, 1);
  assert.equal((await call('match_customer_alerts', { customerId: 'old' })).matches[0].matchKind, 'customer');
  assert.equal(db.read('customerAlerts/alert-1').status, 'active');
  db.write('clients/new', { ...db.read('clients/new'), phone: '5600000' });
  assert.equal((await call('match_customer_alerts', context)).matches.length, 1, 'new phone evidence needs new review');
});
test('direct customer alert survives a move and cannot be suppressed as another occupant', async () => {
  const { db, call } = setup(); await call('create_customer_alert', create());
  db.write('properties/old-home', { clientId: 'old', address: 'Different road 40' });
  db.write('clients/old', { name: 'Changed name', phone: '5609999' });
  const context = { customerId: 'old', propertyId: 'old-home' }, result = await call('match_customer_alerts', context);
  assert.equal(result.matches[0].matchKind, 'customer');
  await assert.rejects(call('review_customer_alert', { id: 'alert-1', requestId: 'bypass', expectedVersion: 1, context, contextToken: result.contextToken, decision: 'different_customer', reason: 'Attempted bypass' }), { code: 'alert_owner' });
});
test('apartment identifiers separate neighbors and no parent-address fallback implicates all units', async () => {
  const { call } = setup({
    'properties/old-home': { clientId: 'old', address: 'Complex 10', hasIndependentDwellings: true },
    'properties/new-home': { clientId: 'new', address: 'Complex 10', hasIndependentDwellings: true },
    'properties/old-home/dwellings/a': { clientId: 'old', propertyId: 'old-home', code: 'A1', name: 'Apartment 1' },
    'properties/new-home/dwellings/a': { clientId: 'new', propertyId: 'new-home', code: 'A1', name: 'Apartment 1' },
    'properties/new-home/dwellings/b': { clientId: 'new', propertyId: 'new-home', code: 'A2', name: 'Apartment 2' },
  });
  await assert.rejects(call('create_customer_alert', create()), { code: 'alert_address' });
  await call('create_customer_alert', { ...create(), dwellingId: 'a' });
  assert.equal((await call('match_customer_alerts', { customerId: 'new', propertyId: 'new-home', dwellingId: 'a' })).matches.length, 1);
  for (const dwellingId of ['', 'b']) assert.equal((await call('match_customer_alerts', { customerId: 'new', propertyId: 'new-home', dwellingId })).matches.length, 0);
  assert.notEqual(addressKey('Complex 10','A1'), addressKey('Complex 10','A2'));
});
test('stale review, stale identity and cross-customer property creation are rejected without mutation', async () => {
  const { db, call } = setup();
  await assert.rejects(call('create_customer_alert', { ...create(), propertyId: 'new-home' }), { code: 'alert_property' });
  await call('create_customer_alert', create());
  const context = { customerId: 'new', propertyId: 'new-home' }, result = await call('match_customer_alerts', context);
  const req = { id: 'alert-1', requestId: 'review', expectedVersion: 1, context, contextToken: result.contextToken, decision: 'continue' };
  db.write('clients/new', { ...db.read('clients/new'), phone: '5605555' });
  await assert.rejects(call('review_customer_alert', req), { code: 'alert_context' });
  await call('set_customer_alert_status', { id: 'alert-1', requestId: 'resolve', expectedVersion: 1, status: 'resolved', reason: 'Synthetic debt settled.' });
  const before = new Map(db.store);
  await assert.rejects(call('review_customer_alert', req), { code: 'alert_conflict' });
  assert.deepEqual(db.store, before);
  assert.equal((await call('match_customer_alerts', { customerId: 'old' })).matches.length, 0);
  assert.equal((await call('list_customer_alerts', { customerId: 'old' })).alerts[0].status, 'resolved');
});
test('concurrent state changes have one winner; invalidation is reasoned and history retained', async () => {
  const { call } = setup(); await call('create_customer_alert', create());
  const request = { id: 'alert-1', requestId: 'resolve', expectedVersion: 1, status: 'resolved', reason: 'Synthetic payment received.' };
  const results = await Promise.allSettled([call('set_customer_alert_status', request), call('set_customer_alert_status', { ...request, requestId: 'invalidate', status: 'invalidated' }, 'manager')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'alert_conflict');
  assert.equal((await call('customer_alert_history', { id: 'alert-1' })).events.length, 2);
});
test('continue and decline audit decisions without writing customers, bookings or finances', async () => {
  const { db, call } = setup(); await call('create_customer_alert', create());
  const context = { customerId: 'old' }, result = await call('match_customer_alerts', context), before = new Map(db.store);
  for (const decision of ['continue','decline']) await call('review_customer_alert', { id: 'alert-1', requestId: decision, expectedVersion: 1, context, contextToken: result.contextToken, decision });
  for (const [path,value] of before) assert.deepEqual(db.read(path), value, path);
});
for (const role of ['technician','accounting','inventory','unknown']) test(role + ' cannot read or write incident data', async () => {
  const { call } = setup({ 'users/operator': { active: true, role } });
  for (const [action,data] of [['create_customer_alert', create()],['list_customer_alerts',{customerId:'old'}],['match_customer_alerts',{query:'5600000'}],['customer_alert_history',{id:'alert-1'}]]) await assert.rejects(call(action,data), { code: 'permission_denied' });
});
test('fresh authorization applies to retries and facade rejects missing/revoked credentials', async () => {
  const { db, call } = setup(); await call('create_customer_alert', create());
  db.write('users/operator', { active: false, role: 'office' });
  await assert.rejects(call('create_customer_alert', create()), { code: 'permission_denied' });
  const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => { throw Error('revoked'); } });
  for (const headers of [{}, {authorization:'Bearer invalid'}]) assert.equal((await facade.handle({ method: 'POST', headers, body: { action: 'match_customer_alerts', data: {} } })).status, 401);
});
test('facade routes new actions through existing office authentication and service', async () => {
  const { db } = setup();
  const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async (token, revoked) => { assert.equal(revoked,true); return {uid:'operator'}; } });
  const result = await facade.handle({ method:'POST',headers:{authorization:'Bearer synthetic'},body:{action:'create_customer_alert',data:create()} });
  assert.equal(result.status,200); assert.equal(result.body.alert.customerId,'old');
});
