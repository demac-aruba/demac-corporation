'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAppointmentCharges, type ChargeRecord } from '../../lib/appointment-charges';

const REVALIDATE_AFTER_MS = 30_000;

// This resource belongs only to the mounted appointment. Nothing is cached across
// dialogs or authenticated sessions, and simultaneous read requests share a flight.
// LiveSchedulingOverview keys its subtree by principal ID/active/capabilities; the
// drawer keys the workspace by appointment ID, also clearing drafts on owner change.
export function useAppointmentCharges(appointmentId: string, active: boolean, suspended: boolean, view: 'charges' | 'history' = 'charges') {
  const owner = useMemo(() => ({ alive: false, updatedAt: 0, version: -1, flight: null as Promise<boolean> | null }), [appointmentId]);
  const [snapshot, setSnapshot] = useState({ owner, record: null as ChargeRecord | null, error: '', loading: true, updatedAt: 0 });
  const reload = useCallback((): Promise<boolean> => {
    if (owner.flight) return owner.flight;
    if (!owner.alive) return Promise.resolve(false);
    setSnapshot(previous => ({ ...previous, owner, loading: true }));
    owner.flight = getAppointmentCharges(appointmentId).then(record => {
      if (!owner.alive) return false;
      owner.updatedAt = Date.now();
      owner.version = record.state?.version || 0;
      setSnapshot({ owner, record, error: '', loading: false, updatedAt: owner.updatedAt });
      return true;
    }).catch(cause => {
      if (owner.alive) setSnapshot(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'No se pudieron leer los importes.', loading: false }));
      return false;
    }).finally(() => { owner.flight = null; });
    return owner.flight;
  }, [appointmentId, owner]);

  const ensureVersion = useCallback(async (minimum: number): Promise<boolean> => {
    // A pre-acquisition flight may contain the old version. Complete that flight
    // before requesting a fresh snapshot; never silently rebase an open draft.
    if (owner.flight) await owner.flight;
    if (!owner.alive) return false;
    if (owner.version >= minimum) return true;
    return await reload() && owner.version >= minimum;
  }, [owner, reload]);

  useEffect(() => {
    owner.alive = true;
    setSnapshot({ owner, record: null, error: '', loading: true, updatedAt: 0 });
    void reload();
    return () => { owner.alive = false; };
  }, [owner, reload]);

  useEffect(() => {
    if (!active || suspended) return;
    const refreshIfStale = () => {
      if (document.visibilityState !== 'hidden' && Date.now() - owner.updatedAt >= REVALIDATE_AFTER_MS) void reload();
    };
    refreshIfStale();
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
    // History and finance share a mounted resource and edit session. A view change
    // still checks freshness, without reloading a recent snapshot or an open draft.
  }, [active, suspended, owner, reload, view]);

  return { ...(snapshot.owner === owner ? snapshot : { record: null, error: '', loading: true, updatedAt: 0 }), reload, ensureVersion };
}
