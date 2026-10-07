'use client';

import {useProcedureForm} from './use-procedure-form';
import {ProcedureFormStatus} from './procedure-form-status';
import {fieldVisitFormTarget} from './field-form-context';
import type {FieldExecutionJobDetail} from '../../lib/field-authority';

import styles from './technician-field-home.module.css';

export type VisitNoAccessInput = {
  target: 'no_access';
  noAccessReason: string;
};

function VisitNoAccessContent({job,
  disabled,
  saving,
  onSubmit,
}: {
  job:FieldExecutionJobDetail;
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: VisitNoAccessInput) => void;
}) {
  const draft=useProcedureForm(fieldVisitFormTarget(job),'visit:no-access',{noAccessReason:''});
  const noAccessReason=draft.value.noAccessReason,setNoAccessReason=(text:string)=>draft.field('noAccessReason',text);
  const reason = noAccessReason.trim();

  return (
    <div className={styles.interventionForm}>
      <ProcedureFormStatus draft={draft}/>
      <strong>Cerrar por falta de acceso</strong>
      <p className={styles.helper}>Registra por qué no fue posible acceder al lugar. Esta acción cierra la visita física.</p>
      <label>
        <span>Motivo de falta de acceso</span>
        <textarea
          className={styles.select}
          disabled={disabled||!draft.ready}
          maxLength={1000}
          onChange={(event) => setNoAccessReason(event.target.value)}
          placeholder="Ej. Propiedad cerrada y cliente no respondió"
          rows={3}
          value={noAccessReason}
        />
      </label>
      <button
        className={`${styles.action} ${styles.primary}`}
        disabled={disabled||!draft.ready||draft.saving||Boolean(draft.error)||!reason}
        onClick={async()=>{if(await draft.flush())onSubmit({ target: 'no_access', noAccessReason: reason });}}
        type="button"
      >
        {saving ? 'Guardando…' : 'Confirmar sin acceso'}
      </button>
    </div>
  );
}

export function VisitNoAccessControls(props:Parameters<typeof VisitNoAccessContent>[0]){return <VisitNoAccessContent key={JSON.stringify(fieldVisitFormTarget(props.job))} {...props}/>;}
