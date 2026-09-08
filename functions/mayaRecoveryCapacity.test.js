'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { releasedCapacityMatches, recoveryTarget } = require('./mayaRecoveryMatching');
const expected = { id: 'BAL-controlled', date: '2026-09-08', vanId: 'VAN-1', slot: '09:30' };

test('a recovery preview requires an explicitly released lock matching the exact scheduling key', () => {
  assert.equal(releasedCapacityMatches({ ...expected, active: false }, expected), true);
  for (const lock of [null, undefined, {}, { ...expected }, { ...expected, active: true },
    { ...expected, active: 0 }, { ...expected, active: 'false' }]) {
    assert.equal(releasedCapacityMatches(lock, expected), false);
  }
});

test('a released lock belonging to a different date, Van, slot or identity is not proof of this opening', () => {
  for (const patch of [{ id: 'OTHER' }, { date: '2026-09-09' }, { vanId: 'VAN-2' }, { slot: '10:30' },
    { date: '2026-02-30' }, { slot: '9:30' }, { slot: '24:00' }]) {
    assert.equal(releasedCapacityMatches({ ...expected, active: false, ...patch }, expected), false);
  }
});

function cancellation(assignments) {
  return { status: 'cancelled', cancelledAtIso: '2026-09-07T10:00:00Z', date: '2026-09-08', startTime: '09:30', endTime: '10:30',
    capacityLockIds: [expected.id], assignments };
}
const NOW = new Date('2026-09-07T11:00:00Z');
test('two claimed primary Vans in the cancelled appointment require review instead of choosing the first', () => {
  assert.throws(() => recoveryTarget(cancellation([
    { vanId: 'VAN-1', role: 'primary', time: '09:30' },
    { vanId: 'VAN-2', role: 'primary', time: '09:30' },
  ]), NOW), error => error.code === 'invalid_cancellation');
});

test('one primary with a support assignment preserves the primary opening identity', () => {
  const result = recoveryTarget(cancellation([
    { vanId: 'VAN-1', role: 'primary', time: '09:30' },
    { vanId: 'VAN-2', role: 'support', time: '10:30' },
  ]), NOW);
  assert.equal(result.vanId, 'VAN-1');
  assert.equal(result.time, '09:30');
});
