'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldProcedurePart } from '../../lib/field-procedure-contract';
import { procedureLabel } from '../../lib/field-procedure-ui-model';
import type { ProcedureMediaKind, ProcedureMediaSource, ProcedureStep } from '../../lib/field-procedure-workspace';
import type { ProcedureSession } from './use-procedure-session';
import styles from './field-procedure-workspace.module.css';
import { ProcedureEvidenceViewer } from './procedure-evidence-viewer';
import { ProcedureAudioRecorder } from './procedure-audio-recorder';
import { ProcedureReasonForm } from './procedure-reason-form';
import { registerProcedureExitGuard } from '../../lib/field-procedure-navigation';

const stageLabel: Record<string,string> = {
  local:'Guardado solo en este dispositivo',
  reserved:'Reserva confirmada; falta subir',
  uploaded:'Subido; falta confirmar vínculo',
  confirmed:'Vinculado por el servidor',
};
function accept(kind: ProcedureMediaKind) {
  return kind==='photo' ? 'image/jpeg,image/png,image/webp'
    : kind==='audio' ? 'audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4'
      : 'video/mp4,video/webm';
}
function sourceFor(kind:ProcedureMediaKind,camera:boolean):ProcedureMediaSource {
  if(kind==='photo') return camera ? 'camera' : 'gallery';
  if(kind==='audio') return 'attachment';
  return camera ? 'camera' : 'attachment';
}

export function ProcedureMediaPanel({session,part,step,canCapture}:{
  session:ProcedureSession; part:FieldProcedurePart; step:ProcedureStep; canCapture:boolean;
}) {
  const [error,setError]=useState('');
  const [capturing,setCapturing]=useState('');
  const [unprotected,setUnprotected]=useState(false);
  const [recordingBusy,setRecordingBusy]=useState(false);
  const recorderBusyRef=useRef(false);
  const onRecorderBusy=(busy:boolean)=>{recorderBusyRef.current=busy;setRecordingBusy(busy);};
  const original=useRef<{input:Parameters<ProcedureSession['capture']>[0];key:string}|null>(null);

  const pickedAt=useRef<Record<string,{revision:number;at:string}>>({});
  const evidence=session.workspace?.evidence.filter(e=>e.part===part && e.procedureId===step.id) ?? [];
  const local=session.captures.filter(c=>c.part===part && c.stepId===step.id && c.stage!=='confirmed');
  const safetyRevision=session.workspace?.safety?.revision ?? null;
  const photoViews=step.measurement && !step.views.includes('instrument') ? [...step.views,'instrument'] : step.views;
  useEffect(()=>{
    const remove=registerProcedureExitGuard(()=>Boolean(original.current));
    const unloading=(event:BeforeUnloadEvent)=>{if(original.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unloading);
    return()=>{remove();window.removeEventListener('beforeunload',unloading);};
  },[]);

  async function protectOriginal(){
    const pending=original.current;
    if(!pending||capturing)return;
    setCapturing(pending.key);setError('');
    try{await session.capture(pending.input);original.current=null;setUnprotected(false);}
    catch(e){setError(e instanceof Error?e.message:'No se pudo proteger el archivo original.');}
    finally{setCapturing('');}
  }

  async function receive(view:string,kind:ProcedureMediaKind,camera:boolean,file:File|null) {
    if(!file || safetyRevision===null || original.current || recorderBusyRef.current)return;
    const key=view+':'+kind+':'+(camera?'camera':'file');
    const selected=pickedAt.current[key] || {revision:safetyRevision,at:new Date().toISOString()};
    delete pickedAt.current[key];
    original.current={key,input:{
        part,stepId:step.id,view,kind,source:sourceFor(kind,camera),blob:file,
        safetyRevision:selected.revision,declaredCapturedAt:selected.at,
        limitBytes:session.workspace!.mediaLimits[kind].bytes,
    }};
    setUnprotected(true);await protectOriginal();
  }
  function mark(key:string) {
    if(safetyRevision!==null)pickedAt.current[key]={revision:safetyRevision,at:new Date().toISOString()};
  }

  return <section className={styles.card} aria-label="Evidencia del procedimiento">
    <div className={styles.toolbar}>
      <div><h3>Evidencia por procedimiento</h3><small>Las fotos requeridas cuentan solo cuando el servidor confirma su vínculo. Audio y video son opcionales.</small></div>
      {local.length?<button type="button" disabled={!session.fresh||session.busy||recordingBusy||Boolean(session.operation)} onClick={()=>void session.sync(local.map(x=>x.id))}>Reintentar archivos pendientes</button>:null}
    </div>
    {!session.persisted?<div className={styles.warning}>Este navegador no confirmó almacenamiento persistente. Mantén la app abierta hasta que los originales pendientes queden vinculados.</div>:null}
    {error?<div className={styles.error} role="alert">{error}</div>:null}
    {unprotected&&!capturing?<div className={styles.warning}>
      <p>El original sigue abierto en esta pantalla y todavía no está protegido en el dispositivo. Reintenta antes de salir.</p>
      <button type="button" onClick={()=>void protectOriginal()}>Reintentar protección del original</button>
      <button type="button" onClick={()=>{original.current=null;setUnprotected(false);setError('');}}>Descartar este original sin guardar</button>
    </div>:null}
    <div className={styles.media}>
      {photoViews.map(view=>{
        const remote=evidence.filter(e=>e.view===view);
        const pending=local.filter(e=>e.view===view);
        const cameraKey=view+':photo:camera';
        const galleryKey=view+':photo:file';
        return <div className={styles.mediaCard} key={view}>
          <strong>{procedureLabel('photo:'+view)}</strong>
          <small>{remote.length ? String(remote.length)+' archivo(s) confirmado(s) por el servidor.' : 'Sin foto confirmada todavía.'}</small>
          <div className={styles.fileButtons}>
            <label data-disabled={!canCapture}>
              <span>{capturing===cameraKey?'Guardando…':'Tomar foto'}</span>
              <input aria-label={'Tomar '+procedureLabel('photo:'+view)} type="file" accept={accept('photo')} capture="environment"
                disabled={!canCapture||Boolean(capturing)||unprotected||recordingBusy} onClick={()=>mark(cameraKey)}
                onChange={e=>{const file=e.currentTarget.files?.[0]||null;void receive(view,'photo',true,file);e.currentTarget.value='';}}/>
            </label>
            <label data-disabled={!canCapture}>
              <span>{capturing===galleryKey?'Guardando…':'Galería'}</span>
              <input aria-label={'Seleccionar '+procedureLabel('photo:'+view)} type="file" accept={accept('photo')}
                disabled={!canCapture||Boolean(capturing)||unprotected||recordingBusy} onClick={()=>mark(galleryKey)}
                onChange={e=>{const file=e.currentTarget.files?.[0]||null;void receive(view,'photo',false,file);e.currentTarget.value='';}}/>
            </label>
          </div>
          {pending.map(c=><div className={styles.receipt} key={c.id}>
            <strong>{stageLabel[c.stage]}</strong>
            <dl><dt>Tipo</dt><dd>{c.contentType}</dd><dt>Tamaño</dt><dd>{Math.round(c.sizeBytes/1024)} KB</dd><dt>Huella</dt><dd>{c.sha256.slice(0,14)}…</dd></dl>
            {c.stage==='local' && !c.prepare?<button type="button" className={styles.quiet} disabled={session.busy||recordingBusy} onClick={()=>void session.discardLocal(c.id)}>Descartar solo este original no enviado</button>:null}
            {['reserved','uploaded'].includes(c.stage)?<details className={styles.coordination}>
              <summary>Recuperar vínculo si cambió la coordinación</summary>
              <div>
                <p>Úsalo solo cuando el archivo ya fue reservado/subido y el servidor indique que cambió la coordinación. Esto recupera documentación; no autoriza actividad física ni cambia el momento original de captura.</p>
                <ProcedureReasonForm target={session.target} scope={'recover:'+c.id} label="Motivo de recuperación"
                  action="Confirmar recuperación documental y reintentar" disabled={!session.fresh||session.busy||recordingBusy||Boolean(session.operation)}
                  onConfirm={reason=>session.recoverCapture(c.id,reason)}/>

              </div>
            </details>:null}
          </div>)}
          {remote.map(e=><div className={styles.receipt} key={e.id}>
            <strong>Vínculo confirmado</strong>
            <dl><dt>Autor</dt><dd>{e.createdBy}</dd><dt>Recibido</dt><dd>{new Date(e.receivedAt).toLocaleString()}</dd><dt>Huella</dt><dd>{e.sha256.slice(0,14)}…</dd></dl>
            <ProcedureEvidenceViewer target={session.target} evidence={e} onDenied={session.denyAccess}/>
          </div>)}
        </div>;
      })}
      <details className={styles.optional}><summary>Audio o video opcional</summary>
        <div className={styles.mediaCard}>
          <p>Úsalos como contexto adicional. No bloquean el procedimiento y nunca sustituyen una foto requerida.</p>
          {safetyRevision!==null && session.workspace ? <ProcedureAudioRecorder
            key={JSON.stringify([session.target.ownerUserId,session.target.visitId,session.target.interventionId,session.target.assetId,part,step.id])}
            target={session.target} part={part} stepId={step.id} safetyRevision={safetyRevision}
            limitBytes={session.workspace.mediaLimits.audio.bytes} canRecord={canCapture&&!unprotected&&!capturing}
            onCapture={session.capture} onBusy={onRecorderBusy}/> : null}
          {(['audio','video'] as ProcedureMediaKind[]).map(kind=>{
            const view='supplemental';
            const key=view+':'+kind+':file';
            return <label key={kind} data-disabled={!canCapture}>
              {capturing===key?'Guardando…':'Agregar '+(kind==='audio'?'audio':'video')}
              <input type="file" accept={accept(kind)} disabled={!canCapture||Boolean(capturing)||unprotected||recordingBusy} onClick={()=>mark(key)}
                onChange={e=>{const file=e.currentTarget.files?.[0]||null;void receive(view,kind,false,file);e.currentTarget.value='';}}/>
            </label>;
          })}
          {local.filter(c=>c.view==='supplemental').map(c=><div key={c.id} className={styles.receipt}>
            <strong>{stageLabel[c.stage]}</strong><small>{c.contentType} · {Math.round(c.sizeBytes/1024)} KB</small>
            {c.stage==='local'&&!c.prepare?<button type="button" disabled={session.busy||recordingBusy} onClick={()=>void session.discardLocal(c.id)}>Descartar solo este original no enviado</button>:null}
            {['reserved','uploaded'].includes(c.stage)?<details className={styles.coordination}>
              <summary>Recuperar vínculo si cambió la coordinación</summary>
              <ProcedureReasonForm target={session.target} scope={'recover:'+c.id} label="Motivo de recuperación"
                action="Confirmar recuperación documental y reintentar" disabled={!session.fresh||session.busy||recordingBusy||Boolean(session.operation)}
                onConfirm={reason=>session.recoverCapture(c.id,reason)}/>

            </details>:null}
          </div>)}
          {evidence.filter(e=>e.view==='supplemental').map(e=><div key={e.id} className={styles.receipt}>
            <strong>{e.kind==='audio'?'Audio':'Video'} · vínculo confirmado</strong>
            <small>Autor: {e.createdBy} · {new Date(e.receivedAt).toLocaleString()}</small>
            <ProcedureEvidenceViewer target={session.target} evidence={e} onDenied={session.denyAccess}/>
          </div>)}
        </div>
      </details>
    </div>
  </section>;
}
