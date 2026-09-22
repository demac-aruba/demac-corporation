import type { BrowserAppointmentRecord } from './browser-operational';
import type { OfficeAppointmentAttribution } from './office-booking-authority';

export type AttributionFields = Pick<BrowserAppointmentRecord, 'bookedById' | 'bookedByName' | 'bookedBySource'>;
export type AttributionPatches = ReadonlyMap<string, AttributionFields>;

export function schedulingAttributionAuthorizationLost(error: unknown) {
  // The existing Office transport includes the canonical error code in its message.
  return error instanceof Error && /\((?:unauthenticated|permission-denied)\)|Firebase authentication is required|INVALID_REFRESH_TOKEN|USER_DISABLED|TOKEN_EXPIRED/.test(error.message);
}

/** The incoming operational list owns membership. Metadata can never restore a removed job. */
export function retainSchedulingAttribution(current: BrowserAppointmentRecord[], incoming: BrowserAppointmentRecord[]) {
  const previous = new Map(current.map((item) => [item.id, item]));
  return incoming.map((item) => {
    const known = previous.get(item.id);
    return known ? { ...item,
      bookedById: item.bookedById ?? known.bookedById,
      bookedByName: item.bookedByName ?? known.bookedByName,
      bookedBySource: item.bookedBySource ?? known.bookedBySource,
    } : item;
  });
}

/** Never replay operational fields (including updatedAt) from an attribution request. */
export function applySchedulingAttribution(current: BrowserAppointmentRecord[], patches: AttributionPatches) {
  return current.map((item) => {
    const patch = patches.get(item.id);
    if (!patch) return item;
    if (item.bookedById === patch.bookedById && item.bookedByName === patch.bookedByName
      && item.bookedBySource === patch.bookedBySource) return item;
    return { ...item, ...patch };
  });
}

/** One instance per authorized view/session. No module-global or browser-persisted names. */
export function createSchedulingAttributionCache(
  load: (ids: string[]) => Promise<OfficeAppointmentAttribution[]>,
  label: (item: OfficeAppointmentAttribution) => string,
  now = Date.now,
  ttl = 5 * 60_000,
) {
  const cache = new Map<string, { expiresAt: number; value: AttributionFields }>();
  const pending = new Map<string, Promise<void>>();
  let generation = 0;
  let authorizationError: unknown = null;
  return {
    clear() { generation += 1; cache.clear(); pending.clear(); authorizationError = null; },
    async resolve(ids: string[]): Promise<AttributionPatches> {
      if (authorizationError) throw authorizationError;
      const epoch = generation;
      const unique = [...new Set(ids.filter(Boolean))];
      for (const [id, entry] of cache) if (entry.expiresAt <= now()) cache.delete(id);
      const missing = unique.filter((id) => !cache.has(id) && !pending.has(id));
      if (missing.length) {
        const requested = new Set(missing);
        const request = Promise.resolve().then(() => load(missing)).then((items) => {
          if (generation !== epoch || authorizationError) return;
          for (const item of items) {
            // An absent/partial response is unknown, not an authoritative deletion.
            if (!requested.has(item.appointmentId)
              || typeof item.createdBy !== 'string' || typeof item.createdByName !== 'string'
              || typeof item.source !== 'string') continue;
            cache.set(item.appointmentId, { expiresAt: now() + ttl, value: {
              bookedById: item.createdBy.trim() || undefined,
              bookedByName: label(item) || undefined,
              bookedBySource: item.source.trim() || undefined,
            } });
          }
        }).catch((error: unknown) => {
          if (generation === epoch && schedulingAttributionAuthorizationLost(error)) {
            authorizationError = error;
            cache.clear();
          }
          throw error;
        }).finally(() => {
          for (const id of missing) if (pending.get(id) === request) pending.delete(id);
        });
        for (const id of missing) pending.set(id, request);
      }
      // A failed supplemental read must not discard cached results for unrelated IDs.
      await Promise.allSettled([...new Set(unique.map((id) => pending.get(id)).filter(Boolean))]);
      if (generation !== epoch) return new Map();
      if (authorizationError) throw authorizationError;
      return new Map(unique.flatMap((id) => {
        const entry = cache.get(id);
        return entry ? [[id, entry.value] as const] : [];
      }));
    },
  };
}
