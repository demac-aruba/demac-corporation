'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createAppointmentCharges, prepareInitialCharges, chargeFingerprint, inputLines, paymentInput } = require('./appointmentCharges');
const NOW = new Date('2026-10-10T14:00:00Z');
const priced = (amount = '125.00', more = {}) => ({ id: 'service-1', label: 'Servicio de prueba', quantity: 1, ...(amount !== '' ? { serviceId: `test-price-${Number(amount)}` } : {}), ...more });
const fixturePrices = Object.fromEntries([0, 0.1, 10, 20, 45, 55, 125, 200, 250, 270, 300, 497.5].map(price => [`services/test-price-${price}`, { name: `Servicio sintético ${price}`, active: true, basePrice: price }]));
const cash = (amount = '100.00', more = {}) => ({ amount, method: 'cash', ...more });
const office = { source: 'office-scheduling', id: 'office' };
function fixture(seed = {}) {
  const db = new TransactionalFirestore({
    'users/office': { active: true, role: 'office', name: 'Oficina sintética' },
    'appointments/apt': { customerId: 'customer', propertyId: 'property', status: 'confirmed', workOrderIds: ['wo'], assignments: [{ vanId: 'van' }], references: { note: 'preserved' } },
    'workOrders/wo': { status: 'Confirmada', scheduledSlots: 2 },
    'businessSettings/company-service-pricing-rules': { version: 1, standardServiceSplit: [{ btu: 12000, price: 125 }, { btu: 18000, price: 145 }] },
    'services/fixed': { name: 'Chequeo', active: true, basePrice: 55 },
    ...fixturePrices,
    'appointments/apt/chargeEditing/current': { ownerId: 'office', ownerName: 'Oficina sintética', sessionId: 'fixture-session-0000000001', token: 'fixture-token', expiresAtMs: NOW.getTime() + 90000 },
    ...seed,
  });
  const service = createAppointmentCharges({ db, clock: () => NOW });
  let serial = 0;
  const call = (action, data = {}, uid = 'office') => service.execute({ action, uid, data: { appointmentId: 'apt', editSessionId: 'fixture-session-0000000001', editToken: 'fixture-token', expectedVersion: db.read('appointments/apt')?.jobCharges?.version || 0, requestId: `test-request-${++serial}`, ...data } });
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
  const q = await call('quote_appointment_charges', { lines: [priced('', { presetId: 'standard_service', btu: 12000 }), priced('', { id: 'two', presetId: 'standard_service', btu: 18000 })] });
  assert.equal(q.quote.totalCents, 27000);
  const pending = await call('quote_appointment_charges', { lines: [priced('', { presetId: 'standard_service' })] });
  assert.equal(pending.quote.totalCents, null);
  const fixed = await call('quote_appointment_charges', { lines: [priced('', { serviceId: 'fixed' })] });
  assert.equal(fixed.quote.totalCents, 5500);
});
test('null, empty and missing catalogue prices remain unpriced; legitimate zero remains zero', async () => {
  for (const basePrice of [null, '', ' ', [], {}, undefined, false, 0]) {
    const { call } = fixture({ 'services/fixed': { name: 'Test', active: true, basePrice } });
    const { quote } = await call('quote_appointment_charges', { lines: [priced('', { serviceId: 'fixed' })] });
    assert.equal(quote.totalCents, basePrice === 0 ? 0 : null);
  }
});
test('selecting a capacity-specific catalog article prices and saves its canonical BTU without extra input', async () => {
  const { db, call } = fixture({
    'services/std12': { name: '12K BTU Standard - First Floor', active: true, basePrice: 999, serviceDefinition: { version: 1, bookingCode: '12k_standard_service' } },
    'services/std18': { name: '18K BTU Standard - First Floor', active: true, bookingCode: '18K-Standard-Service' },
  });
  const lines = [priced('', { id: 'one', serviceId: 'std12' }), priced('', { id: 'two', serviceId: 'std18' }), priced('', { id: 'three', serviceId: 'fixed', quantity: 1.5 })];
  const { quote } = await call('quote_appointment_charges', { lines });
  assert.deepEqual(quote.lines.map(line => [line.btu, line.unitCents]), [[12000,12500],[18000,14500],[null,5500]]);
  assert.equal(quote.totalCents,35250);
  const input = { lines, scopeReviewed: true, quoteToken: quote.quoteToken, requestId: 'catalog-capacity-save', expectedVersion: 0 };
  await call('finalize_appointment_charges',input);
  assert.deepEqual(db.read('appointments/apt').jobCharges.final.lines.map(line => line.btu),[12000,18000,null]);
  const replay = await call('finalize_appointment_charges',input);
  assert.equal(replay.replayed,true);
  // Quantity edits retain the exact agreed snapshot, including a retired item.
  db.store.set('services/std12',{name:'Changed catalog name',active:false,basePrice:999});
  const edited = quote.lines.map(line => ({ ...line, quantity: 2, unitPrice: line.unitCents / 100 }));
  const retained = await call('quote_appointment_charges',{lines:edited});
  assert.deepEqual(retained.quote.lines.map(line => line.unitCents),[12500,14500,5500]);
  assert.equal(retained.quote.lines[0].label,'12K BTU Standard - First Floor');
});
test('new catalog selections cannot contradict their canonical capacity or infer it from names/SKUs', async () => {
  const { call } = fixture({
    'services/std12': { name:'Standard',bookingCode:'12k_standard_service',active:true },
    'services/named': { name:'12K BTU Standard',sku:'12K',pricingRuleKind:'standard_service',active:true },
    'services/tiered': { name:'12K tier',active:true,pricingDefinition:{mode:'tiered_btu',currency:'AWG',tiers:[{minBtu:9000,maxBtu:18000,amount:125}]} },
    'services/fixed12': { name:'12K fixed service',active:true,basePrice:125 },
  });
  await rejectsCode(call('quote_appointment_charges',{lines:[priced('',{serviceId:'std12',btu:18000})]}),'charge_catalog_capacity');
  for (const serviceId of ['named','tiered']) {
    const { quote } = await call('quote_appointment_charges',{lines:[priced('',{serviceId})]});
    assert.equal(quote.totalCents,null);assert.equal(quote.lines[0].btu,null);
    await rejectsCode(call('finalize_appointment_charges',{lines:[priced('',{serviceId})],scopeReviewed:true}),'charge_unpriced');
  }
  const { quote } = await call('quote_appointment_charges',{lines:[priced('',{serviceId:'fixed12'})]});
  assert.equal(quote.totalCents,12500);assert.equal(quote.lines[0].btu,null);
});
test('catalog capacity inference leaves unknown-BTU booking forecasts and historical agreements unchanged', async () => {
  const { db, call } = fixture({
    'services/std18':{name:'18K Standard',bookingCode:'18k_standard_service',active:true},
  });
  const lines=[priced('',{serviceId:'std18'})];
  const projection=await call('quote_appointment_charges',{lines,purpose:'projection'});
  assert.equal(projection.quote.totalCents,12500);assert.equal(projection.quote.lines[0].btu,null);assert.equal(projection.quote.lines[0].projectionOnly,true);
  const final=await call('quote_appointment_charges',{lines});
  assert.equal(final.quote.totalCents,14500);assert.equal(final.quote.lines[0].btu,18000);
  db.store.set('appointments/apt',{...db.read('appointments/apt'),jobCharges:{schemaVersion:1,version:1,final:null,estimate:projection.quote,originalEstimate:projection.quote,receivedCents:0,paymentCount:0}});
  const echoed=await call('quote_appointment_charges',{lines:[{...lines[0],unitPrice:'125.00'}]});
  assert.equal(echoed.quote.totalCents,14500);assert.equal(echoed.quote.lines[0].btu,18000);
  await call('finalize_appointment_charges',{lines:[{...lines[0],unitPrice:'125.00'}],scopeReviewed:true,note:'Specific article selected',quoteToken:echoed.quote.quoteToken});
  assert.equal(db.read('appointments/apt').jobCharges.final.totalCents,14500);
  assert.equal(db.read('appointments/apt').jobCharges.originalEstimate.totalCents,12500);
  // A valid historical agreement is checked before today's catalog definition.
  const old={...final.quote,lines:[{...final.quote.lines[0],btu:null,unitCents:6500,totalCents:6500,manualPrice:true,label:'Historical agreed item'}],totalCents:6500};
  db.store.set('appointments/apt',{...db.read('appointments/apt'),jobCharges:{schemaVersion:1,version:1,final:old,estimate:null,receivedCents:0,paymentCount:0}});
  const retained=await call('quote_appointment_charges',{lines:[{...lines[0],quantity:2,unitPrice:'65.00'}]});
  assert.equal(retained.quote.totalCents,13000);assert.equal(retained.quote.lines[0].btu,null);assert.equal(retained.quote.lines[0].label,'Historical agreed item');
});
test('all canonical matrix declarations price a catalog service without a fixed base price', async () => {
  for (const declaration of [
    { pricingRuleKind: 'standard_service' },
    { pricingDefinition: { ruleKind: 'standard_service' } },
    { serviceDefinition: { pricingRuleKind: 'standard_service' } },
    { serviceDefinition: { bookingCode: 'standard_service' } },
    { bookingCode: '12k_standard_service' },
  ]) for (const basePrice of [null, '', undefined]) {
    const { call } = fixture({ 'services/matrix': { name: 'Standard service', active: true, basePrice, ...declaration } });
    const { quote } = await call('quote_appointment_charges', { lines: [priced('', { serviceId: 'matrix', btu: 12000 })] });
    assert.equal(quote.totalCents, 12500);
    assert.equal(quote.lines[0].label, 'Standard service');
  }
});
test('arbitrary prices are rejected even with a reason and inactive catalogue cannot be selected', async () => {
  const { call } = fixture({ 'services/inactive': { name: 'Old', active: false, basePrice: 50 } });
  await rejectsCode(call('quote_appointment_charges', { lines: [priced('125', { unitPrice: '55', reason: 'Operator cannot override' })] }), 'charge_managed_price');
  await rejectsCode(call('quote_appointment_charges', { lines: [priced('', { serviceId: 'inactive' })] }), 'charge_catalog');
  const result = await call('list_charge_services'); assert.deepEqual(result.services.filter(({id}) => !id.startsWith('test-price-')).map(({id,name}) => ({id,name})), [{ id: 'fixed', name: 'Chequeo' }]);
});
test('exact cents and fractional time avoid floating drift; invalid money is rejected', async () => {
  const { call } = fixture();
  const { quote } = await call('quote_appointment_charges', { lines: [priced('45', { quantity: 1.5 }), priced('0.10', { id: 'tiny', quantity: 3 })] });
  assert.equal(quote.totalCents, 6780);
  for (const amount of [-1, '1.001', '1e3', 'NaN', true, null, 'Infinity', '1000000.01']) assert.throws(() => paymentInput(cash(amount), NOW));
  assert.throws(() => inputLines([priced('10'), priced('20')]), /identidad/);
});
test('immutable original estimate; final supports additions, extra time and pending balance without Field/capacity mutation', async () => {
  const { db, call } = fixture(); const order = db.read('workOrders/wo'), initial = db.read('appointments/apt');
  await call('save_appointment_estimate', { lines: [priced('270')] });
  const original = db.read('appointments/apt').jobCharges.originalEstimate;
  await call('save_appointment_estimate', { lines: [priced('300')], note: 'Nuevo alcance' });
  await call('finalize_appointment_charges', { lines: [priced('125'), priced('250', { id: 'second' }), priced('55', { id: 'extra' }), priced('45', { id: 'time', quantity: 1.5 })], note: 'Trabajo y adicionales revisados', scopeReviewed: true });
  const apt = db.read('appointments/apt'); assert.equal(apt.jobCharges.final.totalCents, 49750); assert.equal(apt.jobCharges.receivedCents, 0);
  assert.deepEqual(apt.jobCharges.originalEstimate, original); assert.deepEqual(db.read('workOrders/wo'), order);
  const { jobCharges, ...operational } = apt; assert.deepEqual(operational, initial);
});
test('finalization rejects incomplete price or scope review; explicit zero-price catalog service is valid', async () => {
  const { call } = fixture();
  await rejectsCode(call('finalize_appointment_charges', { lines: [priced('')], scopeReviewed: true }), 'charge_unpriced');
  await rejectsCode(call('finalize_appointment_charges', { lines: [priced('0')] }), 'charge_scope');
  const result = await call('finalize_appointment_charges', { lines: [priced('0')], scopeReviewed: true }); assert.equal(result.state.final.totalCents, 0);
});
test('two bookings isolate receipts, exact replay and confirmed totals even with the same request identity', async () => {
  const { db, call } = fixture({
    'appointments/other': { customerId: 'other-customer', propertyId: 'other-property', status: 'confirmed', workOrderIds: [] },
    'appointments/other/chargeEditing/current': { ownerId: 'office', sessionId: 'fixture-session-0000000001', token: 'fixture-token', expiresAtMs: NOW.getTime() + 90000 },
  });
  const otherBefore = db.read('appointments/other');
  const a = { payment: cash('250', { method: 'transfer', reference: 'SYNTHETIC-250' }), requestId: 'shared-request-id', expectedVersion: 0 };
  const b = { appointmentId: 'other', payment: cash('50'), requestId: 'shared-request-id', expectedVersion: 0 };
  const receiptA = await call('record_appointment_payment', a);
  assert.deepEqual(db.read('appointments/other'), otherBefore);
  const receiptB = await call('record_appointment_payment', b);
  assert.notEqual(receiptA.paymentId, receiptB.paymentId);
  assert.equal((await call('record_appointment_payment', a)).replayed, true);
  assert.equal((await call('record_appointment_payment', b)).replayed, true);
  await call('finalize_appointment_charges', { lines: [priced('125', { quantity: 3 })], scopeReviewed: true });
  const first = await call('get_appointment_charges');
  const second = await call('get_appointment_charges', { appointmentId: 'other' });
  assert.equal(first.state.final.totalCents - first.state.receivedCents, 12500);
  assert.equal(first.payments.length, 1); assert.equal(first.payments[0].appointmentId, 'apt');
  assert.equal(second.state.final, null); assert.equal(second.state.receivedCents, 5000);
  assert.equal(second.payments.length, 1); assert.equal(second.payments[0].appointmentId, 'other');
  const before = [...db.store];
  await rejectsCode(call('void_appointment_payment', { paymentId: receiptB.paymentId, reason: 'Wrong appointment' }), 'payment_unavailable');
  assert.deepEqual([...db.store], before, 'A booking cannot void another booking receipt');
});
test('all four split methods total exactly, void preserves receipt and audit, credits stay visible', async () => {
  const { db, call } = fixture();
  await call('finalize_appointment_charges', { lines: [priced('497.50')], scopeReviewed: true });
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
  const { call, db } = fixture(); const lines = [priced('', { presetId: 'standard_service', btu: 12000 })];
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
  await rejectsCode(call('finalize_appointment_charges', { lines: [priced()], scopeReviewed: true }), 'charge_hold');
  db.write('appointments/apt', { ...db.read('appointments/apt'), status: 'cancelled' });
  await rejectsCode(call('save_appointment_estimate', { lines: [priced()] }), 'charge_cancelled');
  await call('record_appointment_payment', { payment: cash() }); assert.equal(db.read('appointments/apt').status, 'cancelled');
});
test('initial booking preparation is atomic, optional, stable and authorizes current account inside transaction', async () => {
  const { db } = fixture(); const input = { lines: [priced()], payment: cash() };
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
  await call('finalize_appointment_charges', { lines: [priced('200')], scopeReviewed: true });
  await rejectsCode(call('finalize_appointment_charges', { lines: [priced('250')], scopeReviewed: true }), 'charge_change_reason');
  await call('finalize_appointment_charges', { lines: [priced('250')], scopeReviewed: true, note: 'Corrección documentada' });
});
test('Field billing candidates cannot be silently billed a second time', async () => {
  const { call } = fixture({ 'fieldBillingCandidates/review': { appointmentId: 'apt', workOrderId: 'wo', status: 'ready' } });
  await rejectsCode(call('finalize_appointment_charges', { lines: [priced('200')], scopeReviewed: true }), 'charge_reconciliation');
});
test('reviewed Field evidence can be explicitly reconciled without duplicating lines or changing Field', async () => {
  const candidate = { id: 'candidate', fieldAuthorityVersion: 1, visitId: 'visit', sourceDecisionRequestId: 'review-request', createdByUserId: 'office', createdAt: NOW.toISOString(), version: 1, appointmentId: 'apt', workOrderId: 'wo', clientId: 'customer', propertyId: 'property', officeReviewId: 'review', officeReviewRevisionId: 'revision', revisionNumber: 1, status: 'ready_for_billing_review', invoiceLineIds: [], lines: [{ sourceType: 'intervention', sourceId: 'intervention', catalogItemId: 'fixed', description: 'Servicio', quantity: 1, unitPrice: 125, lineTotal: 125, currency: 'AWG' }] };
  const { db, call } = fixture({ 'fieldBillingCandidates/candidate': candidate });
  await call('record_appointment_payment', { payment: cash() });
  const view = await call('get_appointment_charges'); assert.equal(view.blocker, '');
  const input = { lines: [priced('125')], scopeReviewed: true, note: 'Incluye el servicio de Field' };
  await rejectsCode(call('finalize_appointment_charges', input), 'charge_field_review');
  await call('finalize_appointment_charges', { ...input, candidateReviewed: true, candidateFingerprint: view.candidateEvidence.fingerprint });
  assert.equal(db.read('appointments/apt').jobCharges.final.totalCents, 12500);
  assert.deepEqual(db.read('fieldBillingCandidates/candidate'), candidate);
  db.write('fieldBillingCandidates/candidate', { ...candidate, revisionNumber: 2 });
  await rejectsCode(call('finalize_appointment_charges', { ...input, candidateReviewed: true, candidateFingerprint: view.candidateEvidence.fingerprint }), 'charge_field_review');
});
test('historical Project guard detects final-only charges and voided financial history without relying on receipts', async () => {
  const { assertNoLinkedCommercialEvidence } = require('./projectCommercialGuard');
  for (const jobCharges of [{ final: { totalCents: 0 }, paymentCount: 0, receivedCents: 0 }, { final: null, paymentCount: 1, receivedCents: 0 }]) {
    await assert.rejects(assertNoLinkedCommercialEvidence({ appointment: { jobCharges }, order: {} }), /commercial or payroll evidence/);
  }
});

test('catalog search exposes bounded commercial metadata only, preserves identity and never mutates records', async () => {
  const {db,call}=fixture({
    'services/product': {name:'Refrigerante de prueba',itemType:'Producto',sku:'GAS-DEMO',category:'Refrigerantes',description:'Aplicación por libra',durationMinutes:60,basePrice:55,unitCost:12,supplierToken:'never-expose',stock:500,active:true},
    'services/canonical': {name:'Servicio de prueba',description:'a'.repeat(900),category:'b'.repeat(180),sku:'c'.repeat(180),durationMinutes:30,serviceDefinition:{duration:{minutes:90}},active:true},
    'services/hidden': {name:'Inactivo',active:false},
    'users/auditor': {active:true,role:'auditor'},'users/technician':{active:true,role:'technician'},
  });
  const before=[...db.store];
  const result=await call('list_charge_services',{},'auditor');
  const product=result.services.find(item=>item.id==='product'), service=result.services.find(item=>item.id==='canonical');
  assert.deepEqual(product,{id:'product',name:'Refrigerante de prueba',itemType:'Producto',description:'Aplicación por libra',category:'Refrigerantes',sku:'GAS-DEMO',durationMinutes:null});
  assert.equal(service.itemType,'Servicio');assert.equal(service.durationMinutes,90);assert.equal(service.description.length,600);assert.equal(service.category.length,120);assert.equal(service.sku.length,120);
  assert.equal(result.services.some(item=>item.id==='hidden'),false);
  await rejectsCode(call('list_charge_services',{},'technician'),'permission_denied');
  assert.deepEqual([...db.store],before);
  const {quote}=await call('quote_appointment_charges',{lines:[priced('',{serviceId:'product',label:'Refrigerante de prueba',quantity:1.5})]});
  assert.equal(quote.totalCents,8250);assert.deepEqual([...db.store],before);
});


test('all fifteen approved service/BTU tariffs resolve and the server prevents misleading matrix labels', async () => {
  const { DEFAULT_SERVICE_PRICING_RULES } = require('./demacServicePricingRules');
  const { call } = fixture({ 'businessSettings/company-service-pricing-rules': DEFAULT_SERVICE_PRICING_RULES });
  const btus = [9000, 12000, 18000, 24000, 36000];
  for (const [presetId, prices, label] of [
    ['standard_service', [100,125,135,145,175], 'Standard service'],
    ['deep_cleaning', [195,195,195,195,250], 'Deep cleaning'],
    ['standard_installation', [225,225,225,250,300], 'Instalación estándar back to back'],
  ]) {
    for (const [i,btu] of btus.entries()) {
      const { quote } = await call('quote_appointment_charges', { lines: [priced('', { presetId, btu, label: 'Forged description' })] });
      assert.equal(quote.totalCents, prices[i] * 100); assert.equal(quote.lines[0].label, label);
    }
  }
});
test('existing snapshots keep agreed unit price after catalog change or retirement; quantity uses that same unit', async () => {
  const { call, db } = fixture();
  await call('save_appointment_estimate', { lines: [priced('', { serviceId: 'fixed' })] });
  const original = db.read('appointments/apt').jobCharges.originalEstimate;
  db.write('services/fixed', { name: 'Renamed', active: false, basePrice: 99 });
  const { quote } = await call('quote_appointment_charges', { lines: [priced('', { serviceId: 'fixed', quantity: 2 })] });
  assert.equal(quote.totalCents, 11000); assert.equal(quote.lines[0].label, 'Chequeo');
  await call('finalize_appointment_charges', { lines: [priced('', { serviceId: 'fixed', quantity: 2 })], scopeReviewed: true, note: 'Two units confirmed', quoteToken: quote.quoteToken });
  assert.deepEqual(db.read('appointments/apt').jobCharges.originalEstimate, original);
  await rejectsCode(call('quote_appointment_charges', { lines: [priced('', { id: 'new', serviceId: 'fixed' })] }), 'charge_catalog');
  await rejectsCode(call('quote_appointment_charges', { lines: [priced('', { serviceId: 'fixed', unitPrice: '99' })] }), 'charge_managed_price');
});
test('changing service or BTU replaces the charge and resolves current tariff without rewriting original work', async () => {
  const { DEFAULT_SERVICE_PRICING_RULES } = require('./demacServicePricingRules');
  const { call, db } = fixture({ 'businessSettings/company-service-pricing-rules': DEFAULT_SERVICE_PRICING_RULES });
  const line = priced('', { workLineId: 'original-work', presetId: 'standard_service', btu: 12000 });
  await call('save_appointment_estimate', { lines: [line] });
  const original = db.read('appointments/apt').jobCharges.originalEstimate;
  const deep = { ...line, presetId: 'deep_cleaning' };
  const { quote } = await call('quote_appointment_charges', { lines: [deep] });
  assert.equal(quote.totalCents, 19500); assert.equal(quote.lines.length, 1);
  await rejectsCode(call('quote_appointment_charges', { lines: [{ ...deep, unitPrice: '125' }] }), 'charge_managed_price');
  const large = { ...deep, btu: 36000 };
  assert.equal((await call('quote_appointment_charges', { lines: [large] })).quote.totalCents, 25000);
  await call('finalize_appointment_charges', { lines: [large], scopeReviewed: true, note: 'Real service and equipment confirmed' });
  const state = db.read('appointments/apt').jobCharges;
  assert.deepEqual(state.originalEstimate, original); assert.equal(state.final.lines.length, 1);
  assert.equal(state.final.lines[0].workLineId, 'original-work'); assert.equal(state.final.totalCents, 25000);
});
test('stale quote context and historical manual prices cannot authorize a new arbitrary-price line', async () => {
  const { call, db } = fixture();
  await call('save_appointment_estimate', { lines: [priced('125')] });
  const apt = db.read('appointments/apt'); apt.jobCharges.estimate.lines[0] = { ...apt.jobCharges.estimate.lines[0], serviceId: '', unitCents: 11250, manualPrice: true, reason: 'Historical approved amount' }; db.write('appointments/apt', apt);
  const old = priced('', { unitPrice: '112.50' });
  const { quote } = await call('quote_appointment_charges', { lines: [old] });
  assert.equal(quote.totalCents, 11250); assert.equal(quote.lines[0].manualPrice, true);
  await rejectsCode(call('quote_appointment_charges', { lines: [old], expectedVersion: 0 }), 'charge_conflict');
  await rejectsCode(call('quote_appointment_charges', { lines: [{ ...old, id: 'copied' }] }), 'charge_managed_price');
});


test('legacy catalog descriptions also come from the server when name is absent', async () => {
  for (const [data,label] of [[{label:'Legacy standard service'},'Legacy standard service'],[{},'fixed']]) {
    const {call}=fixture({'services/fixed':{...data,active:true,basePrice:125}});
    const {quote}=await call('quote_appointment_charges',{lines:[priced('',{serviceId:'fixed',label:'Forged deep cleaning'})]});
    assert.equal(quote.lines[0].label,label);assert.equal(quote.totalCents,12500);
  }
});

test('new booking automatically snapshots configured minimum without an explicit financial payload', async () => {
  const { db } = fixture();
  const appointment = { ...db.read('appointments/apt'), workItems: [{ id: 'planned-standard', presetId: 'standard_service', label: 'Standard', quantity: 3 }] };
  await db.runTransaction(async transaction => {
    const commit = await prepareInitialCharges({ db, transaction, actor: office, appointmentId: 'apt', appointment, now: NOW });
    assert.equal(commit.value.originalEstimate.totalCents, 37500);
    assert.equal(commit.value.originalEstimate.lines[0].btu, null);
    assert.equal(commit.value.originalEstimate.lines[0].projectionOnly, true);
    transaction.update(db.collection('appointments').doc('apt'), { jobCharges: commit.value }); commit.write();
  });
  assert.equal([...db.store.keys()].filter(key => key.startsWith('payments/')).length, 0);
  assert.equal(db.read('workOrders/wo').status, 'Confirmada');
  assert.equal([...db.store.keys()].filter(key => key.startsWith('appointments/apt/chargeEvents/')).length, 1);
});
test('minimum forecast never becomes final BTU price, including an old client echoing the snapshot amount', async () => {
  const { db, call } = fixture();
  const line = { id: 'planned-standard', presetId: 'standard_service', label: 'Standard', quantity: 2 };
  const { quote } = await call('quote_appointment_charges', { lines: [line], purpose: 'projection' });
  assert.equal(quote.totalCents, 25000);
  await db.runTransaction(async transaction => {
    const commit = await prepareInitialCharges({ db, transaction, actor: office, appointmentId: 'apt', appointment: db.read('appointments/apt'),
      input: { lines: [line], purpose: 'projection', quoteToken: quote.quoteToken }, now: NOW });
    transaction.update(db.collection('appointments').doc('apt'), { jobCharges: commit.value }); commit.write();
  });
  const original = structuredClone(db.read('appointments/apt').jobCharges.originalEstimate);
  const data = { lines: [{ ...line, unitPrice: '125' }], note: 'Review actual work', scopeReviewed: true };
  await rejectsCode(call('finalize_appointment_charges', data), 'charge_unpriced');
  const finalQuote = await call('quote_appointment_charges', { lines: [line] });
  assert.equal(finalQuote.quote.totalCents, null);
  const final = await call('finalize_appointment_charges', { ...data, lines: [{ ...line, btu: 18000 }] });
  assert.equal(final.state.final.totalCents, 29000);
  assert.deepEqual(final.state.originalEstimate, original);
});
test('legacy explicit booking quote remains accepted while new projection quotes bind the minimum tariff', async () => {
  const { db, service } = fixture();
  const lines = [{ id: 'standard', presetId: 'standard_service', label: 'Standard', quantity: 1 }];
  for (const purpose of [undefined, 'projection']) {
    const { quote } = await service.execute({ action: 'quote_appointment_charges', uid: 'office', data: { lines, ...(purpose ? { purpose } : {}) } });
    const commit = await db.runTransaction(transaction => prepareInitialCharges({ db, transaction, actor: office, appointmentId: 'apt', appointment: db.read('appointments/apt'),
      input: { lines, quoteToken: quote.quoteToken, ...(purpose ? { purpose } : {}) }, now: NOW }));
    assert.equal(commit.value.estimate.totalCents, purpose ? 12500 : null);
  }
});
test('missing, ambiguous or invalid minimum is pending; configured zero is a real minimum', async () => {
  const line = { id: 'standard', presetId: 'standard_service', label: 'Standard', quantity: 2 };
  for (const rows of [[], [{ btu: 12000, price: null }], [{ btu: 12000, price: 100 }, { btu: 12000, price: 50 }], [{ btu: 12000, price: 100 }, { btu: 18000, price: '' }], [{ btu: 12000, price: 0 }, { btu: 18000, price: 150 }]]) {
    const { call } = fixture({ 'businessSettings/company-service-pricing-rules': { version: 1, standardServiceSplit: rows } });
    const { quote } = await call('quote_appointment_charges', { lines: [line], purpose: 'projection' });
    assert.equal(quote.totalCents, rows[0]?.price === 0 ? 0 : null);
  }
});
test('automatic projection preserves unpriced canonical work when the price catalog is unavailable', async () => {
  const { db } = fixture();
  const appointment = { ...db.read('appointments/apt'), workItems: [{ id: 'unknown', serviceId: 'missing', presetId: 'manual', label: 'Trabajo por cotizar', quantity: 2 }] };
  const commit = await db.runTransaction(transaction => prepareInitialCharges({ db, transaction, actor: office, appointmentId: 'apt', appointment, now: NOW }));
  assert.equal(commit.value.estimate.totalCents, null);
  assert.equal(commit.value.estimate.lines[0].serviceId, 'missing');
  assert.equal(commit.value.estimate.lines[0].quantityMillis, 2000);
});

test('catalog BTU tiers forecast their validated minimum; final quotes require exact BTU', async () => {
  const service = { name: 'Synthetic tiered service', active: true, pricingDefinition: { mode: 'tiered_btu', currency: 'AWG', tiers: [{ minBtu: 1, maxBtu: 12000, amount: 90 }, { minBtu: 12001, maxBtu: 60000, amount: 200 }] } };
  const { call } = fixture({ 'services/tiered': service });
  const lines = [{ id: 'tiered', serviceId: 'tiered', label: service.name, quantity: 3 }];
  assert.equal((await call('quote_appointment_charges', { lines, purpose: 'projection' })).quote.totalCents, 27000);
  assert.equal((await call('quote_appointment_charges', { lines })).quote.totalCents, null);
  for (const patch of [{ currency: 42 }, { tiers: [null] }, { tiers: [] }, { tiers: [{ minBtu: 12000, maxBtu: 9000, amount: 100 }] }, { tiers: [{ minBtu: 1, maxBtu: 12000, amount: 90 }, { minBtu: 9000, amount: 10 }] }]) {
    const { call: invalid } = fixture({ 'services/tiered': { ...service, pricingDefinition: { ...service.pricingDefinition, ...patch } } });
    assert.equal((await invalid('quote_appointment_charges', { lines, purpose: 'projection' })).quote.totalCents, null);
  }
});
