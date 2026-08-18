'use client';

import styles from './scheduling-overview-v2.module.css';

export type PendingDragMove = {
  appointmentId: string;
  assignmentId: string;
  customer: string;
  scope: 'primary' | 'support';
  fromVanId: string;
  fromStart: string;
  fromEnd: string;
  targetVanId: string;
  targetStart: string;
  targetEnd: string;
  customerNotificationRecommended: boolean;
};

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function vanLabel(value: string) {
  return value.replace('VAN-', 'Van ');
}

export function DragMoveConfirmation({
  move,
  onCancel,
  onConfirm,
  busy = false,
}: {
  move: PendingDragMove;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const supportOnly = move.scope === 'support';
  return <div
    role="presentation"
    onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}
    style={{ position: 'fixed', inset: 0, zIndex: 140, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(8, 20, 38, .42)', backdropFilter: 'blur(2px)' }}
  >
    <aside role="dialog" aria-modal="true" aria-labelledby="drag-confirm-title" aria-busy={busy} style={{ width: 'min(440px, calc(100vw - 32px))', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', boxShadow: '0 24px 70px rgba(10, 24, 44, .28)' }}>
      <header style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ display: 'block', marginBottom: 5, color: 'var(--brand)', fontSize: 9, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>Booking Intelligence · final validation</span>
        <h2 id="drag-confirm-title" style={{ margin: 0, fontSize: 18 }}>{supportOnly ? 'Confirm support reassignment?' : 'Confirm appointment move?'}</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 11, lineHeight: 1.5 }}>{move.customer} · {supportOnly ? 'Only the support assignment will move.' : 'The linked appointment schedule will move.'}</p>
      </header>

      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
          <div><span style={{ display: 'block', color: 'var(--muted)', fontSize: 8, fontWeight: 800 }}>FROM</span><strong style={{ display: 'block', marginTop: 4, fontSize: 12 }}>{vanLabel(move.fromVanId)}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>{formatTime(move.fromStart)}–{formatTime(move.fromEnd)}</small></div>
          <strong aria-hidden="true" style={{ color: 'var(--brand)', fontSize: 18 }}>→</strong>
          <div><span style={{ display: 'block', color: 'var(--muted)', fontSize: 8, fontWeight: 800 }}>TO</span><strong style={{ display: 'block', marginTop: 4, fontSize: 12 }}>{vanLabel(move.targetVanId)}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>{formatTime(move.targetStart)}–{formatTime(move.targetEnd)}</small></div>
        </div>

        {supportOnly ? <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--text)', fontSize: 10, lineHeight: 1.45 }}>The primary van and the customer-facing appointment remain unchanged.</div> : null}
        {move.customerNotificationRecommended ? <div style={{ marginTop: 12, padding: 10, border: '1px solid color-mix(in srgb,var(--warning) 35%,var(--border))', borderRadius: 8, background: 'color-mix(in srgb,var(--warning) 9%,var(--surface))', color: 'var(--text)', fontSize: 10, lineHeight: 1.45 }}><strong style={{ color: 'var(--warning)' }}>Customer-facing time changes.</strong> Confirming this move will flag the appointment for customer communication.</div> : null}
        <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 9, lineHeight: 1.5 }}>{busy ? 'Booking Authority is validating the destination and saving the move. This dialog will close as soon as the committed appointment is returned.' : 'Nothing is saved until you confirm. Choosing No leaves the appointment exactly where it was.'}</p>
      </div>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>No, keep original</button>
        <button type="button" className={styles.primary} onClick={onConfirm} disabled={busy}>{busy ? 'Moving…' : 'Yes, confirm move'}</button>
      </footer>
    </aside>
  </div>;
}
