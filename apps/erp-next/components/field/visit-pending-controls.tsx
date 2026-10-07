'use client';

import {useProcedureForm} from './use-procedure-form';
import {ProcedureFormStatus} from './procedure-form-status';
import {fieldVisitFormTarget} from './field-form-context';
import type {FieldExecutionJobDetail} from '../../lib/field-authority';

import styles from './technician-field-home.module.css';

export type VisitPendingInput = {
  target: 'pending';
  pendingReason: string;
  pendingAction: string;
};

function VisitPendingContent({job,
  disabled,
  saving,
  onSubmit,
}: {
  job:FieldExecutionJobDetail;
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitPendingInput) => void;
}) {
  const draft=useProcedureForm(fieldVisitFormTarget(job),'visit:pending',{pendingReason:'',pendingAction:''});
  const pendingReason=draft.value.pendingReason,setPendingReason=(text:string)=>draft.field('pendingReason',text);
  const pendingAction=draft.value.pendingAction,setPendingAction=(text:string)=>draft.field('pendingAction',text);
  const reason = pendingReason.trim();

  return (
    <div className={styles.interventionForm}>
      <ProcedureFormStatus draft={draft}/>
      <strong>Dejar la visita pendiente</strong>
      <p className={styles.helper}>Conserva el motivo operativo y la próxima acción sin cerrar el trabajo ni borrar lo ya realizado.</p>
      <label>
        <span>Motivo pendiente</span>
        <textarea
          className={styles.select}
          disabled={disabled||!draft.ready}
          maxLength={1000}
          onChange={(event) => setPendingReason(event.target.value)}
          placeholder="Ej. Hace falta una tarjeta electrónica compatible"
          rows={3}
          value={pendingReason}
        />
      </label>
      <label>
        <span>Próxima acción (opcional)</span>
        <textarea
          className={styles.select}
          disabled={disabled||!draft.ready}
          maxLength={1500}
          onChange={(event) => setPendingAction(event.target.value)}
          placeholder="Ej. Oficina confirma disponibilidad y coordina la continuación"
          rows={2}
          value={pendingAction}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled||!draft.ready||draft.saving||Boolean(draft.error)||!reason}
        onClick={async()=>{if(await draft.flush())onSubmit({ target: 'pending', pendingReason: reason, pendingAction: pendingAction.trim() });}}
        type="button"
      >
        {saving ? 'Guardando…' : 'Dejar pendiente'}
      </button>
    </div>
  );
}

export function VisitPendingControls(props:Parameters<typeof VisitPendingContent>[0]){return <VisitPendingContent key={JSON.stringify(fieldVisitFormTarget(props.job))} {...props}/>;}
