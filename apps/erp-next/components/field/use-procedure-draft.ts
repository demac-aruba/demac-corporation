'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldProcedurePart, FieldProcedureTarget } from '../../lib/field-procedure-contract';
import { readProcedureDraft, saveProcedureDraft } from '../../lib/field-procedure-capture-store';
import { parseProcedureStepDraft, procedureDraftFromStep, procedureStepFingerprint, type ProcedureStepDraft } from '../../lib/field-procedure-ui-model';
import { registerProcedureExitGuard } from '../../lib/field-procedure-navigation';
import type { ProcedureStep } from '../../lib/field-procedure-workspace';

export function useProcedureDraft(target: FieldProcedureTarget, part: FieldProcedurePart, step: ProcedureStep, partVersion: number, safetyRevision: number) {
  const initial = useRef({target,part,step,partVersion,safetyRevision}).current;
  const [value,setValue] = useState(()=>procedureDraftFromStep(step));
  const [ready,setReady] = useState(false),[saving,setSaving] = useState(false),[error,setError] = useState('');
  const valueRef=useRef(value),revision=useRef<number | null>(null),tail=useRef<Promise<void>>(Promise.resolve());
  const alive=useRef(true),failed=useRef(''),writes=useRef(0),dirty=useRef(false),loaded=useRef(false);
  const context=useRef({partVersion,safetyRevision});context.current={partVersion,safetyRevision};
  useEffect(()=>{
    alive.current=true;let cancelled=false;
    void readProcedureDraft(initial.target,initial.part,initial.step.id).then(row=>{
      if(cancelled)return;
      const restored=row ? {...parseProcedureStepDraft(row.value),competenceConfirmed:false} : procedureDraftFromStep(initial.step);
      revision.current=row?.revision ?? null;valueRef.current=restored;setValue(restored);loaded.current=true;setReady(true);
    }).catch(e=>{if(!cancelled){failed.current=e instanceof Error?e.message:'No se pudo leer el borrador original.';setError(failed.current);}});
    const unloading=(event:BeforeUnloadEvent)=>{if(writes.current>0 || failed.current && dirty.current){event.preventDefault();event.returnValue='';}};
    const unguard=registerProcedureExitGuard(()=>writes.current>0 || Boolean(failed.current && dirty.current));
    window.addEventListener('beforeunload',unloading);
    return()=>{cancelled=true;alive.current=false;unguard();window.removeEventListener('beforeunload',unloading);};
  },[initial]);
  function change(next: ProcedureStepDraft) {
    if(!loaded.current)return;
    valueRef.current=next;setValue(next);dirty.current=true;writes.current+=1;setSaving(true);
    const frozen=JSON.stringify(next),base={...context.current};
    tail.current=tail.current.then(async()=>{
      if(failed.current)throw new Error(failed.current);
      const stored=await saveProcedureDraft(initial.target,{part:initial.part,stepId:initial.step.id,
        basePartVersion:base.partVersion,baseSafetyRevision:base.safetyRevision,value:frozen},revision.current);
      revision.current=stored.revision;
    }).catch(e=>{failed.current=e instanceof Error?e.message:'El borrador aún no está protegido.';if(alive.current)setError(failed.current);})
      .finally(()=>{writes.current-=1;if(alive.current)setSaving(writes.current>0);});
  }
  function field<K extends keyof ProcedureStepDraft>(key: K, next: ProcedureStepDraft[K]) {change({...valueRef.current,[key]:next});}
  async function flush() {await tail.current;return loaded.current && !failed.current;}
  function acknowledge(serverStep: ProcedureStep) {change({...valueRef.current,baseline:procedureStepFingerprint(serverStep),competenceConfirmed:false});}
  function reviewServer(serverStep: ProcedureStep, keepLocal: boolean) {
    if(failed.current)return;
    change(keepLocal ? {...valueRef.current,baseline:procedureStepFingerprint(serverStep),competenceConfirmed:false} : procedureDraftFromStep(serverStep));
  }
  async function retryLocalSave() {
    // A quota/transient failure can be retried. A concurrent-tab conflict is not rebased silently.
    const original=failed.current; failed.current='';setError('');
    try {
      const current=await readProcedureDraft(initial.target,initial.part,initial.step.id);
      if(!loaded.current){const restored=current ? {...parseProcedureStepDraft(current.value),competenceConfirmed:false} : procedureDraftFromStep(initial.step);revision.current=current?.revision ?? null;valueRef.current=restored;setValue(restored);loaded.current=true;setReady(true);return;}
      if((current?.revision ?? null)!==revision.current)throw new Error('El borrador cambió en otra pestaña. Conserva tu texto y vuelve a abrir el procedimiento para comparar.');
      change({...valueRef.current});await tail.current;
    } catch(e) {failed.current=e instanceof Error?e.message:original;setError(failed.current);}
  }
  return {value,ready,saving,error,field,change,flush,acknowledge,reviewServer,retryLocalSave,
    conflict:ready && value.baseline!==procedureStepFingerprint(step),
    safeToLeave:()=>writes.current===0 && !(failed.current && dirty.current),
  };
}
