'use client';
import type {ReactNode} from 'react';
import type {FieldFormTarget} from '../../lib/field-procedure-capture-store';
import {useProcedureForm} from './use-procedure-form';
import {ProcedureFormStatus} from './procedure-form-status';

/** Key this component by owner, context and scope. A draft never submits a command. */
export function FieldAuthoredForm<T extends Record<string,string>>({target,scope,defaults,children}:{
  target:FieldFormTarget|null;scope:string;defaults:T;
  children:(draft:ReturnType<typeof useProcedureForm<T>>)=>ReactNode;
}) {
  const draft=useProcedureForm(target,scope,defaults);
  return <><ProcedureFormStatus draft={draft}/>{children(draft)}</>;
}
