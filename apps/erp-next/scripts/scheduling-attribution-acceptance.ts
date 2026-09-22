import assert from 'node:assert/strict';
import { applySchedulingAttribution, createSchedulingAttributionCache, retainSchedulingAttribution } from '../lib/scheduling-attribution';
import { bookingActorLabel, projectLiveSchedulingAppointments } from '../lib/live-scheduling';
import type { OfficeAppointmentAttribution } from '../lib/office-booking-authority';

async function main() {
  const [original] = projectLiveSchedulingAppointments([{
    id: 'SYNTHETIC-WO', appointmentId: 'SYNTHETIC-APT', date: '2026-09-18', time: '08:30',
    vanId: 'VAN-1', appointmentPresetId: 'standard_service', status: 'confirmed', scheduledSlots: 2,
  }], [], []);
  const known = { ...original, bookedById: 'creator', bookedByName: 'Original creator', bookedBySource: 'office-scheduling' };
  const fresh = { ...original, assignments: original.assignments.map((job) => ({ ...job, start: '10:30' })), updatedAt: 'newer' };
  const retained = retainSchedulingAttribution([known], [fresh]);
  assert.equal(retained[0].bookedByName, 'Original creator');
  assert.equal(retained[0].assignments[0].start, '10:30');
  assert.deepEqual(retainSchedulingAttribution([known], []), []);
  assert.equal(retainSchedulingAttribution([known], [{ ...fresh, id: 'different' }])[0].bookedByName, undefined);

  let clock = 0;
  let calls = 0;
  let complete!: (items: OfficeAppointmentAttribution[]) => void;
  const cache = createSchedulingAttributionCache(() => {
    calls += 1;
    return new Promise((resolve) => { complete = resolve; });
  }, bookingActorLabel, () => clock, 100);
  const item = { appointmentId: original.id, createdBy: 'creator', createdByName: 'Original creator', source: 'office-scheduling' };
  const first = cache.resolve([original.id, original.id]);
  const duplicate = cache.resolve([original.id]);
  await Promise.resolve();
  assert.equal(calls, 1, 'overlapping reads deduplicate');
  complete([item, { ...item, appointmentId: 'unrequested' }]);
  const patches = await first;
  assert.deepEqual(await duplicate, patches);
  assert.equal(patches.has('unrequested'), false);
  const moved = applySchedulingAttribution([fresh], patches)[0];
  assert.equal(moved.assignments[0].start, '10:30');
  assert.equal(moved.updatedAt, 'newer');
  assert.equal(moved.bookedByName, 'Original creator');
  assert.deepEqual(applySchedulingAttribution([], patches), []);
  assert.equal(applySchedulingAttribution([{ ...fresh, status: 'cancelled' }], patches)[0].status, 'cancelled');
  await cache.resolve([original.id]);
  assert.equal(calls, 1);
  clock = 101;
  const renew = cache.resolve([original.id]);
  await Promise.resolve();
  complete([{ ...item, createdByName: 'Corrected canonical name' }]);
  assert.equal(applySchedulingAttribution([known], await renew)[0].bookedByName, 'Corrected canonical name');

  clock = 202;
  const partial = cache.resolve([original.id]);
  await Promise.resolve();
  complete([{ appointmentId: original.id }]);
  assert.equal(applySchedulingAttribution([known], await partial)[0].bookedByName, 'Original creator');
  const explicitClear = cache.resolve([original.id]);
  await Promise.resolve();
  complete([{ appointmentId: original.id, createdBy: '', createdByName: '', source: '' }]);
  assert.equal(applySchedulingAttribution([known], await explicitClear)[0].bookedByName, undefined);

  clock = 303;
  const previousSession = cache.resolve([original.id]);
  await Promise.resolve();
  cache.clear();
  complete([item]);
  assert.equal((await previousSession).size, 0, 'invalidation rejects a late previous-session result');
  const isolated = createSchedulingAttributionCache(async () => [], bookingActorLabel);
  assert.equal((await isolated.resolve([original.id])).size, 0, 'another authorized session has no shared names');
  const failing = createSchedulingAttributionCache(async () => { throw Error('Synthetic failure'); }, bookingActorLabel);
  assert.equal(applySchedulingAttribution([known], await failing.resolve([original.id]))[0].bookedByName, 'Original creator');
  console.log('PASS scheduling attribution: retention, identity, expiry, authoritative correction/clear, deduplication, failure, cancellation, move and session invalidation');
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
