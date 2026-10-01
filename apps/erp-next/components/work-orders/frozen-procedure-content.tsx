'use client';

import { useState } from 'react';
import type { FieldOfficeReviewQueueItem } from '../../lib/field-office-review-contract';
import { procedureLabel, procedureStatusLabel } from '../../lib/field-procedure-ui-model';
import { ProcedureEvidenceViewer } from '../field/procedure-evidence-viewer';
import styles from './browser-office-review-queue.module.css';

export function FrozenProcedureContent({review,userId}:{review:FieldOfficeReviewQueueItem;userId:string}) {
  const [denied,setDenied]=useState(false);
  const documents=review.currentRevision.procedureDocuments||[];
  if(!documents.length)return null;
  return <section aria-label="Procedimientos de la revisión inmutable">
    <h3>Procedimientos · revisión {review.currentRevision.revisionNumber}</h3>
    <p>Resultados y autoría congelados al enviar esta revisión. Consultarlos no modifica la ejecución ni autoriza intervenir el equipo.</p>
    {denied?<p role="alert">Acceso a archivos sin confirmar. Actualiza la revisión antes de continuar.</p>:null}
    {documents.map(document=><article className={styles.frozenReport} key={document.interventionId}>
      <header><strong>{document.protocolName} · {document.assetId}</strong></header>
      <p>Prueba final: {document.safety?.finalResult?procedureLabel(document.safety.finalResult):'Sin prueba final registrada'}.</p>
      {document.procedureParts.map(part=><section key={part.id}>
        <h4>{part.label} · {part.ownerName||'Sin autor asignado'}</h4>
        {part.steps.map(step=><details key={step.id} className={styles.reportSection}>
          <summary>{step.id} · {step.title} · {procedureStatusLabel[step.status]}</summary>
          <p>{step.result?procedureLabel(step.result):'Sin resultado seleccionado'}{step.recordedMeasurement?` · ${step.recordedMeasurement.value} ${step.recordedMeasurement.unit}`:''}</p>
          {step.note?<p>{step.note}</p>:null}
          {step.author?<small>Autor: {step.author.name||step.author.userId} · {step.receivedAt?new Date(step.receivedAt).toLocaleString('es-AW'):''}</small>:null}
          {step.exception?<p>Excepción: {step.exception.reason} · {step.exception.disposition?procedureLabel(step.exception.disposition):step.exception.reviewStatus}.</p>:null}
          {document.evidence.filter(e=>step.evidenceIds.includes(e.id)).map(e=><div key={e.id}>
            <p>{procedureLabel(e.view)} · {e.kind} · autor {e.createdBy}</p>
            {!denied?<ProcedureEvidenceViewer target={{ownerUserId:userId,visitId:document.visitId,interventionId:document.interventionId,assetId:document.assetId}} evidence={e} onDenied={()=>setDenied(true)}/>:null}
          </div>)}
        </details>)}
      </section>)}
    </article>)}
  </section>;
}
