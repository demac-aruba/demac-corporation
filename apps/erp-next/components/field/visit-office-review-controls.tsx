import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

function statusMessage(job: FieldExecutionJobDetail) {
  const submission = job.officeReviewSubmission;
  if (!submission) return 'Primero inicia una visita física para habilitar la revisión.';
  if (submission.status === 'pending') return `Revisión ${submission.revisionNumber ?? 1} enviada y pendiente de la oficina.`;
  if (submission.status === 'approved') return 'La oficina aprobó esta revisión. El registro queda bloqueado.';
  if (submission.status === 'returned') return 'La oficina devolvió esta revisión. Corrige los puntos indicados antes de reenviar.';
  if (submission.allowed) return 'La verdad canónica está completa y lista para revisión de oficina.';
  return 'Todavía hay validaciones obligatorias antes de enviar.';
}

export function VisitOfficeReviewControls({
  job,
  disabled,
  saving,
  error,
  correctionNote,
  onCorrectionNoteChange,
  onSubmit,
}: {
  job: FieldExecutionJobDetail;
  disabled: boolean;
  saving: boolean;
  error: string | null;
  correctionNote: string;
  onCorrectionNoteChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const submission = job.officeReviewSubmission;
  if (!job.fieldVisit) return null;

  return (
    <section className={styles.section}>
      <h2>ENVÍO A REVISIÓN DE OFICINA</h2>
      <div className={styles.planned}>
        <div className={styles.plannedTitle}>Control separado del reporte profesional</div>
        <strong>{statusMessage(job)}</strong>
        <p>El envío congela una revisión derivada de la verdad canónica. No envía nada al cliente.</p>
      </div>
      {submission?.correctionRequired ? (
        <div className={styles.planned} style={{ marginTop: 12 }}>
          <div className={styles.plannedTitle}>Corrección solicitada por la oficina</div>
          <strong>{submission.reviewerNote}</strong>
          <label className={styles.helper} htmlFor="office-review-correction-note">Describe qué corregiste antes de reenviar.</label>
          <textarea
            className={styles.textarea}
            disabled={disabled || saving}
            id="office-review-correction-note"
            maxLength={1500}
            onChange={(event) => onCorrectionNoteChange(event.target.value)}
            placeholder="Ej. Aclaré la condición final del equipo y la conclusión para el cliente."
            rows={3}
            value={correctionNote}
          />
        </div>
      ) : null}
      {submission?.blockers.length ? (
        <div className={styles.infoGrid} style={{ marginTop: 12 }}>
          {submission.blockers.map((blocker) => (
            <div className={styles.info} key={`${blocker.code}:${blocker.entityId ?? ''}`}>
              <span>{blocker.code.replaceAll('_', ' ')}</span>
              <strong>{blocker.message}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {submission?.allowed ? (
        <div className={styles.visitActions}>
          <button
            className={`${styles.action} ${styles.primary}`}
            disabled={disabled || saving || (submission.correctionRequired && correctionNote.trim().length < 3)}
            onClick={onSubmit}
            type="button"
          >
            {saving ? 'Enviando…' : submission.revisionNumber ? 'Reenviar corrección a oficina' : 'Enviar a Office Review'}
          </button>
        </div>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </section>
  );
}
