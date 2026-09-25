'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFieldProcedureWorkspace, isFieldProcedureTemporaryFailure, recordFieldProcedureAction } from '../../lib/field-authority';
import type { FieldProcedureTarget } from '../../lib/field-procedure-contract';
import {
  acknowledgeProcedureOperation, authorizeProcedureCaptureRecovery, beginProcedureOperation, discardUnsentProcedureCapture, listProcedureCaptures,
  procedureStoragePersisted, readProcedureOperation, shelveProcedureOperation, storeProcedureCapture,
  type ProcedureCaptureSummary, type ProcedureOperation,
} from '../../lib/field-procedure-capture-store';
import { synchronizeProcedureCapture } from '../../lib/field-procedure-capture-sync';
import type { FieldProcedureCommand, FieldProcedureWorkspace } from '../../lib/field-procedure-workspace';
import { onFirebaseSessionInvalidated } from '../../lib/firebase/session';

const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo confirmar la operación.';
export function useProcedureSession(input: FieldProcedureTarget) {
  const target = useRef(input).current;
  const [workspace,setWorkspace] = useState<FieldProcedureWorkspace | null>(null);
  const [captures,setCaptures] = useState<ProcedureCaptureSummary[]>([]),[operation,setOperation] = useState<ProcedureOperation | null>(null);
  const [fresh,setFresh] = useState(false),[loading,setLoading] = useState(true),[busy,setBusy] = useState(false);
  const [localReady,setLocalReady] = useState(false),[persisted,setPersisted] = useState(false);
  const [error,setError] = useState(''),[notice,setNotice] = useState('');
  const alive = useRef(true),epoch = useRef(0),lock = useRef(false),localEpoch = useRef(0);
  const state = useRef({workspace,fresh,localReady,operation}); state.current = {workspace,fresh,localReady,operation};
  const refreshLocal = useCallback(async () => {
    const version = ++localEpoch.current, rows = await listProcedureCaptures(target);
    if (alive.current && version===localEpoch.current) setCaptures(rows);
    return rows;
  },[target]);
  const refresh = useCallback(async () => {
    if (lock.current || !alive.current) return;
    const version = ++epoch.current; setLoading(true); setFresh(false);
    try {
      const next = await getFieldProcedureWorkspace(target);
      if (!alive.current || version!==epoch.current) return;
      setWorkspace(next); setError('');
      const [rows,pending] = await Promise.all([listProcedureCaptures(target),readProcedureOperation(target)]);
      if (!alive.current || version!==epoch.current) return;
      localEpoch.current+=1; setCaptures(rows); setOperation(pending); setLocalReady(true);
      setFresh(navigator.onLine && document.visibilityState==='visible');
    } catch (e) {
      if (!alive.current || version!==epoch.current) return;
      if (!isFieldProcedureTemporaryFailure(e) && !(e instanceof Error && ['ProcedureStorageError','ProcedureLocalConflict'].includes(e.name))) {
        setWorkspace(null); setCaptures([]); setOperation(null); setLocalReady(false);
      }
      setError(message(e));
    } finally { if (alive.current && version===epoch.current) setLoading(false); }
  },[target]);
  useEffect(() => {
    alive.current=true; void refresh(); void procedureStoragePersisted().then(value=>{if(alive.current)setPersisted(value);});
    const invalidate = () => { epoch.current+=1; setFresh(false); setLoading(false); };
    const visible = () => document.visibilityState==='visible' ? void refresh() : invalidate();
    const unsubscribe = onFirebaseSessionInvalidated(()=>{invalidate();localEpoch.current+=1;setWorkspace(null);setCaptures([]);setOperation(null);setLocalReady(false);});
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30_000);
    window.addEventListener('online',refresh); window.addEventListener('offline',invalidate); document.addEventListener('visibilitychange',visible);
    return ()=>{alive.current=false;epoch.current+=1;localEpoch.current+=1;window.clearInterval(timer);unsubscribe();window.removeEventListener('online',refresh);window.removeEventListener('offline',invalidate);document.removeEventListener('visibilitychange',visible);};
  },[refresh]);

  async function execute(command: FieldProcedureCommand, original?: ProcedureOperation): Promise<FieldProcedureWorkspace | null> {
    if (lock.current || !alive.current || !state.current.fresh || !state.current.localReady || (!original && state.current.operation)) return null;
    lock.current=true; const version=++epoch.current; setBusy(true);setFresh(false);setError('');setNotice('');
    try {
      const pending=original || await beginProcedureOperation(target,command);
      if (alive.current) setOperation(pending);
      const next=await recordFieldProcedureAction(target,pending.command,pending.requestId);
      await acknowledgeProcedureOperation(target,pending.requestId);
      if (!alive.current) return next;
      setWorkspace(next);setOperation(null);setFresh(version===epoch.current && navigator.onLine && document.visibilityState==='visible');
      setNotice('Cambio confirmado por el servidor.');
      return next;
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        // Keep exact persisted intent, even across a lost acknowledgement or reload.
        try { const pending=await readProcedureOperation(target); if(alive.current)setOperation(pending); } catch { if(alive.current)setLocalReady(false); }
        if (!isFieldProcedureTemporaryFailure(e) && [401,403].includes((e as {status?:number})?.status || 0)) {setWorkspace(null);setCaptures([]);}
      }
      return null;
    } finally { lock.current=false; if(alive.current){setBusy(false);setLoading(false);} }
  }
  async function sync(ids?: string[]) {
    if (lock.current || !alive.current || !state.current.fresh || state.current.operation) return;
    lock.current=true; const version=++epoch.current;setBusy(true);setFresh(false);setError('');setNotice('');
    try {
      const pending=(await listProcedureCaptures(target)).filter(c=>c.stage!=='confirmed' && (!ids || ids.includes(c.id)));
      for (const row of pending) {
        if (!alive.current || version!==epoch.current || !navigator.onLine) throw new Error('Sincronización interrumpida. Los originales pendientes permanecen guardados.');
        await synchronizeProcedureCapture(target,row.id); await refreshLocal();
      }
      const next=await getFieldProcedureWorkspace(target);
      if (alive.current) {setWorkspace(next);setFresh(version===epoch.current && navigator.onLine && document.visibilityState==='visible');setNotice('Archivos vinculados y verificados por el servidor.');}
    } catch(e) {
      if(alive.current){setError(message(e));try{await refreshLocal();}catch{setLocalReady(false);} if([401,403].includes((e as {status?:number})?.status || 0)){setWorkspace(null);setCaptures([]);}}
    } finally {lock.current=false;if(alive.current){setBusy(false);setLoading(false);}}
  }
  async function capture(input: Parameters<typeof storeProcedureCapture>[1]) {
    // The input retains the coordination revision at file selection/recording start, not upload time.
    const saved=await storeProcedureCapture(target,input);
    if (alive.current) {await refreshLocal();setNotice('Original guardado en este dispositivo; aún requiere vínculo del servidor.');}
    if (alive.current && !lock.current && state.current.fresh && !state.current.operation) void sync([saved.id]);
    return saved;
  }
  async function recoverCapture(id:string, reason:string) {
    if(lock.current || !alive.current || !state.current.fresh || state.current.operation)return;
    try{
      await authorizeProcedureCaptureRecovery(target,id,reason);
      await refreshLocal();
      await sync([id]);
    }catch(e){if(alive.current)setError(message(e));}
  }
  async function discardLocal(id: string) {
    try{await discardUnsentProcedureCapture(target,id);await refreshLocal();}catch(e){if(alive.current)setError(message(e));}
  }
  async function stopRetrying() {
    if(!state.current.fresh || lock.current || !state.current.operation)return;
    try{await shelveProcedureOperation(target,state.current.operation.requestId);if(alive.current){setOperation(null);setNotice('Solicitud conservada sin reenviar. Esto no deshace ningún cambio que ya hubiera recibido el servidor.');}}catch(e){if(alive.current)setError(message(e));}
  }
  function denyAccess(){epoch.current+=1;localEpoch.current+=1;setWorkspace(null);setCaptures([]);setOperation(null);setFresh(false);setLocalReady(false);setError('Acceso sin confirmar. Los originales permanecen en el dispositivo de su autor.');}
  return {target,workspace,captures,operation,fresh,loading,busy,localReady,persisted,error,notice,refresh,
    execute,sync,capture,denyAccess,discardLocal,recoverCapture,stopRetrying,refreshLocal,
    canCommand:fresh && localReady && !busy && !operation,
  };
}
export type ProcedureSession = ReturnType<typeof useProcedureSession>;
