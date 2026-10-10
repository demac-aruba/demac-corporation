'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createAppointmentCharges, prepareInitialCharges, chargeFingerprint, inputLines, paymentInput } = require('./appointmentCharges');
const NOW = new Date('2026-10-10T14:00:00Z');
const manual = (amount = '125.00', more = {}) => ({ id: 'service-1', label: 'Servicio de prueba', quantity: 1, unitPrice: amount, reason: 'Precio acordado', ...more });
const cash = (amount = '100.00', more = {}) => ({ amount, method: 'cash', ...more });
const office = { source: 'office-scheduling', id: 'office' };
function fixture(seed = {}) {
  const db = new TransactionalFirestore({
    'users/office': { active: true, role: 'office', name: 'Oficina sintética' },
    'appointments/apt': { customerId: 'customer', propertyId: 'property', status: 'confirmed', workOrderIds: ['wo'], assignments: [{ vanId: 'van' }], references: { note: 'preserved' } },
    'workOrders/wo': { status: 'Confirmada', scheduledSlots: 2 },
    'businessSettings/company-service-pricing-rules': { version: 1, standardServiceSplit: [{ btu: 12000, price: 125 }, { btu: 18000, price: 145 }] },
    'services/fixed': { name: 'Chequeo', active: true, basePrice: 55 },
    ...seed,
  });
  const service = createAppointmentCharges({ db, clock: () => NOW });
  let serial = 0;
  const call = (action, data = {}, uid = 'office') => service.execute({ action, uid, data: { appointmentId: 'apt', expectedVersion: db.read('appointments/apt')?.jobCharges?.version || 0, requestId: `test-request-${++serial}`, ...data } });
  return { db, call, service };
}
const rejectsCode = async (promise, code) => assert.rejects(promise, error => error.code === code);

test('opening a legacy appointment is read-only, preserves missing financial data and exact operational documents', async () => {
  const { db, call } = fixture(); const before = [...db.store];
  const result = await call('get_appointment_charges');
  assert.equal(result.state, null); assert.equal(result.blocker, ''); assert.deepEqual([...db.store], before);
});
test('governed prices use exact BTU and explicit catalog; unknown price stays null, never zero', async () => {
  const { call } = fixture();
  const q = await call('quote_appointment_charges', { lines: [manual('', { presetId: 'standard_service', btu: 12000 }), manual('', { id: 'two', presetId: 'standard_service', btu: 18000 })] });
  assert.equal(q.quote.totalCents, 27000);
  const pending = await call('quote_appointment_charges', { lines: [manual('', { presetId: 'standard_service' })] });
  assert.equal(pending.quote.totalCents, null);
  const fixed = await call('quote_appointment_charges', { lines: [manual('', { serviceId: 'fixed' })] });
  assert.equal(fixed.quote.totalCents, 5500);
});
test('null, empty and missing catalogue prices remain unpriced; legitimate zero remains zero', async () => {
  for (const basePrice of [null, '', ' ', [], {}, undefined, false, 0]) {
    const { call } = fixture({ 'services/fixed': { name: 'Test', active: true, basePrice } });
    const { quote } = await call('quote_appointment_charges', { lines: [manual('', { serviceId: 'fixed' })] });
    assert.equal(quote.totalCents, basePrice === 0 ? 0 : null);
  }
});
test('manual overrides require reason and inactive catalogue cannot be selected', async () => {
  const { call } = fixture({ 'services/inactive': { name: 'Old', active: false, basePrice: 50 } });
  await rejectsCode(call('quote_appointment_charges', { lines: [manual('55', { reason: '' })] }), 'charge_override_reason');
  await rejectsCode(call('quote_appointment_charges', { lines: [manual('', { serviceId: 'inactive' })] }), 'charge_catalog');
  const result = await call('list_charge_services'); assert.deepEqual(result.services, [{ id: 'fixed', name: 'Chequeo' }]);
});
test('exact cents and fractional time avoid floating drift; invalid money is rejected', async () => {
  const { call } = fixture();
  const { quote } = await call('quote_appointment_charges', { lines: [manual('45', { quantity: 1.5 }), manual('0.10', { id: 'tiny', quantity: 3 })] });
  assert.equal(quote.totalCents, 6780);
  for (const amount of [-1, '1.001', '1e3', 'NaN', true, null, 'Infinity', '1000000.01']) assert.throws(() => paymentInput(cash(amount), NOW));
  assert.throws(() => inputLines([manual('10'), manual('20')]), /identidad/);
});
test('immutable original estimate; final supports additions, extra time and pending balance without Field/capacity mutation', async () => {
  const { db, call } = fixture(); const order = db.read('workOrders/wo'), initial = db.read('appointments/apt');
  await call('save_appointment_estimate', { lines: [manual('270')] });
  const original = db.read('appointments/apt').jobCharges.originalEstimate;
  await call('save_appointment_estimate', { lines: [manual('300')], note: 'Nuevo alcance' });
  await call('finalize_appointment_charges', { lines: [manual('125'), manual('250', { id: 'second' }), manual('55', { id: 'extra' }), manual('45', { id: 'time', quantity: 1.5 })], note: 'Trabajo y adicionales revisados', scopeReviewed: true });
  const apt = db.read('appointments/apt'); assert.equal(apt.jobCharges.final.totalCents, 49750); assert.equal(apt.jobCharges.receivedCents, 0);
  assert.deepEqual(apt.jobCharges.originalEstimate, original); assert.deepEqual(db.read('workOrders/wo'), order);
  const { jobCharges, ...operational } = apt; assert.deepEqual(operational, initial);
});
test('finalization rejects incomplete price or scope review; zero final is valid with explicit reason', async () => {
  const { call } = fixture();
  await rejectsCode(call('finalize_appointment_charges', { lines: [manual('')], scopeReviewed: true }), 'charge_unpriced');
  await rejectsCode(call('finalize_appointment_charges', { lines: [manual('0')] }), 'charge_scope');
  const result = await call('finalize_appointment_charges', { lines: [manual('0')], scopeReviewed: true }); assert.equal(result.state.final.totalCents, 0);
});
test('all four split methods total exactly, void preserves receipt and audit, credits stay visible', async () => {
  const { db, call } = fixture();
  await call('finalize_appointment_charges', { lines: [manual('497.50')], scopeReviewed: true });
  let last;
  for (const [method, amount] of [['transfer','100'],['cash','200'],['pos','150'],['suave','47.50']]) last = await call('record_appointment_payment', { payment: cash(amount, { method, reference: `${method}-ref` }) });
  assert.equal(last.state.receivedCents, 49750);
  await call('record_appointment_payment', { payment: cash('10') }); assert.equal(db.read('appointments/apt').jobCharges.receivedCents, 50750);
  await call('void_appointment_payment', { paymentId: last.paymentId, reason: 'Captura errónea' });
  assert.equal(db.read(`payments/${last.paymentId}`).status, 'voided'); assert.equal(db.read('appointments/apt').jobCharges.receivedCents, 46000);
  const result = await call('get_appointment_charges'); assert.equal(result.payments.length, 5); assert.equal(result.history.length, 7); assert.equal(result.blocker, '');
});
test('stable receipt retry survives response loss without duplicate; changed replay is rejected', async () => {
  const { call } = fixture(); const data = { payment: cash(), expectedVersion: 0, requestId: 'stable-request' };
  const first = await call('record_appointment_payment', data); const replay = await call('record_appointment_payment', data);
  assert.equal(replay.replayed, true); assert.equal(replay.state.receivedCents, first.state.receivedCents);
  await rejectsCode(call('record_appointment_payment', { ...data, payment: cash('101') }), 'idempotency_conflict');
  assert.equal((await call('get_appointment_charges')).payments.length, 1);
});
test('concurrent operators cannot overwrite each other and concurrent same request only records once', async () => {
  const { call, db } = fixture();
  const results = await Promise.allSettled([call('record_appointment_payment', { expectedVersion: 0, payment: cash('10') }), call('record_appointment_payment', { expectedVersion: 0, payment: cash('20') })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'charge_conflict'); assert.ok(db.retries > 0);
  const version = db.read('appointments/apt').jobCharges.version;
  const same = { expectedVersion: version, requestId: 'concurrent-same', payment: cash('5') };
  const replayed = await Promise.all([call('record_appointment_payment', same), call('record_appointment_payment', same)]);
  assert.equal(replayed.filter(result => result.replayed).length, 1); assert.equal((await call('get_appointment_charges')).payments.length, 2);
});
test('duplicate references, future dates, missing reference and cross-appointment void are blocked atomically', async () => {
  const { db, call } = fixture(); await call('record_appointment_payment', { payment: cash('10', { method: 'pos', reference: 'REF-1' }) });
  const before = [...db.store];
  await rejectsCode(call('record_appointment_payment', { payment: cash('10', { method: 'pos', reference: 'ref-1' }) }), 'payment_duplicate');
  await rejectsCode(call('record_appointment_payment', { payment: cash('10', { method: 'transfer' }) }), 'payment_reference');
  await rejectsCode(call('record_appointment_payment', { payment: cash('10', { receivedAt: '2099-01-01T00:00:00Z' }) }), 'payment_date');
  await rejectsCode(call('void_appointment_payment', { paymentId: 'other', reason: 'wrong' }), 'payment_unavailable');
  assert.deepEqual([...db.store], before);
});
test('legacy money, invoices, foreign payments and corrupted receipt sums block any new monetary write', async () => {
  for (const seed of [
    { 'workOrders/wo': { amount: 100, paid: true } },
    { 'invoices/old': { appointmentId: 'apt' } },
    { 'invoices/old': { workOrderId: 'wo' } },
    { 'payments/old': { workOrderId: 'wo', amount: 20 } },
    { 'payments/old': { appointmentId: 'apt', amount: 20 } },
    { 'payments/old': { appointmentId: 'apt', source: 'appointment-operational', amountCents: 50, method: 'cash', status: 'recorded', receivedAt: NOW.toISOString() } },
  ]) {
    const { call, db } = fixture(seed); const before = [...db.store];
    assert.ok((await call('get_appointment_charges')).blocker);
    await rejectsCode(call('record_appointment_payment', { payment: cash() }), 'charge_reconciliation'); assert.deepEqual([...db.store], before);
  }
});
test('missing/inactive/technician accounts cannot read or write; auditors read only; replay checks current authorization', async () => {
  const { db, call } = fixture(); const request = { requestId: 'auth-replay-id', expectedVersion: 0, payment: cash() };
  await call('record_appointment_payment', request);
  for (const profile of [undefined, { active: false, role: 'office' }, { active: true, role: 'technician' }]) {
    db.write('users/office', profile);
    await rejectsCode(call('get_appointment_charges'), 'permission_denied'); await rejectsCode(call('record_appointment_payment', request), 'permission_denied');
  }
  db.write('users/office', { active: true, role: 'auditor' }); assert.equal((await call('get_appointment_charges')).payments.length, 1);
  await rejectsCode(call('record_appointment_payment', request), 'permission_denied');
});
test('quote price/version change is rejected before any write; retry refreshed quote succeeds', async () => {
  const { call, db } = fixture(); const lines = [manual('', { presetId: 'standard_service', btu: 12000 })];
  const { quote } = await call('quote_appointment_charges', { lines });
  db.write('businessSettings/company-service-pricing-rules', { version: 2, standardServiceSplit: [{ btu: 12000, price: 150 }] });
  await rejectsCode(call('save_appointment_estimate', { lines, quoteToken: quote.quoteToken }), 'charge_quote_changed');
  assert.equal(db.read('appointments/apt').jobCharges, undefined);
  const updated = await call('quote_appointment_charges', { lines }); await call('save_appointment_estimate', { lines, quoteToken: updated.quote.quoteToken });
  assert.equal(db.read('appointments/apt').jobCharges.estimate.totalCents, 15000);
});
test('holds cannot take money/final amount; canceled appointments retain payment correction capability', async () => {
  const { call, db } = fixture(); db.write('appointments/apt', { ...db.read('appointments/apt'), status: 'temporary_hold' });
  await rejectsCode(call('record_appointment_payment', { payment: cash() }), 'payment_hold');
  await rejectsCode(call('finalize_appointment_charges', { lines: [manual()], scopeReviewed: true }), 'charge_hold');
  db.write('appointments/apt', { ...db.read('appointments/apt'), status: 'cancelled' });
  await rejectsCode(call('save_appointment_estimate', { lines: [manual()] }), 'charge_cancelled');
  await call('record_appointment_payment', { payment: cash() }); assert.equal(db.read('appointments/apt').status, 'cancelled');
});
test('initial booking preparation is atomic, optional, stable and authorizes current account inside transaction', async () => {
  const { db } = fixture(); const input = { lines: [manual()], payment: cash() };
  assert.equal(chargeFingerprint(input), chargeFingerprint(structuredClone(input)));
  const before = [...db.store];
  await assert.rejects(db.runTransaction(async transaction => { const commit = await prepareInitialCharges({ db, transaction, input, actor: office, appointmentId: 'apt', appointment: db.read('appointments/apt'), now: NOW }); commit.write(); throw Error('Synthetic failure'); }));
  assert.deepEqual([...db.store], before);
  await db.runTransaction(async transaction => { const commit = await prepareInitialCharges({ db, transaction, input, actor: office, appointmentId: 'apt', appointment: db.read('appointments/apt'), now: NOW }); transaction.update(db.collection('appointments').doc('apt'), { jobCharges: commit.value }); commit.write(); });
  assert.equal(db.read('appointments/apt').jobCharges.receivedCents, 10000);
  assert.equal(await prepareInitialCharges({ input: undefined }), null);
});
test('canonical accounting role can manage; corrections of final-only legacy amount always require a reason', async () => {
  const { call } = fixture({ 'users/office': { active: true, role: 'accounting' } });
  await call('finalize_appointment_charges', { lines: [manual('200')], scopeReviewed: true });
  await rejectsCode(call('finalize_appointment_charges', { lines: [manual('250')], scopeReviewed: true }), 'charge_change_reason');
  await call('finalize_appointment_charges', { lines: [manual('250')], scopeReviewed: true, note: 'Corrección documentada' });
});
test('Field billing candidates cannot be silently billed a second time', async () => {
  const { call } = fixture({ 'fieldBillingCandidates/review': { appointmentId: 'apt', workOrderId: 'wo', status: 'ready' } });
  await rejectsCode(call('finalize_appointment_charges', { lines: [manual('200')], scopeReviewed: true }), 'charge_reconciliation');
});
test('reviewed Field evidence can be explicitly reconciled without duplicating lines or changing Field', async () => {
  const candidate = { id: 'candidate', fieldAuthorityVersion: 1, visitId: 'visit', sourceDecisionRequestId: 'review-request', createdByUserId: 'office', createdAt: NOW.toISOString(), version: 1, appointmentId: 'apt', workOrderId: 'wo', clientId: 'customer', propertyId: 'property', officeReviewId: 'review', officeReviewRevisionId: 'revision', revisionNumber: 1, status: 'ready_for_billing_review', invoiceLineIds: [], lines: [{ sourceType: 'intervention', sourceId: 'intervention', catalogItemId: 'fixed', description: 'Servicio', quantity: 1, unitPrice: 125, lineTotal: 125, currency: 'AWG' }] };
  const { db, call } = fixture({ 'fieldBillingCandidates/candidate': candidate });
  await call('record_appointment_payment', { payment: cash() });
  const view = await call('get_appointment_charges'); assert.equal(view.blocker, '');
  const input = { lines: [manual('125')], scopeReviewed: true, note: 'Incluye el servicio de Field' };
  await rejectsCode(call('finalize_appointment_charges', input), 'charge_field_review');
  await call('finalize_appointment_charges', { ...input, candidateReviewed: true, candidateFingerprint: view.candidateEvidence.fingerprint });
  assert.equal(db.read('appointments/apt').jobCharges.final.totalCents, 12500);
  assert.deepEqual(db.read('fieldBillingCandidates/candidate'), candidate);
  db.write('fieldBillingCandidates/candidate', { ...candidate, revisionNumber: 2 });
  await rejectsCode(call('finalize_appointment_charges', { ...input, candidateReviewed: true, candidateFingerprint: view.candidateEvidence.fingerprint }), 'charge_field_review');
});
