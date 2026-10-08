'use client';

import { useMemo, useState } from 'react';
import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import { readFieldOfflineDraft } from '@/lib/field-offline';
import {useProcedureForm} from './use-procedure-form';
import {ProcedureFormStatus} from './procedure-form-status';
import type {FieldVisitFormTarget} from '../../lib/field-procedure-capture-store';
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
  target,
}: {
  target:FieldVisitFormTarget|null;
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
  const draft=useProcedureForm(target,'free-text:'+interventionId+':'+sectionId,{value:canonicalValue,baseVersion:String(expectedVersion)},async()=>{
    const original=await readFieldOfflineDraft(draftOwnerUserId,workOrderId,interventionId,sectionId);
    return original?{value:original.value,baseVersion:String(original.baseVersion)}:null;
  });
  const {value}=draft.value;
  const [localError,setLocalError]=useState<string|null>(null);
  const changed=value.trim()!==canonicalValue;
  const stale=draft.value.baseVersion!==String(expectedVersion)&&changed;
  const save=async()=>{
    if(stale||!await draft.flush())return;
    setLocalError(null);
    if(await onSave({interventionId,sectionId,value,expectedVersion})){
      draft.change({value,baseVersion:String(expectedVersion+1)});
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
          disabled={!allowed || !draft.ready || (mutationBusy && !allowDraftWhileOffline)}
          value={value}
          maxLength={5000}
          rows={4}
          onChange={(event) => draft.change({value:event.target.value,baseVersion:changed?draft.value.baseVersion:String(expectedVersion)})}
          placeholder="Registra observaciones técnicas relevantes de esta intervención."
        />
        <small className={styles.helper}>{value.length}/5000 caracteres</small>
      </label>
      <ProcedureFormStatus draft={draft}/>
      {stale?<div role="alert">El servidor tiene una versión distinta. Compara la nota antes de continuar.
        <p>Nota actual del servidor: {canonicalValue||'Sin contenido'}</p>
        <button type="button" disabled={mutationBusy||!draft.ready||draft.saving||Boolean(draft.error)} onClick={()=>draft.change({value,baseVersion:String(expectedVersion)})}>Comparé las notas; conservar mi texto</button>
        <button type="button" disabled={mutationBusy||!draft.ready||draft.saving||Boolean(draft.error)} onClick={()=>draft.change({value:canonicalValue,baseVersion:String(expectedVersion)})}>Usar nota del servidor</button>
      </div>:null}
      {allowed ? (
        <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy || !changed || stale || !draft.ready || draft.saving || Boolean(draft.error)} type="button" onClick={() => void save()}>
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
            key={JSON.stringify([draftOwnerUserId,job.workOrderId,job.fieldVisit?.id,key])}
            target={job.fieldVisit?{ownerUserId:draftOwnerUserId,workOrderId:job.workOrderId,visitId:job.fieldVisit.id}:null}
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
