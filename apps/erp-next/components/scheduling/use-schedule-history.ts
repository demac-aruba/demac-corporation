'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { callOfficeBookingAuthority } from '../../lib/office-booking-authority';
import { loadLiveSchedulingReferenceData, type LiveSchedulingReferenceData } from '../../lib/live-scheduling-fast';
import { schedulingAttributionAuthorizationLost } from '../../lib/scheduling-attribution';
import { projectSlotHistory, type ScheduleHistoryAppointment, type ScheduleHistoryPage, type SlotHistoryItem } from '../../lib/scheduling-slot-history';

/** Session-local read cache; never persisted or consumed by capacity calculations. */
export function useScheduleHistory(onAuthorizationLost: () => void) {
  const [items, setItems] = useState<SlotHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const records = useRef(new Map<string, ScheduleHistoryAppointment>());
  const checkpoint = useRef('');
  const controller = useRef<AbortController | null>(null);
  const reloadRequested = useRef(false);
  const mounted = useRef(false);
  const authLost = useRef(onAuthorizationLost);
  authLost.current = onAuthorizationLost;
  const refresh = useCallback(async (full = false) => {
    if (!mounted.current) return;
    if (controller.current) { if (full) reloadRequested.current = true; return; }
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    // Only advance after BOTH initial streams / ALL delta pages are read. Failed
    // pages retain the old checkpoint; replay merges by canonical identity.
    const since = full ? '' : checkpoint.current;
    const pending = new Map(full ? [] : records.current);
    let cursor: ScheduleHistoryPage['nextCursor'] = null;
    try {
      const referencesPromise = loadLiveSchedulingReferenceData();
      let nextCheckpoint = '';
      do {
        if (request.signal.aborted) return;
        const [page, references]: [ScheduleHistoryPage, LiveSchedulingReferenceData] = await Promise.all([
          callOfficeBookingAuthority<ScheduleHistoryPage>('list_schedule_history', { since, cursor }, 15_000, request.signal),
          referencesPromise,
        ]);
        for (const appointment of page.appointments) pending.set(appointment.appointmentId, appointment);
        nextCheckpoint = page.checkpoint;
        cursor = page.nextCursor;
        if (!request.signal.aborted && mounted.current) setItems(projectSlotHistory([...pending.values()], references));
      } while (cursor);
      if (!request.signal.aborted && mounted.current) { records.current = pending; checkpoint.current = nextCheckpoint; }
    } catch (cause) {
      if (request.signal.aborted || !mounted.current) return;
      if (schedulingAttributionAuthorizationLost(cause) || (cause instanceof Error && /permission[_-]denied|unauthenticated/.test(cause.message))) {
        records.current.clear(); checkpoint.current = ''; setItems([]); authLost.current();
      }
      setError('No se pudo completar el historial. Las notas pueden estar incompletas; reintenta la carga.');
    } finally {
      if (controller.current === request) controller.current = null;
      if (mounted.current && !request.signal.aborted) {
        setLoading(false);
        if (reloadRequested.current) { reloadRequested.current = false; void refresh(true); }
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    // Let the board establish/invalidate its shared reference cache first.
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; controller.current?.abort(); controller.current = null; window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  return { items, loading, error, refresh };
}
