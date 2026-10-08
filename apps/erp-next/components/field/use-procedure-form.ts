'use client';
import { useEffect, useRef, useState } from 'react';
import { readProcedureForm, saveProcedureForm, type FieldFormTarget } from '../../lib/field-procedure-capture-store';
import { registerProcedureExitGuard } from '../../lib/field-procedure-navigation';
import { onFirebaseSessionInvalidated } from '../../lib/firebase/session';

/** Small authored form drafts. Immutable command receipts are a separate journal. */
export function useProcedureForm<T extends Record<string,string>>(target:FieldFormTarget|null,scope:string,defaults:T,recover?:()=>Promise<T|null>) {
  const initial=useRef({target,scope,defaults,recover}).current,alive=useRef(true),revision=useRef<number|null>(null),tail=useRef(Promise.resolve());
  const [value,setValue]=useState(defaults),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [conflict,setConflict]=useState<{value:T;revision:number|null}|null>(null);
  const current=useRef(value),failed=useRef(''),writes=useRef(0),dirty=useRef(false),loaded=useRef(false);
  function parse(raw:string):T {
    const next:unknown=JSON.parse(raw);
    if(!next || typeof next!=='object' || Array.isArray(next) || Object.keys(next).sort().join()!==Object.keys(initial.defaults).sort().join()
      || Object.values(next).some(v=>typeof v!=='string' || v.length>5000))throw new Error('El borrador original requiere revisión; no se reemplazó.');
    return next as T;
  }
  async function restore(){
    if(!initial.target)throw new Error('No hay una sesión válida para proteger este formulario.');
    let row=await readProcedureForm(initial.target,initial.scope);
    if(!row&&initial.recover){
      const recovered=await initial.recover();
      if(recovered)row=await saveProcedureForm(initial.target,initial.scope,JSON.stringify(parse(JSON.stringify(recovered))),null);
    }
    return row;
  }
  useEffect(()=>{
    alive.current=true;let cancelled=false;
    if(!initial.target)return;
    void restore().then(row=>{
      if(cancelled)return;const next=row?parse(row.value):initial.defaults;revision.current=row?.revision ?? null;current.current=next;setValue(next);loaded.current=true;setReady(true);
    }).catch(e=>{if(!cancelled){failed.current=e instanceof Error?e.message:'No se pudo recuperar el borrador.';setError(failed.current);}});
    const blocked=()=>writes.current>0 || Boolean(dirty.current && failed.current);
    const unguard=registerProcedureExitGuard(blocked),unload=(event:BeforeUnloadEvent)=>{if(blocked()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    const unsubscribe=onFirebaseSessionInvalidated(()=>{
      cancelled=true;loaded.current=false;setReady(false);setValue(initial.defaults);current.current=initial.defaults;
      setConflict(null);failed.current='La sesión cambió. El borrador protegido permanece en la cuenta de su autor.';setError(failed.current);
    });
    return()=>{cancelled=true;alive.current=false;unsubscribe();unguard();window.removeEventListener('beforeunload',unload);};
  // Only initial identity/scope, not changing field values, define this hook's lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initial]);
  function change(next:T) {
    if(!loaded.current||!initial.target)return;current.current=next;setValue(next);dirty.current=true;writes.current+=1;setSaving(true);
    const frozen=JSON.stringify(next);
    const owner=initial.target;
    tail.current=tail.current.then(async()=>{if(failed.current)throw new Error(failed.current);
      if(Object.values(next).some(text=>typeof text!=='string'||text.length>5000))throw new Error('Cada campo admite hasta 5000 caracteres. Acorta el texto y reintenta guardarlo antes de salir.');
      const row=await saveProcedureForm(owner,initial.scope,frozen,revision.current);revision.current=row.revision;})
      .catch(e=>{failed.current=e instanceof Error?e.message:'El borrador no está protegido todavía.';if(alive.current)setError(failed.current);})
      .finally(()=>{writes.current-=1;if(alive.current)setSaving(writes.current>0);});
  }
  function field<K extends keyof T>(key:K,next:T[K]){change({...current.current,[key]:next});}
  async function flush(){await tail.current;return loaded.current && !failed.current;}
  async function retry(){
    if(!initial.target)return;
    try{const row=loaded.current?await readProcedureForm(initial.target,initial.scope):await restore();if(!loaded.current){const next=row?parse(row.value):initial.defaults;revision.current=row?.revision ?? null;current.current=next;setValue(next);loaded.current=true;setReady(true);failed.current='';setError('');return;}
      if((row?.revision ?? null)!==revision.current){setConflict({value:row?parse(row.value):initial.defaults,revision:row?.revision ?? null});throw new Error('El borrador cambió en otra pestaña. Compara los textos y elige cuál conservar.');}
      failed.current='';setError('');change({...current.current});await tail.current;
    }catch(e){failed.current=e instanceof Error?e.message:'No se pudo recuperar.';setError(failed.current);}
  }
  async function resolveConflict(keepLocal:boolean){
    if(!conflict||writes.current)return;
    const next=keepLocal?{...current.current}:conflict.value;
    revision.current=conflict.revision;failed.current='';setError('');setConflict(null);change(next);await tail.current;
  }
  return {value,ready,saving,error,conflict,resolveConflict,field,change,flush,retry,clear:()=>change({...initial.defaults})};
}
