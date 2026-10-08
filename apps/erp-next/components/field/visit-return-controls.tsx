'use client';

import {useProcedureForm} from './use-procedure-form';
import {ProcedureFormStatus} from './procedure-form-status';
import {fieldVisitFormTarget} from './field-form-context';
import type {FieldExecutionJobDetail} from '../../lib/field-authority';

import styles from './technician-field-home.module.css';

export type VisitReturnInput = {
  target: 'requires_return_visit';
  secondVisitReason: string;
};

function VisitReturnContent({job, disabled, saving, onSubmit }: {
  job:FieldExecutionJobDetail;
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitReturnInput) => void;
}) {
  const draft=useProcedureForm(fieldVisitFormTarget(job),'visit:return',{secondVisitReason:''});
  const secondVisitReason=draft.value.secondVisitReason,setSecondVisitReason=(text:string)=>draft.field('secondVisitReason',text);
  const reason = secondVisitReason.trim();

  return (
    <div className={styles.interventionForm}>
      <ProcedureFormStatus draft={draft}/>
      <strong>Requiere una visita de retorno</strong>
      <p className={styles.helper}>Explica por qué el trabajo necesita otra visita física. Este paso no crea todavía la segunda visita.</p>
      <label>
        <span>Motivo del retorno</span>
        <textarea
          className={styles.select}
          disabled={disabled||!draft.ready}
          maxLength={1000}
          onChange={(event) => setSecondVisitReason(event.target.value)}
          placeholder="Ej. Se necesita instalar el repuesto solicitado"
          rows={3}
          value={secondVisitReason}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled||!draft.ready||draft.saving||Boolean(draft.error)||!reason}
        onClick={async()=>{if(await draft.flush())onSubmit({ target: 'requires_return_visit', secondVisitReason: reason });}}
        type="button"
      >
        {saving ? 'Guardando…' : 'Marcar retorno requerido'}
      </button>
    </div>
  );
}

export function VisitReturnControls(props:Parameters<typeof VisitReturnContent>[0]){return <VisitReturnContent key={JSON.stringify(fieldVisitFormTarget(props.job))} {...props}/>;}
