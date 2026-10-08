'use client';

export function ProcedureFormStatus({draft}:{draft:{ready:boolean;saving:boolean;error:string;retry:()=>Promise<void>;conflict:{value:Record<string,string>}|null;resolveConflict:(keepLocal:boolean)=>Promise<void>}}) {
  if(draft.error)return <div role="alert"><p>{draft.error}</p><p>El texto sigue en pantalla. Reintenta guardarlo antes de salir.</p>
    {draft.conflict?<><strong>Borrador guardado en la otra pestaña</strong>{Object.values(draft.conflict.value).filter(Boolean).map((text,index)=><p key={index}>{text}</p>)}
      <button type="button" disabled={draft.saving} onClick={()=>void draft.resolveConflict(true)}>Comparé los borradores; conservar mi texto</button>
      <button type="button" disabled={draft.saving} onClick={()=>void draft.resolveConflict(false)}>Usar borrador de la otra pestaña</button></>:null}
    <button type="button" disabled={draft.saving} onClick={()=>void draft.retry()}>Reintentar guardar formulario</button></div>;
  return <p role="status">{!draft.ready?'Recuperando borrador de tu cuenta…':draft.saving?'Guardando borrador en este dispositivo…':'Borrador local protegido. Solo el envío explícito registra el cambio en el servidor.'}</p>;
}
