import assert from 'node:assert/strict';
import { deriveDynamicVanLanes, observedOnlyVanIds } from '../lib/dynamic-van-lanes';

const futureVanId = 'VAN-FUTURE-TEST-947';
const registryLanes = deriveDynamicVanLanes([
  { id: 'VAN-1', name: 'Van 1', active: true },
  { id: 'VAN-5', name: 'Van 5', active: true },
  { id: futureVanId, name: 'Future Test Field Van', active: true },
], ['VAN-5', futureVanId, 'OBSERVED-RESCUE-VAN']);

assert.deepEqual(registryLanes.map((lane) => lane.id), ['VAN-1', 'VAN-5', futureVanId, 'OBSERVED-RESCUE-VAN']);
assert.equal(registryLanes[2].name, 'Future Test Field Van');
assert.equal(registryLanes[3].source, 'observed');
assert.deepEqual(
  observedOnlyVanIds([
    { id: 'VAN-1', active: true },
    { id: 'VAN-5', active: false },
    { id: futureVanId, active: true },
  ], ['VAN-1', 'VAN-5', futureVanId, 'OBSERVED-RESCUE-VAN', 'OBSERVED-RESCUE-VAN']),
  ['OBSERVED-RESCUE-VAN'],
  'Registry IDs must remain distinct from observed fallback lanes so drift is visible exactly once.',
);

const fallbackLanes = deriveDynamicVanLanes(null, [futureVanId, 'VAN-2', futureVanId]);
assert.deepEqual(fallbackLanes.map((lane) => lane.id), [futureVanId, 'VAN-2']);
assert.equal(fallbackLanes[1].name, 'Van 2');
assert.equal(fallbackLanes.every((lane) => lane.source === 'observed'), true);

const renamed = deriveDynamicVanLanes([{ id: 'RESOURCE-RENAMED-82917', name: 'Future Test Field Van' }], []);
assert.deepEqual(renamed.map(({ name, source }) => ({ name, source })), [{ name: 'Future Test Field Van', source: 'registry' }]);

for (const fleetSize of [1, 5, 8, 15]) {
  const fleet = Array.from({ length: fleetSize }, (_, index) => ({
    id: `RESOURCE-${fleetSize}-${index + 1}`,
    name: `Configured Team ${index + 1}`,
    active: true,
  }));
  const lanes = deriveDynamicVanLanes(fleet, fleet.map((van) => van.id));
  assert.equal(lanes.length, fleetSize, `${fleetSize}-Van fleet must render every canonical registry lane exactly once.`);
  assert.deepEqual(lanes.map((lane) => lane.name), fleet.map((van) => van.name), `${fleetSize}-Van fleet must preserve configured display names.`);
}

console.log('Dynamic Van lanes acceptance passed: registry order and names win, opaque future IDs remain visible, and failed registry loads fall back only to observed assignments.');
