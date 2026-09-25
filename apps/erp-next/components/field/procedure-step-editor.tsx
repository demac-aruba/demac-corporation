'use client';

import { useState } from 'react';
import type { FieldProcedurePart } from '../../lib/field-procedure-contract';
import { procedureLabel, procedureStatusLabel } from '../../lib/field-procedure-ui-model';
import type { ProcedureStep } from '../../lib/field-procedure-workspace';
import { ProcedureMediaPanel } from './procedure-media-panel';
import type { ProcedureSession } from './use-procedure-session';
import { useProcedureDraft } from './use-procedure-draft';
import styles from './field-procedure-workspace.module.css';

export function ProcedureStepEditor({session,part,step,onBack}:{
  session:ProcedureSession; part:FieldProcedurePart; step:ProcedureStep; onBack:()=>void;
}) {
  const state=session.workspace!.procedureParts.find(p=>p.id===part)!;
  const safety=session.workspace!.safety!;
  const draft=useProcedureDraft(session.target,part,step,state.version,safety.revision);
  const [exception,setException]=useState('');
  const [feedback,setFeedback]=useState('');
  const [reviewNote,setReviewNote]=useState('');
  const [reviewDisposition,setReviewDisposition]=useState<'not_documented'|'not_applicable'|'not_performed'>('not_documented');
  const owner=state.ownerUserId===session.target.ownerUserId;
  const blockedRisk=session.workspace!.risks.some(r=>r.status==='open' && r.parts.includes(part));
  const writable=owner
    && session.workspace!.allowedActions.includes('report.edit')
    && session.workspace!.interventionStatus==='in_progress'
    && !state.completedAt
    && step.exception?.reviewStatus!=='approved'
    && safety.phase===step.stage
    && !blockedRisk;
  const canEdit=writable && draft.ready && !session.busy && !session.operation && !draft.error;
  const canSave=canEdit && session.canCommand && !draft.conflict && !draft.saving;
  const decisionRequired=Boolean(step.recommendation && draft.value.result && !['buen_estado','alto_riesgo'].includes(draft.value.result));
  const localFiles=session.captures.filter(c=>c.part===part && c.stepId===step.id && c.stage!=='confirmed').length;

  async function save() {
    if(!canSave || !await draft.flush())return;
    setFeedback('');
    if(step.competent && !draft.value.competenceConfirmed){
      setFeedback('Confirma la verificación por una persona competente o registra la limitación mediante una excepción.');
      return;
    }
    const raw=draft.value.measurementValue.trim();
    const measured=raw ? Number(raw.replace(',','.')) : null;
    if(raw && (measured===null || !Number.isFinite(measured))){
      setFeedback('Escribe el valor medido como número; no una estimación.');
      return;
    }
    if(step.options.length && !step.options.includes(draft.value.result)){
      setFeedback('Selecciona el resultado observado.');
      return;
    }
    const next=await session.execute({
      action:'save_step',
      part,
      stepId:step.id,
      expectedPartVersion:state.version,
      expectedSafetyRevision:safety.revision,
      result:step.options.length?draft.value.result:null,
      note:draft.value.note.trim(),
      complete:true,
      measurement:measured===null?null:{value:measured,unit:draft.value.measurementUnit},
      competenceConfirmed:draft.value.competenceConfirmed,
      customerDecision:decisionRequired?draft.value.customerDecision||null:null,
      decisionPerson:decisionRequired?draft.value.decisionPerson.trim():'',
    });
    const confirmed=next?.procedureParts.find(p=>p.id===part)?.steps.find(s=>s.id===step.id);
    if(confirmed){
      draft.acknowledge(confirmed);
      await draft.flush();
      setFeedback(confirmed.status==='documented'
        ? 'Procedimiento documentado y confirmado.'
        : 'Resultado guardado. Completa los pendientes señalados antes de finalizar la parte.');
    }
  }

  return <>
    <div className={styles.toolbar}>
      <button type="button" onClick={onBack}>Volver a procedimientos</button>
      <span className={styles.pill}>{part==='indoor'?'Evaporadora':'Condensadora'} · {step.id}</span>
    </div>

    <section className={styles.card}>
      <div className={styles.toolbar}><h2>{step.title}</h2><span className={styles.pill}>{procedureStatusLabel[step.status]}</span></div>
      <p>{step.instruction}</p>
      <small>Etapa: {procedureLabel(step.stage)}. {step.author?'Último registro: '+(step.author.name||step.author.userId)+'.':'Sin resultado confirmado todavía.'}</small>
      {!writable?<p className={styles.warning}>
        {!owner?'Consulta compartida: solo la persona asignada a esta parte puede registrar su ejecución.'
          :blockedRisk?'Actividad afectada bloqueada por riesgo alto. La no aceptación del cliente no elimina el bloqueo.'
          :state.completedAt?'La documentación de esta parte ya está finalizada.'
          :session.workspace!.interventionStatus!=='in_progress'?'La intervención debe estar en ejecución mediante el flujo autorizado.'
          :'Esta acción corresponde a otra etapa de coordinación.'}
      </p>:null}
      {!session.fresh && writable?<p className={styles.warning}>Coordinación sin confirmar. El borrador local no autoriza trabajo físico ni equivale a una confirmación del servidor.</p>:null}
      {step.missing.length?<div className={styles.notice}><strong>Pendientes para documentar</strong><p>{step.missing.map(procedureLabel).join(' · ')}</p></div>:null}
      {localFiles?<div className={styles.warning}>{localFiles} archivo(s) local(es) todavía sin vínculo confirmado.</div>:null}
    </section>

    <section className={styles.card} aria-label="Resultado del procedimiento">
      <h3>Resultado y observaciones</h3>
      {!owner?<div className={styles.readOnly}>
        <strong>{step.result?procedureLabel(step.result):'Resultado no registrado'}</strong>
        <p>{step.note||'Sin nota registrada.'}</p>
        {step.recordedMeasurement?<p>{step.recordedMeasurement.value} {step.recordedMeasurement.unit}</p>:null}
      </div>:<>
        {!draft.ready?<p role="status">Abriendo borrador de tu cuenta…</p>:null}
        {draft.error?<div className={styles.error} role="alert">
          {draft.error}<p>Conserva el texto en esta pantalla; no se anuncia como guardado.</p>
          <button type="button" onClick={()=>void draft.retryLocalSave()}>Reintentar almacenamiento local</button>
        </div>:null}
        {draft.conflict?<div className={styles.warning} role="alert">
          <strong>El resultado del servidor cambió.</strong>
          <p>Servidor: {step.result?procedureLabel(step.result):'Sin resultado'} · {step.note||'Sin nota'}.</p>
          <p>Tu borrador permanece intacto. Compara antes de preparar una nueva solicitud.</p>
          <div className={styles.actions}>
            <button type="button" disabled={!session.fresh||session.busy||Boolean(session.operation)} onClick={()=>draft.reviewServer(step,true)}>Revisé el cambio; conservar mi borrador</button>
            <button type="button" disabled={!session.fresh||session.busy||Boolean(session.operation)} onClick={()=>draft.reviewServer(step,false)}>Usar el resultado del servidor</button>
          </div>
        </div>:null}
        <div className={styles.fields}>
          {step.options.length?<label>Resultado observado
            <select value={draft.value.result} disabled={!canEdit} onChange={e=>draft.change({...draft.value,result:e.target.value,customerDecision:'',decisionPerson:''})}>
              <option value="">Seleccionar resultado</option>
              {step.options.map(option=><option key={option} value={option}>{procedureLabel(option)}</option>)}
            </select>
          </label>:null}
          {step.measurement?<div className={styles.pair}>
            <label>{step.id==='O02'?'Presión medida':'Medición'}
              <input inputMode="decimal" value={draft.value.measurementValue} maxLength={30} disabled={!canEdit} onChange={e=>draft.field('measurementValue',e.target.value)}/>
            </label>
            <label>Unidad
              <select value={draft.value.measurementUnit} disabled={!canEdit} onChange={e=>draft.field('measurementUnit',e.target.value)}>
                {(step.id==='O02'?['psi','bar','kPa','MPa']:['°C','°F']).map(unit=><option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
          </div>:null}
          <label className={styles.full}>Observación técnica
            <textarea rows={3} value={draft.value.note} maxLength={1500} disabled={!canEdit} onChange={e=>draft.field('note',e.target.value)} placeholder="Describe lo observado, sin atribuir causas no verificadas."/>
          </label>
          {decisionRequired?<><label>Respuesta del cliente
            <select value={draft.value.customerDecision} disabled={!canEdit} onChange={e=>draft.field('customerDecision',e.target.value as typeof draft.value.customerDecision)}>
              <option value="">Seleccionar respuesta</option><option value="accepted">Aceptó</option><option value="declined">No aceptó</option><option value="pending">Pendiente</option>
            </select>
          </label><label>Persona que decidió
            <input value={draft.value.decisionPerson} maxLength={180} disabled={!canEdit} onChange={e=>draft.field('decisionPerson',e.target.value)}/>
            <small>Confirma que puede autorizar el gasto; no asumas que es el contacto de acceso.</small>
          </label></>:null}
          {step.competent?<label className={styles.check+' '+styles.full}>
            <input type="checkbox" checked={draft.value.competenceConfirmed} disabled={!canEdit} onChange={e=>draft.field('competenceConfirmed',e.target.checked)}/>
            Confirmo que esta verificación la realizó una persona competente con las medidas de seguridad aplicables.
          </label>:null}
        </div>
        <small role="status">{draft.saving?'Protegiendo borrador…':draft.error?'Borrador sin protección confirmada':draft.ready?'Borrador disponible en este dispositivo. No equivale a resultado enviado.':''}</small>
      </>}
    </section>

    <ProcedureMediaPanel session={session} part={part} step={step} canCapture={writable && session.localReady && !session.busy && !session.operation}/>

    {step.exception?<section className={styles.card} aria-label="Excepción del procedimiento">
      <h3>Excepción documentada</h3>
      <p>{step.exception.reason}</p>
      <span className={styles.pill}>{step.exception.reviewStatus==='pending'?'Pendiente de oficina':step.exception.reviewStatus==='approved'?'Aprobada por oficina':'Devuelta por oficina'}</span>
      {step.exception.disposition?<small>Disposición: {procedureLabel(step.exception.disposition)}. No representa trabajo que no se realizó.</small>:null}
      {session.workspace!.allowedActions.includes('office.review') && step.exception.reviewStatus==='pending'?<>
        <label>Motivo de la revisión
          <textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)} rows={3} maxLength={1500}/>
        </label>
        <label>Disposición al aprobar
          <select value={reviewDisposition} onChange={e=>setReviewDisposition(e.target.value as typeof reviewDisposition)}>
            <option value="not_documented">Trabajo sin documentación suficiente</option>
            <option value="not_applicable">No aplica a este procedimiento</option>
            <option value="not_performed">Trabajo no realizado — continúa pendiente</option>
          </select>
        </label>
        <div className={styles.actions}>
          <button type="button" disabled={!session.canCommand||reviewNote.trim().length<3}
            onClick={async()=>{
              const next=await session.execute({action:'review_exception',part,stepId:step.id,expectedPartVersion:state.version,decision:'approve',reason:reviewNote.trim(),disposition:reviewDisposition});
              if(next)setReviewNote('');
            }}>Aprobar excepción con disposición</button>
          <button type="button" disabled={!session.canCommand||reviewNote.trim().length<3}
            onClick={async()=>{
              const next=await session.execute({action:'review_exception',part,stepId:step.id,expectedPartVersion:state.version,decision:'reject',reason:reviewNote.trim()});
              if(next)setReviewNote('');
            }}>Devolver excepción</button>
        </div>
      </>:null}
    </section>:null}

    {owner && session.workspace!.allowedActions.includes('report.edit') && session.workspace!.interventionStatus==='in_progress' && !state.completedAt?
      <details className={styles.coordination}><summary>No pude completar o documentar este procedimiento</summary>
        <section className={styles.card}>
          <p>Registra una excepción real para revisión. No se inventa una foto ANTES ni se declara trabajo realizado por presentar la solicitud.</p>
          <label>Motivo de la excepción<textarea value={exception} onChange={e=>setException(e.target.value)} maxLength={1500} rows={3}/></label>
          <button type="button" disabled={!session.canCommand||exception.trim().length<3} onClick={async()=>{
            if(!await draft.flush())return;
            const result=await session.execute({action:'request_exception',part,stepId:step.id,expectedPartVersion:state.version,expectedSafetyRevision:safety.revision,reason:exception.trim()});
            if(result)setException('');
          }}>Solicitar revisión de excepción</button>
        </section>
      </details>:null}

    {feedback?<p className={styles.notice} role="status">{feedback}</p>:null}
    {owner?<div className={styles.sticky}>
      <button type="button" onClick={onBack}>Volver a lista</button>
      <button type="button" className={styles.primary} disabled={!canSave} onClick={()=>void save()}>Guardar procedimiento</button>
    </div>:null}
  </>;
}