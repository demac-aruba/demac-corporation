'use client';

import type { FieldProcedureTarget } from '../../lib/field-procedure-contract';
import { useProcedureForm } from './use-procedure-form';
import { ProcedureFormStatus } from './procedure-form-status';

export function ProcedureReasonForm({target,scope,label,action,disabled,onConfirm}:{
  target:FieldProcedureTarget;scope:string;label:string;action:string;disabled:boolean;onConfirm:(reason:string)=>Promise<unknown>;
}) {
  const draft=useProcedureForm(target,scope,{reason:''});
  return <>
    <ProcedureFormStatus draft={draft}/>
    <label>{label}<textarea rows={2} maxLength={1500} disabled={!draft.ready||disabled} value={draft.value.reason} onChange={event=>draft.field('reason',event.target.value)}/></label>
    <button type="button" disabled={disabled||!draft.ready||draft.saving||Boolean(draft.error)||draft.value.reason.trim().length<3}
      onClick={async()=>{if(await draft.flush())await onConfirm(draft.value.reason.trim());}}>{action}</button>
  </>;
}
