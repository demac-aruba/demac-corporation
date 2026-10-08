'use client';

import {useProcedureForm} from './use-procedure-form';
import {ProcedureFormStatus} from './procedure-form-status';
import {fieldVisitFormTarget} from './field-form-context';
import type {FieldExecutionJobDetail} from '../../lib/field-authority';

import styles from './technician-field-home.module.css';

export type VisitCancellationInput = {
  target: 'cancelled';
  cancellationReason: string;
};

function VisitCancellationContent({job,
  disabled,
  saving,
  onSubmit,
}: {
  job:FieldExecutionJobDetail;
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitCancellationInput) => void;
}) {
  const draft=useProcedureForm(fieldVisitFormTarget(job),'visit:cancellation',{cancellationReason:''});
  const cancellationReason=draft.value.cancellationReason,setCancellationReason=(text:string)=>draft.field('cancellationReason',text);
  const reason = cancellationReason.trim();

  return (
    <div className={styles.interventionForm}>
      <ProcedureFormStatus draft={draft}/>
      <strong>Cancelar esta visita</strong>
      <p className={styles.helper}>Registra por qué debe terminar esta visita física. La programación y el Work Order no se cancelan desde aquí.</p>
      <label>
        <span>Motivo de cancelación</span>
        <textarea
          className={styles.select}
          disabled={disabled||!draft.ready}
          maxLength={1000}
          onChange={(event) => setCancellationReason(event.target.value)}
          placeholder="Ej. El cliente solicitó detener esta visita"
          rows={3}
          value={cancellationReason}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled||!draft.ready||draft.saving||Boolean(draft.error)||!reason}
        onClick={async()=>{if(await draft.flush())onSubmit({ target: 'cancelled', cancellationReason: reason });}}
        type="button"
      >
        {saving ? 'Guardando…' : 'Confirmar cancelación'}
      </button>
    </div>
  );
}

export function VisitCancellationControls(props:Parameters<typeof VisitCancellationContent>[0]){return <VisitCancellationContent key={JSON.stringify(fieldVisitFormTarget(props.job))} {...props}/>;}
