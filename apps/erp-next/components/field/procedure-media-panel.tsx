'use client';

import { useRef, useState } from 'react';
import type { FieldProcedurePart } from '../../lib/field-procedure-contract';
import { procedureLabel } from '../../lib/field-procedure-ui-model';
import type { ProcedureMediaKind, ProcedureMediaSource, ProcedureStep } from '../../lib/field-procedure-workspace';
import type { ProcedureSession } from './use-procedure-session';
import styles from './field-procedure-workspace.module.css';

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
  if(kind==='audio') return 'recorder';
  return camera ? 'camera' : 'attachment';
}

export function ProcedureMediaPanel({session,part,step,canCapture}:{
  session:ProcedureSession; part:FieldProcedurePart; step:ProcedureStep; canCapture:boolean;
}) {
  const [error,setError]=useState('');
  const [capturing,setCapturing]=useState('');
  const pickedAt=useRef<Record<string,{revision:number;at:string}>>({});
  const evidence=session.workspace?.evidence.filter(e=>e.part===part && e.procedureId===step.id) ?? [];
  const local=session.captures.filter(c=>c.part===part && c.stepId===step.id && c.stage!=='confirmed');
  const safetyRevision=session.workspace?.safety?.revision ?? null;

  async function receive(view:string,kind:ProcedureMediaKind,camera:boolean,file:File|null) {
    if(!file || safetyRevision===null)return;
    const key=view+':'+kind+':'+(camera?'camera':'file');
    const selected=pickedAt.current[key] || {revision:safetyRevision,at:new Date().toISOString()};
    delete pickedAt.current[key];
    setCapturing(key); setError('');
    try {
      await session.capture({
        part,stepId:step.id,view,kind,source:sourceFor(kind,camera),blob:file,
        safetyRevision:selected.revision,declaredCapturedAt:selected.at,
        limitBytes:session.workspace!.mediaLimits[kind].bytes,
      });
    } catch(e) {
      setError(e instanceof Error?e.message:'No se pudo proteger el archivo original.');
    } finally {
      setCapturing('');
    }
  }
  function mark(key:string) {
    if(safetyRevision!==null)pickedAt.current[key]={revision:safetyRevision,at:new Date().toISOString()};
  }

  return <section className={styles.card} aria-label="Evidencia del procedimiento">
    <div className={styles.toolbar}>
      <div><h3>Evidencia por procedimiento</h3><small>Las fotos requeridas cuentan solo cuando el servidor confirma su vínculo. Audio y video son opcionales.</small></div>
      {local.length?<button type="button" disabled={!session.fresh||session.busy||Boolean(session.operation)} onClick={()=>void session.sync(local.map(x=>x.id))}>Reintentar archivos pendientes</button>:null}
    </div>
    {!session.persisted?<div className={styles.warning}>Este navegador no confirmó almacenamiento persistente. Mantén la app abierta hasta que los originales pendientes queden vinculados.</div>:null}
    {error?<div className={styles.error} role="alert">{error}</div>:null}
    <div className={styles.media}>
      {step.views.map(view=>{
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
                disabled={!canCapture||Boolean(capturing)} onClick={()=>mark(cameraKey)}
                onChange={e=>{const file=e.currentTarget.files?.[0]||null;void receive(view,'photo',true,file);e.currentTarget.value='';}}/>
            </label>
            <label data-disabled={!canCapture}>
              <span>{capturing===galleryKey?'Guardando…':'Galería'}</span>
              <input aria-label={'Seleccionar '+procedureLabel('photo:'+view)} type="file" accept={accept('photo')}
                disabled={!canCapture||Boolean(capturing)} onClick={()=>mark(galleryKey)}
                onChange={e=>{const file=e.currentTarget.files?.[0]||null;void receive(view,'photo',false,file);e.currentTarget.value='';}}/>
            </label>
          </div>
          {pending.map(c=><div className={styles.receipt} key={c.id}>
            <strong>{stageLabel[c.stage]}</strong>
            <dl><dt>Tipo</dt><dd>{c.contentType}</dd><dt>Tamaño</dt><dd>{Math.round(c.sizeBytes/1024)} KB</dd><dt>Huella</dt><dd>{c.sha256.slice(0,14)}…</dd></dl>
            {c.stage==='local' && !c.prepare?<button type="button" className={styles.quiet} disabled={session.busy} onClick={()=>void session.discardLocal(c.id)}>Descartar solo este original no enviado</button>:null}
          </div>)}
          {remote.map(e=><div className={styles.receipt} key={e.id}>
            <strong>Vínculo confirmado</strong>
            <dl><dt>Autor</dt><dd>{e.createdBy}</dd><dt>Recibido</dt><dd>{new Date(e.receivedAt).toLocaleString()}</dd><dt>Huella</dt><dd>{e.sha256.slice(0,14)}…</dd></dl>
          </div>)}
        </div>;
      })}
      <details className={styles.optional}><summary>Audio o video opcional</summary>
        <div className={styles.mediaCard}>
          <p>Úsalos como contexto adicional. No bloquean el procedimiento y nunca sustituyen una foto requerida.</p>
          {(['audio','video'] as ProcedureMediaKind[]).map(kind=>{
            const view='supplemental';
            const key=view+':'+kind+':file';
            return <label key={kind} data-disabled={!canCapture}>
              {capturing===key?'Guardando…':'Agregar '+(kind==='audio'?'audio':'video')}
              <input type="file" accept={accept(kind)} disabled={!canCapture||Boolean(capturing)} onClick={()=>mark(key)}
                onChange={e=>{const file=e.currentTarget.files?.[0]||null;void receive(view,kind,false,file);e.currentTarget.value='';}}/>
            </label>;
          })}
        </div>
      </details>
    </div>
  </section>;
}