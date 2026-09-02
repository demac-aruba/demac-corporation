'use client';

import { useState } from 'react';
import styles from './technician-field-home.module.css';

export type VisitCancellationInput = {
  target: 'cancelled';
  cancellationReason: string;
};

export function VisitCancellationControls({
  disabled,
  saving,
  onSubmit,
}: {
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitCancellationInput) => void;
}) {
  const [cancellationReason, setCancellationReason] = useState('');
  const reason = cancellationReason.trim();

  return (
    <div className={styles.interventionForm}>
      <strong>Cancelar esta visita</strong>
      <p className={styles.helper}>Registra por qué debe terminar esta visita física. La programación y el Work Order no se cancelan desde aquí.</p>
      <label>
        <span>Motivo de cancelación</span>
        <textarea
          className={styles.select}
          disabled={disabled}
          maxLength={1000}
          onChange={(event) => setCancellationReason(event.target.value)}
          placeholder="Ej. El cliente solicitó detener esta visita"
          rows={3}
          value={cancellationReason}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled || !reason}
        onClick={() => onSubmit({ target: 'cancelled', cancellationReason: reason })}
        type="button"
      >
        {saving ? 'Guardando…' : 'Confirmar cancelación'}
      </button>
    </div>
  );
}
