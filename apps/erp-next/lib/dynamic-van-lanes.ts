export type DynamicVanRegistryEntry = {
  id: string;
  name?: string;
  active?: boolean;
};

export type DynamicVanLane = {
  id: string;
  name: string;
  source: 'registry' | 'observed';
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function fallbackVanName(id: string) {
  const match = id.match(/^VAN-(\d+)$/i);
  return match ? `Van ${Number(match[1])}` : id;
}

/** Registry order owns the lane order. Observed assignment IDs are appended so a
 * temporary registry read failure or stale master-data snapshot never hides work. */
export function deriveDynamicVanLanes(
  registry: Iterable<DynamicVanRegistryEntry> | null | undefined,
  observedVanIds: Iterable<string>,
) {
  const lanes: DynamicVanLane[] = [];
  const seen = new Set<string>();
  for (const van of registry ?? []) {
    const id = text(van.id);
    if (!id || van.active === false || seen.has(id)) continue;
    seen.add(id);
    lanes.push({ id, name: text(van.name) || fallbackVanName(id), source: 'registry' });
  }
  for (const value of observedVanIds) {
    const id = text(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    lanes.push({ id, name: fallbackVanName(id), source: 'observed' });
  }
  return lanes;
}

/** Report only assignments absent from the registry snapshot. The derived lane list
 * also contains observed fallbacks, so using it for this comparison hides drift. */
export function observedOnlyVanIds(
  registry: Iterable<DynamicVanRegistryEntry> | null | undefined,
  observedVanIds: Iterable<string>,
) {
  const registryIds = new Set<string>();
  for (const van of registry ?? []) {
    const id = text(van.id);
    if (id) registryIds.add(id);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of observedVanIds) {
    const id = text(value);
    if (!id || registryIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
