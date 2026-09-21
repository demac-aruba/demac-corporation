'use client';
import { useEffect, useState } from 'react';
import { OFFICE_LIFECYCLE_CHANGED, officeLifecycleRecovery } from '../../lib/office-booking-authority';
import { loadFirebaseWebSession } from '../../lib/firebase/session';
import type { LifecycleCommand } from '../../lib/office-lifecycle-recovery';

export function OfficeLifecycleRecovery({ onRecovered }: { onRecovered: () => Promise<void> | void }) {
  const [view, setView] = useState<{ uid: string; pending: LifecycleCommand | null; error: string; running: boolean } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const update = () => {
      const uid = loadFirebaseWebSession()?.uid || '';
      if (!uid) { setView(null); return; }
      try { const recovery = officeLifecycleRecovery(); setView({ uid, pending: recovery.pending(), running: recovery.isRunning(), error: '' }); }
      catch { setView({ uid, pending: null, running: false, error: 'The pending change needs review. Its recovery record was preserved.' }); }
    };
    update();
    window.addEventListener(OFFICE_LIFECYCLE_CHANGED, update);
    window.addEventListener('focus', update);
    const timer = window.setInterval(update, 1000);
    return () => { window.clearInterval(timer); window.removeEventListener(OFFICE_LIFECYCLE_CHANGED, update); window.removeEventListener('focus', update); };
  }, []);
  const retry = async () => {
    const uid = view?.uid;
    if (!uid || loadFirebaseWebSession()?.uid !== uid) return;
    setMessage('');
    try {
      await officeLifecycleRecovery().retry();
      if (loadFirebaseWebSession()?.uid !== uid) return;
      try { await onRecovered(); } catch { setMessage('The change was verified. Reload Scheduling to refresh its display.'); }
    } catch (error) {
      if (loadFirebaseWebSession()?.uid === uid) setMessage(error instanceof Error ? error.message : 'The original change is still pending.');
    }
  };
  if (!view || view.uid !== loadFirebaseWebSession()?.uid || (!view.pending && !view.error && !message)) return null;
  return <section role="status" aria-label="Appointment change recovery" style={{ position: 'fixed', zIndex: 2000, right: 16, bottom: 16,
    width: 'min(400px, calc(100vw - 32px))', padding: 16, border: '1px solid var(--border)', borderRadius: 12,
    background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 4px 24px #0003', display: 'grid', gap: 10 }}>
    <strong>{view.running ? 'Verifying appointment change…' : 'Appointment change recovery'}</strong>
    {view.pending ? <span>Appointment {view.pending.data.appointmentId}: the original {view.pending.action === 'cancel_appointment' ? 'cancellation' : 'change'} is pending verification. Recover it before starting another change.</span> : null}
    {view.error || message ? <span>{view.error || message}</span> : null}
    {view.pending ? <button type="button" disabled={view.running} onClick={() => void retry()}>Recover original change</button> : null}
  </section>;
}
