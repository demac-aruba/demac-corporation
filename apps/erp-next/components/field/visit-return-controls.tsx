'use client';

import { useState } from 'react';
import styles from './technician-field-home.module.css';

export type VisitReturnInput = {
  target: 'requires_return_visit';
  secondVisitReason: string;
};

export function VisitReturnControls({ disabled, saving, onSubmit }: {
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitReturnInput) => void;
}) {
  const [secondVisitReason, setSecondVisitReason] = useState('');
  const reason = secondVisitReason.trim();

  return (
    <div className={styles.interventionForm}>
      <strong>Requiere una visita de retorno</strong>
      <p className={styles.helper}>Explica por qué el trabajo necesita otra visita física. Este paso no crea todavía la segunda visita.</p>
      <label>
        <span>Motivo del retorno</span>
        <textarea
          className={styles.select}
          disabled={disabled}
          maxLength={1000}
          onChange={(event) => setSecondVisitReason(event.target.value)}
          placeholder="Ej. Se necesita instalar el repuesto solicitado"
          rows={3}
          value={secondVisitReason}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled || !reason}
        onClick={() => onSubmit({ target: 'requires_return_visit', secondVisitReason: reason })}
        type="button"
      >
        {saving ? 'Guardando…' : 'Marcar retorno requerido'}
      </button>
    </div>
  );
}
