'use client';

import { useMemo, useState } from 'react';
import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';
import { useProcedureForm } from './use-procedure-form';
import { ProcedureFormStatus } from './procedure-form-status';
import { fieldVisitFormTarget } from './field-form-context';
import type { FieldVisitFormTarget } from '../../lib/field-procedure-capture-store';

export type CustomerAcknowledgementInput = {
  interventionId: string;
  sectionId: string;
  receiverName: string;
  note: string;
};

function formatArubaTimestamp(value: string) {
  return new Date(value).toLocaleString('es-AW', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Aruba',
  });
}

export function CustomerAcknowledgementControls({
  job,
  mutationBusy,
  savingKey,
  error,
  onRecord,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  savingKey: string | null;
  error: string | null;
  onRecord: (input: CustomerAcknowledgementInput) => Promise<boolean>;
}) {
  const target=fieldVisitFormTarget(job);
  const optionsByIntervention = useMemo(() => new Map(
    job.reportCustomerAcknowledgementOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportCustomerAcknowledgementOptions]);

  const sections = job.interventionReports.flatMap((report) => {
    const allowed = optionsByIntervention.get(report.interventionId) ?? new Set<string>();
    const acknowledgementBySectionId = new Map(report.customerAcknowledgements.map((item) => [item.sectionId, item]));
    return report.template.sections
      .filter((section) => section.type === 'customer_acknowledgement')
      .map((section) => ({
        interventionId: report.interventionId,
        sectionId: section.id,
        title: section.title,
        required: section.required,
        acknowledgement: acknowledgementBySectionId.get(section.id),
        allowed: allowed.has(section.id),
      }));
  });

  return sections.length > 0 ? (
        <div className={styles.interventionGroup}>
          <div className={styles.plannedTitle}>CONFIRMACIÓN DEL CLIENTE</div>
          <p className={styles.helper}>El reconocimiento queda como evidencia inmutable del reporte. Una corrección posterior requiere revisión de oficina.</p>
          {sections.map(section=><AckSection key={JSON.stringify([target,section.interventionId,section.sectionId])} section={section} target={target} mutationBusy={mutationBusy} savingKey={savingKey} onRecord={onRecord}/>)}
          {error ? <div className={styles.mutationError}>{error}</div> : null}
        </div>
      ) : null;
}

type AcknowledgementSection = {interventionId:string;sectionId:string;title:string;required:boolean;allowed:boolean;
  acknowledgement:FieldExecutionJobDetail['interventionReports'][number]['customerAcknowledgements'][number]|undefined};
function AckSection({section,target,mutationBusy:mutating,savingKey,onRecord}:{section:AcknowledgementSection;target:FieldVisitFormTarget|null;mutationBusy:boolean;savingKey:string|null;onRecord:(input:CustomerAcknowledgementInput)=>Promise<boolean>}){
  const key=section.interventionId+':'+section.sectionId;
  const draft=useProcedureForm(target,'ack:'+key,{receiverName:'',note:''});
  const {receiverName,note}=draft.value;
  const [localError,setLocalError]=useState('');
  const mutationBusy=mutating||!draft.ready;
            if (section.acknowledgement) {
              return (
                <div className={styles.interventionForm} key={key}>
                  <strong>{section.title}</strong>
                  <div className={styles.infoGrid} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.info}><span>Recibido por</span><strong>{section.acknowledgement.receiverName}</strong></div>
                    <div className={styles.info}><span>Método</span><strong>Verbal</strong></div>
                    <div className={styles.info}><span>Registrado</span><strong>{formatArubaTimestamp(section.acknowledgement.acknowledgedAt)}</strong></div>
                    {section.acknowledgement.note ? <div className={styles.info}><span>Nota</span><strong>{section.acknowledgement.note}</strong></div> : null}
                  </div>
                  <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>Confirmación registrada · evidencia inmutable.</p>
                </div>
              );
            }
            const submit = async () => {
              if(!await draft.flush())return;
              const normalizedReceiver = receiverName.trim();
              if (!normalizedReceiver) {
                setLocalError('Escribe el nombre de la persona que recibió y revisó el reporte.');
                return;
              }
              setLocalError('');
              const success = await onRecord({
                interventionId: section.interventionId,
                sectionId: section.sectionId,
                receiverName: normalizedReceiver,
                note: note.trim(),
              });
              if (success) {
                draft.clear();
              }
            };
            return (
              <div className={styles.interventionForm} key={key}>
                <strong>{section.title}</strong>
                <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
                  {section.required ? 'Requerida' : 'Opcional'} · pendiente de reconocimiento
                </div>
                {section.allowed ? (
                  <>
                    <ProcedureFormStatus draft={draft}/>
                    <label>
                      <span>Nombre del cliente / receptor</span>
                      <input
                        className={styles.select}
                        disabled={mutationBusy}
                        value={receiverName}
                        onChange={(event) => draft.field('receiverName',event.target.value)}
                        maxLength={180} placeholder="Ej. Maria Customer"
                      />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      <span>Nota (opcional)</span>
                      <textarea
                        className={styles.select}
                        disabled={mutationBusy}
                        value={note}
                        onChange={(event) => draft.field('note',event.target.value)}
                        maxLength={1500} placeholder="Ej. Reporte explicado y revisado en sitio."
                        rows={2}
                      />
                    </label>
                    <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy||draft.saving||Boolean(draft.error)} type="button" onClick={() => void submit()}>
                      {savingKey === key ? 'Registrando…' : 'Registrar confirmación verbal'}
                    </button>
                  </>
                ) : (
                  <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
                    Field Authority no autoriza registrar esta confirmación en el estado actual.
                  </p>
                )}
                {localError ? <div className={styles.mutationError} style={{ gridColumn: '1 / -1' }}>{localError}</div> : null}
              </div>
            );

}
