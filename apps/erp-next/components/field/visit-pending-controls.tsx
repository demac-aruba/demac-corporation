'use client';

import { useState } from 'react';
import styles from './technician-field-home.module.css';

export type VisitPendingInput = {
  target: 'pending';
  pendingReason: string;
  pendingAction: string;
};

export function VisitPendingControls({
  disabled,
  saving,
  onSubmit,
}: {
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitPendingInput) => void;
}) {
  const [pendingReason, setPendingReason] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const reason = pendingReason.trim();

  return (
    <div className={styles.interventionForm}>
      <strong>Dejar la visita pendiente</strong>
      <p className={styles.helper}>Conserva el motivo operativo y la próxima acción sin cerrar el trabajo ni borrar lo ya realizado.</p>
      <label>
        <span>Motivo pendiente</span>
        <textarea
          className={styles.select}
          disabled={disabled}
          maxLength={1000}
          onChange={(event) => setPendingReason(event.target.value)}
          placeholder="Ej. Hace falta una tarjeta electrónica compatible"
          rows={3}
          value={pendingReason}
        />
      </label>
      <label>
        <span>Próxima acción (opcional)</span>
        <textarea
          className={styles.select}
          disabled={disabled}
          maxLength={1500}
          onChange={(event) => setPendingAction(event.target.value)}
          placeholder="Ej. Oficina confirma disponibilidad y coordina la continuación"
          rows={2}
          value={pendingAction}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled || !reason}
        onClick={() => onSubmit({ target: 'pending', pendingReason: reason, pendingAction: pendingAction.trim() })}
        type="button"
      >
        {saving ? 'Guardando…' : 'Dejar pendiente'}
      </button>
    </div>
  );
}
