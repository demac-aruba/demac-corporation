'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldProcedureTarget } from '../../lib/field-procedure-contract';
import type { ProcedureEvidence } from '../../lib/field-procedure-workspace';
import { readProcedureEvidence } from '../../lib/field-procedure-media-client';
import { onFirebaseSessionInvalidated } from '../../lib/firebase/session';
import styles from './procedure-evidence-viewer.module.css';

// Bytes are authorized and hash-checked before creating a device-local URL.
// Never persist that URL or substitute it for the canonical evidence identity.
type ViewerProps={
  target:FieldProcedureTarget; evidence:ProcedureEvidence; onDenied:()=>void;
};
export function ProcedureEvidenceViewer(props:ViewerProps) {
  return <EvidenceViewer key={JSON.stringify([props.target,props.evidence.id,props.evidence.sha256])} {...props}/>;
}
function EvidenceViewer({target,evidence,onDenied}:ViewerProps) {
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [expanded,setExpanded]=useState(false);
  const container=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDialogElement>(null);
  const currentUrl=useRef(''),epoch=useRef(0),alive=useRef(false);
  const denied=useRef(onDenied);denied.current=onDenied;
  function release(){
    if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);
    currentUrl.current='';
  }
  useEffect(()=>{
    alive.current=true;
    const invalidate=()=>{epoch.current+=1;release();setUrl('');setBusy(false);setExpanded(false);};
    const hidden=()=>{if(document.visibilityState!=='visible')invalidate();};
    const unsubscribe=onFirebaseSessionInvalidated(invalidate);
    document.addEventListener('visibilitychange',hidden);
    return()=>{alive.current=false;epoch.current+=1;release();unsubscribe();document.removeEventListener('visibilitychange',hidden);};
  },[target.ownerUserId,target.visitId,target.interventionId,target.assetId,evidence.id]);
  useEffect(()=>{
    if(evidence.kind!=='photo'||!container.current)return;
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)&&document.visibilityState==='visible'){
        observer.disconnect();void open();
      }
    });
    observer.observe(container.current);return()=>observer.disconnect();
  // A viewer is keyed to its evidence/context; load only when its thumbnail is visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    if(expanded&&url)dialog.current?.showModal();else dialog.current?.close();
  },[expanded,url]);
  async function open(){
    if(busy)return;
    const version=++epoch.current;setBusy(true);setError('');
    try {
      const blob=await readProcedureEvidence(target,evidence);
      if(!alive.current||version!==epoch.current||document.visibilityState!=='visible')return;
      release();currentUrl.current=URL.createObjectURL(blob);setUrl(currentUrl.current);
    }catch(e){
      if(!alive.current||version!==epoch.current)return;
      setError(e instanceof Error?e.message:'No se pudo abrir la evidencia privada.');
      if([401,403].includes((e as {status?:number})?.status||0))denied.current();
    }finally{if(alive.current&&version===epoch.current)setBusy(false);}
  }
  return <div ref={container} className={styles.viewer} role="group" aria-label="Archivo privado del procedimiento">
    {error?<p role="alert">{error}</p>:null}
    {url?<>
      {evidence.kind==='photo'?<>
        <button type="button" className={styles.thumbnail} aria-label="Ampliar foto del procedimiento" onClick={()=>setExpanded(true)}>
          <img src={url} alt="Evidencia privada del procedimiento"/><span>Ampliar foto</span>
        </button>
        <dialog ref={dialog} className={styles.dialog} aria-label="Foto del procedimiento ampliada" onClose={()=>setExpanded(false)} onClick={event=>{if(event.target===event.currentTarget)setExpanded(false);}}>
          <button type="button" autoFocus onClick={()=>setExpanded(false)}>Cerrar ampliación</button>
          <img src={url} alt="Evidencia privada ampliada"/>
        </dialog>
      </>
        :evidence.kind==='audio'?<audio src={url} controls preload="metadata" aria-label="Audio del procedimiento"/>
          :<video src={url} controls playsInline preload="metadata" aria-label="Video del procedimiento" style={{maxWidth:'100%'}}/>}
      <button type="button" onClick={()=>{epoch.current+=1;release();setUrl('');setExpanded(false);}}>Cerrar archivo</button>
    </>:<button type="button" disabled={busy} onClick={()=>void open()}>{busy?'Verificando archivo…':'Abrir archivo privado'}</button>}
  </div>;
}
