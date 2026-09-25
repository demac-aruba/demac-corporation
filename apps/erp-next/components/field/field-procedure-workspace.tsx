'use client';

import { useMemo, useState } from 'react';
import type { FieldProcedurePart, FieldProcedureTarget } from '../../lib/field-procedure-contract';
import { procedureLabel, procedureStatusLabel } from '../../lib/field-procedure-ui-model';
import { requestProcedureExit } from '../../lib/field-procedure-navigation';
import { PortalIcon } from './field-portal-chrome';
import { ProcedureStepEditor } from './procedure-step-editor';
import { useProcedureSession } from './use-procedure-session';
import styles from './field-procedure-workspace.module.css';

export function FieldProcedureWorkspace({target,initialPart,equipmentLabel,equipmentDescription,onBack,onOpenAddons}:{
  target:FieldProcedureTarget;
  initialPart:FieldProcedurePart;
  equipmentLabel:string;
  equipmentDescription:string;
  onBack:()=>void;
  onOpenAddons?:()=>void;
}) {
  const session=useProcedureSession(target);
  const [part,setPart]=useState<FieldProcedurePart>(initialPart);
  const [stepId,setStepId]=useState<string|null>(null);
  const [riskOpen,setRiskOpen]=useState(false);
  const [riskReason,setRiskReason]=useState('');
  const [riskParts,setRiskParts]=useState<Record<FieldProcedurePart,boolean>>({indoor:initialPart==='indoor',outdoor:initialPart==='outdoor'});
  const [riskResolution,setRiskResolution]=useState('');
  const [riskCompetentPerson,setRiskCompetentPerson]=useState('');
  const [riskCompetenceConfirmed,setRiskCompetenceConfirmed]=useState(false);
  const [isolationNote,setIsolationNote]=useState('');
  const [isolationCompetent,setIsolationCompetent]=useState(false);
  const [partSafe,setPartSafe]=useState(false);
  const [finalResult,setFinalResult]=useState('');
  const [finalNote,setFinalNote]=useState('');
  const [finalCompetent,setFinalCompetent]=useState(false);

  const workspace=session.workspace;
  const state=workspace?.procedureParts.find(p=>p.id===part) ?? null;
  const step=state?.steps.find(s=>s.id===stepId) ?? null;
  const ownPart=state?.ownerUserId===target.ownerUserId;
  const openRisk=workspace?.risks.find(r=>r.status==='open');
  const blocked=openRisk?.parts.includes(part) ?? false;
  const pendingLocal=useMemo(()=>session.captures.filter(c=>c.stage!=='confirmed'),[session.captures]);
  const bothPartsReady=workspace?.procedureParts.every(p=>Boolean(p.completedAt)&&p.safeToTest) ?? false;

  function goBack(){if(requestProcedureExit())onBack();}

  if(session.loading && !workspace){
    return <section className={styles.workspace}>
      <div className={styles.notice}>Cargando procedimientos autorizados…</div>
      <button type="button" onClick={goBack}>Volver</button>
    </section>;
  }
  if(!workspace){
    return <section className={styles.workspace}>
      {session.error?<div className={styles.error}>{session.error}</div>:null}
      <button type="button" onClick={()=>void session.refresh()}>Reintentar</button>
      <button type="button" onClick={goBack}>Volver</button>
    </section>;
  }
  if(!workspace.safety){
    return <section className={styles.workspace}>
      <div className={styles.warning}>El servidor no proyectó un protocolo activo para esta intervención. No se fabricará uno en el navegador.</div>
      <button type="button" onClick={goBack}>Volver</button>
    </section>;
  }

  if(step&&state){
    return <section className={styles.workspace}>
      <div className={styles.context}><PortalIcon name="unit"/><div><strong>{equipmentLabel}</strong><small>{equipmentDescription}</small></div></div>
      {session.error?<div className={styles.error} role="alert">{session.error}</div>:null}
      {session.operation?<div className={styles.warning}>
        <strong>Solicitud pendiente de confirmación</strong>
        <p>Se conservará el mismo identificador al reintentar; no se creará una operación duplicada.</p>
        <div className={styles.actions}>
          <button type="button" disabled={!session.fresh||session.busy} onClick={()=>void session.execute(session.operation!.command,session.operation!)}>Reintentar la misma solicitud</button>
          <button type="button" disabled={!session.fresh||session.busy} onClick={()=>void session.stopRetrying()}>Conservar sin reenviar</button>
        </div>
      </div>:null}
      <ProcedureStepEditor session={session} part={part} step={step} onBack={()=>setStepId(null)} onOpenAddons={onOpenAddons}/>
    </section>;
  }

  return <section className={styles.workspace}>
    <div className={styles.context}><PortalIcon name="unit"/><div><strong>{equipmentLabel}</strong><small>{equipmentDescription}</small><small>{workspace.protocolName}</small></div></div>
    <div className={styles.toolbar}>
      <div><h2>Procedimientos del servicio</h2><small>Un aire · un servicio · dos partes. Cada registro conserva autoría.</small></div>
      <button type="button" onClick={()=>void session.refresh()} disabled={session.loading||session.busy}>Actualizar</button>
    </div>

    {!session.fresh?<div className={styles.warning}>{session.loading?'Confirmando coordinación con el servidor…':'La coordinación no está confirmada. Los borradores locales no autorizan intervenir, energizar ni cerrar el servicio.'}</div>:null}
    {session.error?<div className={styles.error} role="alert">{session.error}</div>:null}
    {session.notice?<div className={styles.notice} role="status">{session.notice}</div>:null}
    {session.operation?<div className={styles.warning}>
      <strong>Hay una solicitud sin acuse concluyente.</strong>
      <p>Reintentar usa exactamente la misma operación; “conservar sin reenviar” no afirma que el servidor la haya deshecho.</p>
      <div className={styles.actions}>
        <button type="button" disabled={!session.fresh||session.busy} onClick={()=>void session.execute(session.operation!.command,session.operation!)}>Reintentar</button>
        <button type="button" disabled={!session.fresh||session.busy} onClick={()=>void session.stopRetrying()}>Conservar sin reenviar</button>
      </div>
    </div>:null}
    {pendingLocal.length?<div className={styles.warning}>
      <strong>{pendingLocal.length} archivo(s) todavía sin vínculo confirmado.</strong>
      <p>Los originales siguen en este dispositivo. No cuentan como evidencia del servidor hasta completar la sincronización.</p>
      <button type="button" disabled={!session.fresh||session.busy||Boolean(session.operation)} onClick={()=>void session.sync()}>Reintentar archivos pendientes</button>
    </div>:null}
    {openRisk?<div className={styles.error}>
      <strong>Riesgo alto abierto</strong>
      <p>{openRisk.reason}</p>
      <p>Partes afectadas: {openRisk.parts.map(x=>x==='indoor'?'Evaporadora':'Condensadora').join(' y ')}. La no aceptación del cliente no elimina el bloqueo.</p>
      <details className={styles.coordination}>
        <summary>Resolver riesgo — técnico responsable u oficina</summary>
        <div className={styles.fields}>
          <label className={styles.full}>Qué cambió y cómo se eliminó o controló el riesgo
            <textarea rows={3} value={riskResolution} maxLength={1500} onChange={e=>setRiskResolution(e.target.value)}/>
          </label>
          <label>Persona competente que verificó
            <input value={riskCompetentPerson} maxLength={180} onChange={e=>setRiskCompetentPerson(e.target.value)}/>
          </label>
          <label className={styles.check}><input type="checkbox" checked={riskCompetenceConfirmed} onChange={e=>setRiskCompetenceConfirmed(e.target.checked)}/>Confirmo que una persona competente verificó físicamente la resolución. Esto no se deduce del rol de la app.</label>
          <button type="button" disabled={!session.canCommand||riskResolution.trim().length<3||riskCompetentPerson.trim().length<3||!riskCompetenceConfirmed}
            onClick={async()=>{
              const next=await session.execute({action:'resolve_risk',riskId:openRisk.id,expectedSafetyRevision:workspace.safety!.revision,reason:riskResolution.trim(),competentPerson:riskCompetentPerson.trim(),competenceConfirmed:riskCompetenceConfirmed});
              if(next){setRiskResolution('');setRiskCompetentPerson('');setRiskCompetenceConfirmed(false);setPartSafe(false);}
            }}>Confirmar resolución del riesgo</button>
        </div>
      </details>
    </div>:null}

    <div className={styles.tabs} role="tablist" aria-label="Parte del equipo">
      {(['indoor','outdoor'] as FieldProcedurePart[]).map(id=>{
        const p=workspace.procedureParts.find(x=>x.id===id)!;
        return <button key={id} role="tab" aria-selected={part===id} aria-pressed={part===id}
          onClick={()=>{setPart(id);setStepId(null);setPartSafe(false);}}>
          {id==='indoor'?'Evaporadora':'Condensadora'} · {p.documented}/{p.total}
        </button>;
      })}
    </div>

    {state?<><div className={styles.progress}>
      <div className={styles.toolbar}><strong>{state.label}</strong><span className={styles.pill}>{state.ownerUserId===target.ownerUserId?'Tu parte':state.ownerName||'Parte de otro miembro'}</span></div>
      <progress value={state.documented} max={state.total}/>
      <small>{Math.round(state.documented/state.total*100)}% documentado · {state.exceptions} excepción(es) · {state.pendingFiles} archivo(s) reservados pendientes</small>
      {state.completedAt?<small>Documentación de parte finalizada. Esto no envía el cierre global del servicio.</small>:null}
    </div>
    {!ownPart?<div className={styles.notice}>Puedes consultar esta parte, pero solo su persona asignada registra ejecución. La asignación se cambia desde la pantalla anterior.</div>:null}
    {blocked?<div className={styles.error}>Esta parte permanece bloqueada por riesgo alto. No se habilitan acciones de procedimiento hasta que el flujo autorizado lo resuelva.</div>:null}
    <div className={styles.steps}>
      {state.steps.map((s,index)=><button className={styles.step} data-status={s.status} type="button" key={s.id} onClick={()=>setStepId(s.id)}>
        <span className={styles.number}>{String(index+1).padStart(2,'0')}</span>
        <span className={styles.stepCopy}><strong>{s.title}</strong><small>{procedureStatusLabel[s.status]}{s.missing.length?' · falta '+s.missing.map(procedureLabel).join(', '):''}</small></span>
        <PortalIcon name="chevron"/>
      </button>)}
    </div></>:null}

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <div><h3>Anomalías y seguridad</h3><small>Acceso único para todo el listado; no se repite dentro de cada procedimiento.</small></div>
        <button type="button" className={styles.danger} onClick={()=>setRiskOpen(v=>!v)}>Reportar anomalía</button>
      </div>
      {riskOpen?<div className={styles.fields}>
        <label className={styles.full}>Descripción objetiva del riesgo
          <textarea rows={3} value={riskReason} maxLength={1500} onChange={e=>setRiskReason(e.target.value)} placeholder="Describe lo observado y qué actividad queda afectada."/>
        </label>
        <label className={styles.check}><input type="checkbox" checked={riskParts.indoor} onChange={e=>setRiskParts(v=>({...v,indoor:e.target.checked}))}/>Evaporadora afectada</label>
        <label className={styles.check}><input type="checkbox" checked={riskParts.outdoor} onChange={e=>setRiskParts(v=>({...v,outdoor:e.target.checked}))}/>Condensadora afectada</label>
        <button type="button" className={styles.danger} disabled={!session.canCommand||riskReason.trim().length<3||(!riskParts.indoor&&!riskParts.outdoor)}
          onClick={async()=>{
            const result=await session.execute({action:'report_risk',affectedParts:(['indoor','outdoor'] as FieldProcedurePart[]).filter(x=>riskParts[x]),reason:riskReason.trim()});
            if(result){setRiskReason('');setRiskOpen(false);}
          }}>Registrar riesgo alto y bloquear actividad afectada</button>
      </div>:null}
    </section>

    {workspace.safety.phase==='initial'?<details className={styles.coordination}>
      <summary>Coordinación para aislamiento</summary>
      <section className={styles.card}>
        <p>Este botón documenta una confirmación; no sustituye bloqueo/etiquetado, comunicación ni control físico del equipo.</p>
        <label className={styles.check}><input type="checkbox" checked={isolationCompetent} onChange={e=>setIsolationCompetent(e.target.checked)}/>La verificación fue realizada por persona competente con las medidas de seguridad aplicables.</label>
        <label>Nota de coordinación<textarea rows={3} maxLength={1500} value={isolationNote} onChange={e=>setIsolationNote(e.target.value)}/></label>
        <button type="button" disabled={!session.canCommand||!isolationCompetent||isolationNote.trim().length<3||Boolean(openRisk)}
          onClick={async()=>{
            const next=await session.execute({action:'confirm_isolation',expectedSafetyRevision:workspace.safety!.revision,competenceConfirmed:isolationCompetent,note:isolationNote.trim()});
            if(next){setIsolationCompetent(false);setIsolationNote('');}
          }}>Confirmar aislamiento documentado</button>
      </section>
    </details>:null}

    {ownPart && state && !state.completedAt?<section className={styles.card}>
      <h3>Finalizar documentación de esta parte</h3>
      <p>Solo finaliza tu parte. No cierra el servicio completo ni reemplaza la prueba coordinada final.</p>
      <label className={styles.check}><input type="checkbox" checked={partSafe} onChange={e=>setPartSafe(e.target.checked)}/>Confirmo que, según lo documentado y las medidas físicas aplicadas, esta parte puede entrar a la prueba coordinada cuando corresponda.</label>
      <button type="button" className={styles.primary}
        disabled={!session.canCommand||!partSafe||Boolean(openRisk)||pendingLocal.some(c=>c.part===part)}
        onClick={async()=>{
          const next=await session.execute({action:'finish_part',part,expectedPartVersion:state.version,expectedSafetyRevision:workspace.safety!.revision,safeToTest:true});
          if(next)setPartSafe(false);
        }}>Finalizar mi parte</button>
    </section>:null}

    {workspace.safety.phase==='isolated' && bothPartsReady?<details className={styles.coordination}>
      <summary>Prueba final coordinada — técnico responsable</summary>
      <section className={styles.card}>
        <p>Ambas partes están finalizadas y marcadas listas para prueba. Registra la prueba únicamente después de coordinar físicamente a la cuadrilla y verificar que no quede un riesgo abierto.</p>
        <label>Resultado
          <select value={finalResult} onChange={e=>setFinalResult(e.target.value)}>
            <option value="">Seleccionar</option><option value="enfria">Enfría</option><option value="no_enfria">No enfría</option><option value="inconcluso">Inconcluso</option><option value="no_se_pudo_verificar">No se pudo verificar</option>
          </select>
        </label>
        <label>Nota de prueba<textarea rows={3} value={finalNote} maxLength={1500} onChange={e=>setFinalNote(e.target.value)} placeholder={finalResult==='enfria'?'Opcional si el resultado es Enfría.':'Explica el resultado o la limitación.'}/></label>
        <label className={styles.check}><input type="checkbox" checked={finalCompetent} onChange={e=>setFinalCompetent(e.target.checked)}/>La prueba fue coordinada y verificada por persona competente.</label>
        <button type="button" className={styles.primary}
          disabled={!session.canCommand||!finalResult||!finalCompetent||(finalResult!=='enfria'&&finalNote.trim().length<3)||Boolean(openRisk)||pendingLocal.length>0}
          onClick={async()=>{
            const versions=Object.fromEntries(workspace.procedureParts.map(p=>[p.id,p.version])) as Record<FieldProcedurePart,number>;
            const next=await session.execute({action:'record_final_test',expectedSafetyRevision:workspace.safety!.revision,partVersions:versions,competenceConfirmed:finalCompetent,result:finalResult,note:finalNote.trim()});
            if(next){setFinalResult('');setFinalNote('');setFinalCompetent(false);}
          }}>Registrar prueba final</button>
      </section>
    </details>:null}
    {workspace.safety.phase==='isolated' && !bothPartsReady?<div className={styles.notice}>La prueba final se habilita cuando evaporadora y condensadora estén finalizadas y confirmadas como listas para la prueba.</div>:null}
    {workspace.safety.phase==='final_test'?<div className={styles.notice}><strong>Prueba final confirmada por el servidor.</strong><p>Resultado: {workspace.safety.finalResult?procedureLabel(workspace.safety.finalResult):'sin resultado proyectado'}.</p><p>El técnico responsable todavía debe finalizar la intervención mediante el control de cierre del trabajo; esta pantalla no envía el reporte al cliente.</p></div>:null}

    <button type="button" className={styles.quiet} onClick={goBack}>Volver a seleccionar parte</button>
  </section>;
}