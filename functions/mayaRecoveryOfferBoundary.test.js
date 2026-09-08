'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW } = require('./test-support/mayaRecoveryOffersFixture');

async function readyWithLegacyWork() {
  const f = await fixture();
  f.db.patch('workOrders', 'WO-LEGACY', { ...f.db.read('workOrders', 'WO-APT-1-1') });
  f.db.docs.delete('workOrders/WO-APT-1-1');
  f.db.patch('appointments', 'APT-1', { workOrderIds: ['WO-LEGACY'] });
  const prepared = await f.prepare(); await f.delivered(prepared); f.inbound();
  return { ...f, prepared };
}
for (const owner of ['FOREIGN-APPOINTMENT', 'APT-1']) {
  test(`generated work destination owned by ${owner} but not linked cannot be overwritten`, async () => {
    const f = await readyWithLegacyWork();
    f.db.patch('workOrders', 'WO-APT-1-1', { appointmentId: owner, clientId: 'C-1', propertyId: 'P-1',
      status: 'Confirmada', date: '2026-09-12', time: '09:30', vanId: 'VAN-1', scheduledSlots: 1, privateNote: 'Keep this synthetic record' });
    const before = JSON.stringify([...f.db.docs]); f.db.writes.length = 0;
    await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_work_destination_conflict');
    assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.db.writes.length, 0);
  });
}
test('a genuinely new generated Work Order may be created while the verified legacy projection is retired', async () => {
  const f = await readyWithLegacyWork();
  const result = await f.respond(f.prepared);
  assert.equal(result.success, true);
  assert.equal(f.db.read('workOrders', 'WO-APT-1-1').appointmentId, 'APT-1');
  assert.equal(f.db.read('workOrders', 'WO-LEGACY').status, 'Cancelada');
  assert.equal(f.db.read('workOrders', 'WO-LEGACY').amount, 125);
  assert.equal(f.db.read('workOrders', 'WO-LEGACY').paid, 50);
});
test('a response longer than the bounded analysis window is rejected, not silently truncated into acceptance', async () => {
  const f = await fixture(); const p = await f.prepare(); await f.delivered(p);
  f.inbound(`Yes, please move it to Tuesday. ${'x'.repeat(8000)} But do not change my appointment.`);
  const before = JSON.stringify([...f.db.docs]);
  await assert.rejects(() => f.respond(p), error => error.code === 'recovery_response_requires_clarification');
  assert.equal(f.analysisCalls.length, 0); assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('a supposedly delivered message timestamped in the future cannot become delivery proof', async () => {
  const f = await fixture(); const p = await f.prepare(); await f.delivered(p);
  const stored = f.db.read('bookingOffers', p.offerId);
  f.db.patch('bookingOffers', p.offerId, { recovery: { ...stored.recovery, state: 'prepared', delivery: undefined } });
  f.db.patch('whatsappMessages', 'OUT-1', { firstIngestedAtIso: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    whatsappTimestamp: new Date(NOW.getTime() + 10 * 60_000).toISOString() });
  const before = JSON.stringify([...f.db.docs]);
  await assert.rejects(() => f.service.bindDelivery({ offerId: p.offerId, offerVersion: p.offerVersion,
    queueId: 'QUEUE-OUT-1', outboundMessageId: 'OUT-1' }), error => error.code === 'recovery_delivery_unproven');
  assert.equal(JSON.stringify([...f.db.docs]), before);
});
