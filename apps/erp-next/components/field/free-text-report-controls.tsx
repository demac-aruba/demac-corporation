'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

export type ReportFreeTextInput = {
  interventionId: string;
  sectionId: string;
  value: string;
  expectedVersion: number;
};

function FreeTextSection({
  interventionId,
  sectionId,
  title,
  required,
  canonicalValue,
  expectedVersion,
  allowed,
  mutationBusy,
  saving,
  onSave,
}: {
  interventionId: string;
  sectionId: string;
  title: string;
  required: boolean;
  canonicalValue: string;
  expectedVersion: number;
  allowed: boolean;
  mutationBusy: boolean;
  saving: boolean;
  onSave: (input: ReportFreeTextInput) => Promise<boolean>;
}) {
  const [value, setValue] = useState(canonicalValue);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setValue(canonicalValue);
  }, [canonicalValue, expectedVersion]);

  const changed = value.trim() !== canonicalValue;
  const save = async () => {
    if (value.length > 5000) {
      setLocalError('La nota técnica no puede superar 5000 caracteres.');
      return;
    }
    setLocalError(null);
    await onSave({ interventionId, sectionId, value, expectedVersion });
  };

  return (
    <div className={styles.interventionForm}>
      <strong>{title}</strong>
      <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        {required ? 'Requerida' : 'Opcional'} · {canonicalValue ? 'guardada' : 'sin contenido'} · versión {expectedVersion}
      </div>
      <label style={{ gridColumn: '1 / -1' }}>
        <span>Nota técnica</span>
        <textarea
          className={styles.select}
          disabled={!allowed || mutationBusy}
          value={value}
          maxLength={5000}
          rows={4}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Registra observaciones técnicas relevantes de esta intervención."
        />
        <small className={styles.helper}>{value.length}/5000 caracteres</small>
      </label>
      {allowed ? (
        <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy || !changed} type="button" onClick={() => void save()}>
          {saving ? 'Guardando nota…' : 'Guardar nota'}
        </button>
      ) : (
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Field Authority no autoriza editar esta nota en el estado actual.
        </p>
      )}
      {localError ? <div className={styles.mutationError} style={{ gridColumn: '1 / -1' }}>{localError}</div> : null}
    </div>
  );
}

export function FreeTextReportControls({
  job,
  mutationBusy,
  savingKey,
  error,
  onSave,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  savingKey: string | null;
  error: string | null;
  onSave: (input: ReportFreeTextInput) => Promise<boolean>;
}) {
  const optionsByIntervention = useMemo(() => new Map(
    job.reportFreeTextOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportFreeTextOptions]);

  const sections = job.interventionReports.flatMap((report) => {
    const allowedSections = optionsByIntervention.get(report.interventionId) ?? new Set<string>();
    const responseBySectionId = new Map(report.freeTextResponses.map((response) => [response.sectionId, response]));
    return report.template.sections
      .filter((section) => section.type === 'free_text')
      .map((section) => {
        const response = responseBySectionId.get(section.id);
        return {
          interventionId: report.interventionId,
          sectionId: section.id,
          title: section.title,
          required: section.required,
          canonicalValue: response?.value ?? '',
          expectedVersion: response?.version ?? 0,
          allowed: allowedSections.has(section.id),
        };
      });
  });

  if (sections.length === 0) return null;
  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>NOTAS TÉCNICAS DEL REPORTE</div>
      <p className={styles.helper}>Cada sección conserva una sola nota canónica, versionada y corregible.</p>
      {sections.map((section) => {
        const key = `${section.interventionId}:${section.sectionId}`;
        return (
          <FreeTextSection
            key={key}
            {...section}
            mutationBusy={mutationBusy}
            saving={savingKey === key}
            onSave={onSave}
          />
        );
      })}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
