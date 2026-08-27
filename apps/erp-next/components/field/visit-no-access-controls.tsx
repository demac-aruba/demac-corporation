'use client';

import { useState } from 'react';
import styles from './technician-field-home.module.css';

export type VisitNoAccessInput = {
  target: 'no_access';
  noAccessReason: string;
};

export function VisitNoAccessControls({
  disabled,
  saving,
  onSubmit,
}: {
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitNoAccessInput) => void;
}) {
  const [noAccessReason, setNoAccessReason] = useState('');
  const reason = noAccessReason.trim();

  return (
    <div className={styles.interventionForm}>
      <strong>Cerrar por falta de acceso</strong>
      <p className={styles.helper}>Registra por qué no fue posible acceder al lugar. Esta acción cierra la visita física.</p>
      <label>
        <span>Motivo de falta de acceso</span>
        <textarea
          className={styles.select}
          disabled={disabled}
          maxLength={1000}
          onChange={(event) => setNoAccessReason(event.target.value)}
          placeholder="Ej. Propiedad cerrada y cliente no respondió"
          rows={3}
          value={noAccessReason}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled || !reason}
        onClick={() => onSubmit({ target: 'no_access', noAccessReason: reason })}
        type="button"
      >
        {saving ? 'Guardando…' : 'Confirmar sin acceso'}
      </button>
    </div>
  );
}
