'use client';
import { useEffect, useRef, useState } from 'react';
import { confirmOfficeAppointment, createOfficeTemporaryHold } from '@/lib/office-booking-authority';
import { createProjectBookingRecovery } from '@/lib/projects/booking-recovery';

/** Restore before enabling ANY replacement write in this drawer, even after new-booking rollback. */
export function useBookingRecovery(uid: string, canManage: boolean, requireIdentity = false) {
  const identity = useRef({ uid, canManage });
  identity.current = { uid, canManage };
  const [state, setState] = useState<{ uid: string; controller: ReturnType<typeof createProjectBookingRecovery> | null; error: string }>({ uid: '', controller: null, error: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!uid && !requireIdentity) { setState({ uid, controller: null, error: '' }); return; }
    try {
      const controller = createProjectBookingRecovery({
        uid, storage: window.sessionStorage,
        authorized: () => {
          if (identity.current.uid !== uid || !identity.current.canManage) return false;
          try { return JSON.parse(window.sessionStorage.getItem('demac.erp-next.firebase.session.v1') || 'null')?.uid === uid; }
          catch { return false; }
        },
        send: (mode, command) => mode === 'temporary_hold' ? createOfficeTemporaryHold(command) : confirmOfficeAppointment(command),
      });
      setState({ uid, controller, error: '' });
    } catch (error) {
      setState({ uid, controller: null, error: error instanceof Error ? error.message : 'Booking recovery could not be initialized.' });
    }
  }, [uid, requireIdentity]);
  const current = state.uid === uid ? state : null;
  const pending = current?.controller?.pending() ?? null;
  useEffect(() => {
    if (!pending) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [Boolean(pending), tick]);
  return {
    controller: current?.controller ?? null,
    blocked: !current || Boolean(current.error) || Boolean(pending), pending,
    error: current?.error || '', sync: () => setTick(value => value + 1),
  };
}
