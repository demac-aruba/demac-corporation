'use client';
import { useEffect, useRef, useState } from 'react';
import { readProcedureForm, saveProcedureForm } from '../../lib/field-procedure-capture-store';
import { registerProcedureExitGuard } from '../../lib/field-procedure-navigation';
import type { FieldProcedureTarget } from '../../lib/field-procedure-contract';

/** Small authored form drafts. Immutable command receipts are a separate journal. */
export function useProcedureForm<T extends Record<string,string>>(target:FieldProcedureTarget,scope:string,defaults:T) {
  const initial=useRef({target,scope,defaults}).current,alive=useRef(true),revision=useRef<number|null>(null),tail=useRef(Promise.resolve());
  const [value,setValue]=useState(defaults),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const current=useRef(value),failed=useRef(''),writes=useRef(0),dirty=useRef(false),loaded=useRef(false);
  function parse(raw:string):T {
    const next:unknown=JSON.parse(raw);
    if(!next || typeof next!=='object' || Array.isArray(next) || Object.keys(next).sort().join()!==Object.keys(initial.defaults).sort().join()
      || Object.values(next).some(v=>typeof v!=='string' || v.length>4000))throw new Error('El borrador original requiere revisión; no se reemplazó.');
    return next as T;
  }
  useEffect(()=>{
    alive.current=true;let cancelled=false;
    void readProcedureForm(initial.target,initial.scope).then(row=>{
      if(cancelled)return;const next=row?parse(row.value):initial.defaults;revision.current=row?.revision ?? null;current.current=next;setValue(next);loaded.current=true;setReady(true);
    }).catch(e=>{if(!cancelled){failed.current=e instanceof Error?e.message:'No se pudo recuperar el borrador.';setError(failed.current);}});
    const blocked=()=>writes.current>0 || Boolean(dirty.current && failed.current);
    const unguard=registerProcedureExitGuard(blocked),unload=(event:BeforeUnloadEvent)=>{if(blocked()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return()=>{cancelled=true;alive.current=false;unguard();window.removeEventListener('beforeunload',unload);};
  // Only initial identity/scope, not changing field values, define this hook's lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initial]);
  function change(next:T) {
    if(!loaded.current)return;current.current=next;setValue(next);dirty.current=true;writes.current+=1;setSaving(true);
    const frozen=JSON.stringify(next);
    tail.current=tail.current.then(async()=>{if(failed.current)throw new Error(failed.current);const row=await saveProcedureForm(initial.target,initial.scope,frozen,revision.current);revision.current=row.revision;})
      .catch(e=>{failed.current=e instanceof Error?e.message:'El borrador no está protegido todavía.';if(alive.current)setError(failed.current);})
      .finally(()=>{writes.current-=1;if(alive.current)setSaving(writes.current>0);});
  }
  function field<K extends keyof T>(key:K,next:T[K]){change({...current.current,[key]:next});}
  async function flush(){await tail.current;return loaded.current && !failed.current;}
  async function retry(){
    try{const row=await readProcedureForm(initial.target,initial.scope);if(!loaded.current){const next=row?parse(row.value):initial.defaults;revision.current=row?.revision ?? null;current.current=next;setValue(next);loaded.current=true;setReady(true);failed.current='';setError('');return;}
      if((row?.revision ?? null)!==revision.current)throw new Error('El borrador cambió en otra pestaña. Conserva tu texto y compara al volver a abrir el formulario.');
      failed.current='';setError('');change({...current.current});await tail.current;
    }catch(e){failed.current=e instanceof Error?e.message:'No se pudo recuperar.';setError(failed.current);}
  }
  return {value,ready,saving,error,field,change,flush,retry,clear:()=>change({...initial.defaults})};
}
