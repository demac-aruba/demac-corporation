'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldProcedureTarget } from '../../lib/field-procedure-contract';
import type { ProcedureEvidence } from '../../lib/field-procedure-workspace';
import { readProcedureEvidence } from '../../lib/field-procedure-media-client';
import { onFirebaseSessionInvalidated } from '../../lib/firebase/session';

// Bytes are authorized and hash-checked before creating a device-local URL.
// Never persist that URL or substitute it for the canonical evidence identity.
export function ProcedureEvidenceViewer({target,evidence,onDenied}:{
  target:FieldProcedureTarget; evidence:ProcedureEvidence; onDenied:()=>void;
}) {
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const currentUrl=useRef(''),epoch=useRef(0),alive=useRef(false);
  const denied=useRef(onDenied);denied.current=onDenied;
  function release(){
    if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);
    currentUrl.current='';
  }
  useEffect(()=>{
    alive.current=true;
    const invalidate=()=>{epoch.current+=1;release();setUrl('');setBusy(false);};
    const hidden=()=>{if(document.visibilityState!=='visible')invalidate();};
    const unsubscribe=onFirebaseSessionInvalidated(invalidate);
    document.addEventListener('visibilitychange',hidden);
    return()=>{alive.current=false;epoch.current+=1;release();unsubscribe();document.removeEventListener('visibilitychange',hidden);};
  },[target.ownerUserId,target.visitId,target.interventionId,target.assetId,evidence.id]);
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
  return <div>
    {error?<p role="alert">{error}</p>:null}
    {url?<>
      {evidence.kind==='photo'?<img src={url} alt="Evidencia privada del procedimiento" style={{maxWidth:'100%',height:'auto'}}/>
        :evidence.kind==='audio'?<audio src={url} controls preload="metadata" aria-label="Audio del procedimiento"/>
          :<video src={url} controls playsInline preload="metadata" aria-label="Video del procedimiento" style={{maxWidth:'100%'}}/>}
      <button type="button" onClick={()=>{epoch.current+=1;release();setUrl('');}}>Cerrar archivo</button>
    </>:<button type="button" disabled={busy} onClick={()=>void open()}>{busy?'Verificando archivo…':'Abrir archivo privado'}</button>}
  </div>;
}
