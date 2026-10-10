'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAppointmentCharges, type ChargeRecord } from '../../lib/appointment-charges';

const REVALIDATE_AFTER_MS = 30_000;

// This resource belongs only to the mounted appointment. Nothing is cached across
// dialogs or authenticated sessions, and simultaneous read requests share a flight.
// LiveSchedulingOverview keys its subtree by principal ID/active/capabilities; the
// drawer keys the workspace by appointment ID, also clearing drafts on owner change.
export function useAppointmentCharges(appointmentId: string, active: boolean, suspended: boolean) {
  const owner = useMemo(() => ({ alive: false, updatedAt: 0, flight: null as Promise<boolean> | null }), [appointmentId]);
  const [snapshot, setSnapshot] = useState({ owner, record: null as ChargeRecord | null, error: '', loading: true, updatedAt: 0 });
  const reload = useCallback((): Promise<boolean> => {
    if (owner.flight) return owner.flight;
    if (!owner.alive) return Promise.resolve(false);
    setSnapshot(previous => ({ ...previous, owner, loading: true }));
    owner.flight = getAppointmentCharges(appointmentId).then(record => {
      if (!owner.alive) return false;
      owner.updatedAt = Date.now();
      setSnapshot({ owner, record, error: '', loading: false, updatedAt: owner.updatedAt });
      return true;
    }).catch(cause => {
      if (owner.alive) setSnapshot(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'No se pudieron leer los importes.', loading: false }));
      return false;
    }).finally(() => { owner.flight = null; });
    return owner.flight;
  }, [appointmentId, owner]);

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
  }, [active, suspended, owner, reload]);

  return { ...(snapshot.owner === owner ? snapshot : { record: null, error: '', loading: true, updatedAt: 0 }), reload };
}
