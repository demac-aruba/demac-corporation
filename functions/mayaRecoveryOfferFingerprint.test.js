'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { originalFingerprint } = require('./mayaRecoveryOfferPolicy');
const { fixture } = require('./test-support/mayaRecoveryOffersFixture');

test('absent dispatch hold and the canonical empty return map mean the same no-hold state', () => {
  const original = { id: 'APT-1', status: 'confirmed', date: '2026-09-10', startTime: '09:30' };
  assert.equal(originalFingerprint(original), originalFingerprint({ ...original, dispatchHold: {} }));
  assert.equal(originalFingerprint(original), originalFingerprint({ ...original, dispatchHold: null }));
  assert.notEqual(originalFingerprint(original), originalFingerprint({ ...original, dispatchHold: { active: true, caseId: 'CASE' } }));
  assert.notEqual(originalFingerprint({ ...original, dispatchHold: { active: false, caseId: 'A' } }),
    originalFingerprint({ ...original, dispatchHold: { active: false, caseId: 'B' } }));
});
test('canonical lifecycle return and persisted appointment have identical replay fingerprints', async () => {
  const f = await fixture(); const p = await f.prepare(); await f.delivered(p); f.inbound();
  const result = await f.respond(p);
  const persisted = { ...f.db.read('appointments', 'APT-1'), id: 'APT-1' };
  assert.equal(originalFingerprint(result.appointment), originalFingerprint(persisted));
  assert.equal(f.db.read('bookingOffers', p.offerId).recovery.response.canonicalFingerprint, originalFingerprint(persisted));
  assert.equal((await f.respond(p)).replayed, true);
});
test('time, workload, property, assignments and capacity are retained in the replay fingerprint', () => {
  const original = { id: 'APT-1', status: 'confirmed', customerId: 'C', propertyId: 'P', date: '2026-09-10',
    startTime: '09:30', endTime: '10:30', workLines: [{ presetId: 'service', quantity: 1 }],
    assignments: [{ vanId: 'VAN-1' }], workOrderIds: ['WO-1'], capacityLockIds: ['LOCK-1'] };
  for (const patch of [{ date: '2026-09-11' }, { startTime: '10:30' }, { propertyId: 'OTHER' },
    { workLines: [{ presetId: 'service', quantity: 2 }] }, { assignments: [{ vanId: 'VAN-2' }] },
    { workOrderIds: ['OTHER-WORK'] }, { capacityLockIds: ['OTHER-CAPACITY'] }]) {
    assert.notEqual(originalFingerprint(original), originalFingerprint({ ...original, ...patch }));
  }
});
