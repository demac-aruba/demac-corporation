'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import { deleteFieldOfflineDraft, readFieldOfflineDraft, saveFieldOfflineDraft } from '@/lib/field-offline';
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
  allowDraftWhileOffline,
  draftOwnerUserId,
  workOrderId,
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
  allowDraftWhileOffline: boolean;
  draftOwnerUserId: string;
  workOrderId: string;
  onSave: (input: ReportFreeTextInput) => Promise<boolean>;
}) {
  const [value, setValue] = useState(canonicalValue);
  const [localError, setLocalError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const editRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    const editRevision = editRevisionRef.current;
    setValue(canonicalValue);
    setDraftNotice(null);
    void readFieldOfflineDraft(draftOwnerUserId, workOrderId, interventionId, sectionId).then(async (draft) => {
      if (!active || !draft || editRevisionRef.current !== editRevision) return;
      if (draft.value.trim() === canonicalValue) {
        await deleteFieldOfflineDraft(draftOwnerUserId, workOrderId, interventionId, sectionId);
      } else if (draft.baseVersion === expectedVersion) {
        setValue(draft.value);
        setDraftNotice('Borrador recuperado de este dispositivo; todavía no es contenido canónico.');
      } else {
        setDraftNotice(`Hay un borrador basado en la versión ${draft.baseVersion}; no se aplicó porque el servidor ya muestra la versión ${expectedVersion}.`);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [canonicalValue, draftOwnerUserId, expectedVersion, interventionId, sectionId, workOrderId]);

  useEffect(() => {
    if (value.trim() === canonicalValue || value.length > 5000) return undefined;
    const timer = window.setTimeout(() => {
      void saveFieldOfflineDraft({
        ownerUserId: draftOwnerUserId, workOrderId, interventionId, sectionId, baseVersion: expectedVersion, value,
      }).then(() => setDraftNotice('Borrador guardado en este dispositivo; todavía no es contenido canónico.')).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [canonicalValue, draftOwnerUserId, expectedVersion, interventionId, sectionId, value, workOrderId]);

  const changed = value.trim() !== canonicalValue;
  const save = async () => {
    if (value.length > 5000) {
      setLocalError('La nota técnica no puede superar 5000 caracteres.');
      return;
    }
    setLocalError(null);
    if (await onSave({ interventionId, sectionId, value, expectedVersion })) {
      await deleteFieldOfflineDraft(draftOwnerUserId, workOrderId, interventionId, sectionId).catch(() => undefined);
      setDraftNotice(null);
    }
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
          disabled={!allowed || (mutationBusy && !allowDraftWhileOffline)}
          value={value}
          maxLength={5000}
          rows={4}
          onChange={(event) => { editRevisionRef.current += 1; setValue(event.target.value); }}
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
      {draftNotice ? <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>{draftNotice}</div> : null}
    </div>
  );
}

export function FreeTextReportControls({
  job,
  mutationBusy,
  savingKey,
  error,
  draftOwnerUserId,
  allowDraftWhileOffline,
  onSave,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  savingKey: string | null;
  error: string | null;
  draftOwnerUserId: string;
  allowDraftWhileOffline: boolean;
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
            allowDraftWhileOffline={allowDraftWhileOffline}
            draftOwnerUserId={draftOwnerUserId}
            workOrderId={job.workOrderId}
            onSave={onSave}
          />
        );
      })}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
