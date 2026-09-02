'use client';

import styles from './technician-field-home.module.css';

export function VisitReturnCreationControls({ disabled, saving, onCreate }: {
  disabled: boolean;
  saving: boolean;
  onCreate: () => void;
}) {
  return (
    <div className={styles.interventionForm}>
      <strong>Preparar la segunda visita física</strong>
      <p className={styles.helper}>Crea una WorkVisit nueva y conserva esta visita como historial. No modifica la programación ni el WorkOrder.</p>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled}
        onClick={onCreate}
        type="button"
      >
        {saving ? 'Creando…' : 'Crear visita de retorno'}
      </button>
    </div>
  );
}
