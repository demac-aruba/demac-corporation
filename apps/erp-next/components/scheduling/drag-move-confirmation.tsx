'use client';

import styles from './scheduling-overview-v2.module.css';
import { useEffect, useRef } from 'react';
import type { OfficeMoveOvertimeProposal } from '../../lib/office-booking-authority';

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
  overtime?: OfficeMoveOvertimeProposal;
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
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  // Confirmation is a decision surface, not a network progress blocker. Once the
  // operator confirms, the board's existing non-modal move notice owns progress.
  if (busy) return null;

  const supportOnly = move.scope === 'support';
  return <div
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    style={{ position: 'fixed', inset: 0, zIndex: 140, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(8, 20, 38, .42)', backdropFilter: 'blur(2px)' }}
  >
    <aside ref={dialogRef} data-overtime-confirmation={move.overtime ? 'true' : undefined} role="dialog" aria-modal="true" aria-labelledby="drag-confirm-title" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    }} style={{ width: 'min(500px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 40px)', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', boxShadow: '0 24px 70px rgba(10, 24, 44, .28)' }}>
      <header style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ display: 'block', marginBottom: 5, color: 'var(--brand)', fontSize: 9, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase' }}>Booking Intelligence · final validation</span>
        <h2 id="drag-confirm-title" style={{ margin: 0, fontSize: 18 }}>{move.overtime ? 'Traslado con posible overtime' : supportOnly ? 'Confirm support reassignment?' : 'Confirm appointment move?'}</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 11, lineHeight: 1.5 }}>{move.customer} · {supportOnly ? 'Only the support assignment will move.' : 'The linked appointment schedule will move.'}</p>
      </header>

      <div style={{ padding: 20 }}>
        {move.overtime ? <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, border: '1px solid var(--warning)', background: 'color-mix(in srgb,var(--warning) 9%,var(--surface))' }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6 }}>Esta cita requiere {move.overtime.requiredSlots} cupos y la van dispone de {move.overtime.ordinarySlots} cupos ordinarios. El trabajo podría extenderse fuera de su jornada y requerir overtime. ¿Estás consciente y deseas continuar?</p>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
            <dt>Van de destino</dt><dd style={{ margin: 0 }}>{move.overtime.vanName}</dd>
            <dt>Inicio</dt><dd style={{ margin: 0 }}>{formatTime(move.overtime.start)}</dd>
            <dt>Cupos requeridos / ordinarios</dt><dd style={{ margin: 0 }}>{move.overtime.requiredSlots} / {move.overtime.ordinarySlots}</dd>
            <dt>Finalización estimada</dt><dd style={{ margin: 0 }}>{formatTime(move.overtime.estimatedEnd)}</dd>
          </dl>
        </div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
          <div><span style={{ display: 'block', color: 'var(--muted)', fontSize: 8, fontWeight: 800 }}>FROM</span><strong style={{ display: 'block', marginTop: 4, fontSize: 12 }}>{vanLabel(move.fromVanId)}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>{formatTime(move.fromStart)}–{formatTime(move.fromEnd)}</small></div>
          <strong aria-hidden="true" style={{ color: 'var(--brand)', fontSize: 18 }}>→</strong>
          <div><span style={{ display: 'block', color: 'var(--muted)', fontSize: 8, fontWeight: 800 }}>TO</span><strong style={{ display: 'block', marginTop: 4, fontSize: 12 }}>{vanLabel(move.targetVanId)}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>{formatTime(move.targetStart)}–{formatTime(move.targetEnd)}</small></div>
        </div>

        {supportOnly ? <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--text)', fontSize: 10, lineHeight: 1.45 }}>The primary van and the customer-facing appointment remain unchanged.</div> : null}
        {move.customerNotificationRecommended ? <div style={{ marginTop: 12, padding: 10, border: '1px solid color-mix(in srgb,var(--warning) 35%,var(--border))', borderRadius: 8, background: 'color-mix(in srgb,var(--warning) 9%,var(--surface))', color: 'var(--text)', fontSize: 10, lineHeight: 1.45 }}><strong style={{ color: 'var(--warning)' }}>Customer-facing time changes.</strong> Confirming this move will flag the appointment for customer communication.</div> : null}
        <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 9, lineHeight: 1.5 }}>Nothing is saved until you confirm. Choosing No leaves the appointment exactly where it was.</p>
      </div>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }}>
        <button type="button" className={styles.secondary} onClick={onCancel}>{move.overtime ? 'No, cancelar' : 'No, keep original'}</button>
        <button type="button" className={styles.primary} onClick={onConfirm}>{move.overtime ? 'Sí, estoy consciente; mover' : 'Yes, confirm move'}</button>
      </footer>
    </aside>
  </div>;
}
