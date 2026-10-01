'use strict';

const { fieldError } = require('./fieldOperationsAuthorityCore');
const { fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');

const PARTS = ['indoor','outdoor'];

function text(value, limit=1500) {
  return typeof value === 'string' ? value.trim().slice(0,limit) : '';
}
function id(value, field) {
  const valueText=text(value,180);
  if(!valueText || !/^[-A-Za-z0-9_.:]+$/.test(valueText) || valueText.includes('..') || valueText==='.') {
    throw fieldError('procedure_exception_queue_state_conflict', `La identidad de ${field} no es válida.`, 409);
  }
  return valueText;
}
function timestamp(value, field) {
  const valueText=text(value,100);
  if(!valueText || !Number.isFinite(Date.parse(valueText))) {
    throw fieldError('procedure_exception_queue_state_conflict', `La fecha de ${field} no es válida.`, 409);
  }
  return valueText;
}
function nonNegative(value, field) {
  if(!Number.isSafeInteger(value) || value<0) {
    throw fieldError('procedure_exception_queue_state_conflict', `La versión de ${field} no es válida.`, 409);
  }
  return value;
}
function object(value, field) {
  if(!value || typeof value!=='object' || Array.isArray(value)) {
    throw fieldError('procedure_exception_queue_state_conflict', `El estado de ${field} no es válido.`, 409);
  }
  return value;
}

function pendingExceptionItems(record) {
  const interventionId=id(record.id,'intervención');
  const visitId=id(record.visitId,'visita');
  const assetId=id(record.assetId,'equipo');
  const workOrderId=id(record.workOrderId,'trabajo');
  const workflow=object(record.procedureWorkflow,'procedimientos');
  const protocol=object(workflow.protocol,'protocolo');
  const protocolParts=object(protocol.parts,'partes del protocolo');
  const states=object(workflow.parts,'partes del expediente');
  const interventionVersion=Number.isSafeInteger(record.version) && record.version>=1 ? record.version
    : (()=>{throw fieldError('procedure_exception_queue_state_conflict','La versión de la intervención no es válida.',409);})();
  const rows=[];

  for(const part of PARTS) {
    const definition=object(protocolParts[part],part);
    if(!Array.isArray(definition.steps)) throw fieldError('procedure_exception_queue_state_conflict','El protocolo de procedimientos está incompleto.',409);
    const titles=new Map(definition.steps.map(step=>{
      const entry=object(step,'definición de procedimiento');
      return [id(entry.id,'procedimiento'),text(entry.title,240)];
    }));
    const state=object(states[part],part);
    const stepStates=object(state.steps,'estado de procedimientos');
    const partVersion=nonNegative(state.version,`parte ${part}`);
    for(const [stepId,rawStep] of Object.entries(stepStates)) {
      const step=object(rawStep,'procedimiento');
      const exception=step.exception;
      if(!exception || typeof exception!=='object' || Array.isArray(exception) || exception.reviewStatus!=='pending') continue;
      if(!titles.has(stepId)) throw fieldError('procedure_exception_queue_state_conflict','El procedimiento pendiente no pertenece al protocolo congelado.',409);
      const author=object(exception.author,'autor de excepción');
      rows.push({
        key:`${interventionId}:${part}:${stepId}`,
        visitId,interventionId,assetId,workOrderId,part,stepId:id(stepId,'procedimiento'),
        title:titles.get(stepId)||stepId,
        reason:text(exception.reason,1500),
        requestedAt:timestamp(exception.receivedAt,'solicitud de excepción'),
        requestedByUserId:id(author.userId,'autor'),
        requestedByName:text(author.name,180)||id(author.userId,'autor'),
        ownerUserId:state.ownerUserId ? id(state.ownerUserId,'responsable de parte') : null,
        ownerName:text(state.ownerName,180)||null,
        partVersion,interventionVersion,
      });
    }
  }
  return rows;
}

/** Read-only discovery for Office. Review mutations continue through procedure workflow authority. */
async function loadProcedureExceptionQueue(db, identity) {
  if(!identity?.operations) throw fieldError('permission_denied','Solo oficina puede consultar excepciones de procedimientos pendientes.',403);
  const snap=await db.collection('workInterventions').where('status','==','in_progress').get();
  const records=(snap?.docs||[]).map(fieldSnapshotRecord);
  const visits=new Map();
  const result=[];

  for(const record of records) {
    if(!record?.procedureWorkflow) continue;
    const visitId=id(record.visitId,'visita');
    let visit=visits.get(visitId);
    if(visit===undefined) {
      const visitSnap=await db.collection('workVisits').doc(visitId).get();
      visit=visitSnap.exists ? fieldSnapshotRecord(visitSnap) : null;
      visits.set(visitId,visit);
    }
    if(!visit || visit.status!=='in_progress') continue;
    result.push(...pendingExceptionItems(record));
    if(result.length>200) throw fieldError('procedure_exception_queue_limit','Hay demasiadas excepciones pendientes para una sola carga. Resuelve las más antiguas y actualiza.',409);
  }
  result.sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.key.localeCompare(b.key));
  return result;
}

module.exports={loadProcedureExceptionQueue,pendingExceptionItems};
