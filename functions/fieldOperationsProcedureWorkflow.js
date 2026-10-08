'use strict';

const crypto = require('node:crypto');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const { projectWorkIntervention } = require('./fieldOperationsVisitInterventions');
const { projectVisitAsset } = require('./fieldOperationsVisitAssets');
const protocol = require('./fieldOperationsServiceProtocol');

const MEDIA_LIMITS = Object.freeze({photo: {bytes:12*1024*1024}, audio:{bytes:6*1024*1024}, video:{bytes:20*1024*1024}});
const MIME = Object.freeze({photo:['image/jpeg','image/png','image/webp'],audio:['audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/mp4'],video:['video/mp4','video/webm']});
const OFFICE_ACTIONS = new Set(['review_exception','abandon_capture']);
const PREPARATION_ACTIONS = new Set(['claim_part','release_part','recover_part','initialize']);
const ALLOWED = {
  initialize: [],
  claim_part:['part','expectedPartVersion'], release_part:['part','expectedPartVersion','note'], recover_part:['part','expectedPartVersion','note'],
  save_step:['part','stepId','expectedPartVersion','expectedSafetyRevision','result','note','measurement','complete','competenceConfirmed','customerDecision','decisionPerson'],
  request_exception:['part','stepId','expectedPartVersion','expectedSafetyRevision','reason'],
  review_exception:['part','stepId','expectedPartVersion','decision','reason','disposition'],
  confirm_isolation:['expectedSafetyRevision','competenceConfirmed','note'],
  finish_part:['part','expectedPartVersion','expectedSafetyRevision','safeToTest'],
  record_final_test:['expectedSafetyRevision','partVersions','competenceConfirmed','result','note'],
  resolve_risk:['riskId','expectedSafetyRevision','reason','competentPerson','competenceConfirmed'],
  report_risk:['affectedParts','reason'],
  reopen_for_correction:['expectedVersion','note'],
  prepare_media:['captureId','part','stepId','expectedPartVersion','expectedSafetyRevision','kind','view','contentType','sizeBytes','sha256','source','declaredCapturedAt','durationSeconds'],
  abandon_capture:['captureId','expectedSafetyRevision','reason'],
  commit_media:['captureId','acknowledgeCoordinationChange','reason'], cancel_media:['captureId','reason'],
};
const id = (v,label) => {
  if(typeof v!=='string'||!v||v.length>180||!/^[-A-Za-z0-9_.:]+$/.test(v)||v.includes('..')||v==='.') throw fieldError('invalid_procedure_reference',`Referencia de ${label} inválida.`,400);
  return v;
};
const text = (v,n=2000) => {
  if(v===undefined||v===null)return '';
  if(typeof v!=='string'||v.length>n)throw fieldError('invalid_procedure_text','Texto demasiado largo o inválido.',400);
  return v.trim();
};
const reason = (v) => { const s=text(v);if(s.length<3)throw fieldError('procedure_reason_required','Indica el motivo.',400);return s; };
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const docId = (prefix,v) => `${prefix}-${hash(v).slice(0,32)}`;
const evidenceId = (visitId,interventionId,uid,captureId) => docId('PHE',JSON.stringify([visitId,interventionId,uid,captureId]));
function stableJson(v) {
  if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(stableJson).join(',')+']';
  if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableJson(v[k])).join(',')+'}';
  throw fieldError('invalid_procedure_command','El comando no es JSON válido.',400);
}
function commandInput(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(ALLOWED,value.action))throw fieldError('invalid_procedure_command','Acción de procedimientos no reconocida.',400);
  if(Object.keys(value).some(k=>k!=='action'&&!ALLOWED[value.action].includes(k)))throw fieldError('invalid_procedure_command','El comando contiene campos no admitidos.',400);
  if(Buffer.byteLength(stableJson(value))>16000)throw fieldError('procedure_command_too_large','El comando supera su límite.',400);
  return JSON.parse(stableJson(value));
}
function actor(identity) { if(!identity?.uid)throw fieldError('unauthenticated','Se requiere autenticación.',401);return {userId:id(identity.uid,'usuario'),staffId:identity.staffId||null,name:text(identity.name||identity.uid,180)}; }
function requireVersion(actual,expected,label) {
  if(!Number.isSafeInteger(expected)||expected<0)throw fieldError('procedure_version_required',`Se requiere la versión de ${label}.`,400);
  if(actual!==expected)throw fieldError('procedure_version_conflict',`${label} cambió en otro dispositivo. Conserva tu captura y actualiza.`,409,{actualVersion:actual,expectedVersion:expected});
}
function requireLead(ctx) {
  if(ctx.assignment.responsibility!=='lead')throw fieldError('permission_denied','Esta acción corresponde al técnico responsable asignado.',403);
}
function requireCompetence(command) {
  if(command.competenceConfirmed!==true)throw fieldError('competence_confirmation_required','La persona competente debe confirmar la verificación física; el rol de la app no sustituye capacitación.',409);
}
function partState(w,command,identity,{own=true}={}) {
  if(!protocol.PARTS.includes(command.part))throw fieldError('invalid_procedure_part','Selecciona una parte válida.',400);
  const part=w.parts[command.part];requireVersion(part.version,command.expectedPartVersion,'la parte');
  if(own&&(part.ownerUserId!==identity.uid||part.ownerStaffId!==identity.staffId))throw fieldError('procedure_part_owned_by_other','Solo quien tiene asignada esta parte puede modificarla.',409,{ownerName:part.ownerName});
  return part;
}
function invalidateFinal(w) {w.safety.finalTest=null;if(w.safety.phase==='final_test')w.safety.phase='initial';}
function workPhase(w,command,definition) {
  requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
  if(w.safety.phase==='final_test')throw fieldError('procedure_requires_reisolation','La prueba final ya ocurrió. Se necesita volver a documentar aislamiento antes de intervenir.',409);
  if(definition.stage==='isolated'&&w.safety.phase!=='isolated')throw fieldError('procedure_isolation_required','No hay aislamiento confirmado por servidor para esta actividad.',409);
  if(definition.stage==='initial'&&w.safety.phase!=='initial')throw fieldError('initial_evidence_unavailable','La verificación inicial ya no puede presentarse como realizada antes; solicita una excepción documentada.',409);
  if(definition.stage==='isolated'&&protocol.blockers(w,command.part).length)throw fieldError('procedure_high_risk','La actividad afectada está bloqueada por un riesgo sin resolver.',409);
}
function pendingFor(w,part){return Object.values(w.pendingCaptures).filter(p=>!part||p.part===part);}
function safeManifest(command,identity,visitId,interventionId) {
  const kind=command.kind;
  if(!Object.hasOwn(MEDIA_LIMITS,kind)||!MIME[kind].includes(command.contentType)||!Number.isSafeInteger(command.sizeBytes)||command.sizeBytes<=0||command.sizeBytes>MEDIA_LIMITS[kind].bytes
      ||typeof command.sha256!=='string'||!/^[a-f0-9]{64}$/.test(command.sha256)||!['camera','gallery','recorder','attachment'].includes(command.source))throw fieldError('invalid_procedure_media','Tipo, tamaño u origen de archivo no admitido.',400);
  if(command.declaredCapturedAt!==undefined&&command.declaredCapturedAt!==null&&(typeof command.declaredCapturedAt!=='string'||!Number.isFinite(Date.parse(command.declaredCapturedAt))))throw fieldError('invalid_procedure_capture_time','Fecha declarada inválida.',400);
  if(command.durationSeconds!==undefined&&(!Number.isFinite(command.durationSeconds)||command.durationSeconds<=0||command.durationSeconds>3600))throw fieldError('invalid_procedure_duration','Duración declarada inválida.',400);
  const capture=id(command.captureId,'captura');
  return {captureId:capture,kind,part:command.part,stepId:command.stepId,view:text(command.view,40),contentType:command.contentType,sizeBytes:command.sizeBytes,sha256:command.sha256,source:command.source,
    declaredCapturedAt:command.declaredCapturedAt||null,...(command.durationSeconds===undefined?{}:{durationSeconds:command.durationSeconds}),
    storagePath:`field-evidence/${id(visitId,'visita')}/procedures/${id(interventionId,'intervención')}/${id(identity.uid,'usuario')}/${capture}`};
}
function projectProcedureEvidence(raw,expected={}) {
  if(!raw||raw.fieldAuthorityVersion!==1||raw.targetType!=='service_procedure')throw fieldError('invalid_procedure_evidence','Evidencia de procedimiento inválida.',409);
  const result={id:raw.id,visitId:raw.visitId,workOrderId:raw.workOrderId,customerId:raw.clientId||raw.customerId,propertyId:raw.propertyId,visitAssetId:raw.visitAssetId,assetId:raw.assetId,interventionId:raw.interventionId,
    part:raw.part,procedureId:raw.procedureId,targetComponent:raw.targetComponent,kind:raw.kind,view:raw.view,storagePath:raw.storagePath,contentType:raw.contentType,sizeBytes:raw.sizeBytes,sha256:raw.sha256,generation:raw.generation,
    source:raw.source,declaredCapturedAt:raw.declaredCapturedAt||null,receivedAt:raw.createdAt,createdBy:raw.createdByUserId,createdByStaffId:raw.createdByStaffId,...(raw.durationSeconds===undefined?{}:{durationSeconds:raw.durationSeconds})};
  for(const key of ['id','visitId','workOrderId','customerId','propertyId','visitAssetId','assetId','interventionId','createdBy','createdByStaffId'])id(result[key],key);
  for(const [key,value] of Object.entries(expected))if(value&&result[key]!==value)throw fieldError('procedure_evidence_context_mismatch','La evidencia no corresponde a este trabajo y aire.',409);
  if(!protocol.PARTS.includes(result.part)||!Object.hasOwn(MEDIA_LIMITS,result.kind)||!MIME[result.kind].includes(result.contentType)
      ||!Number.isSafeInteger(result.sizeBytes)||result.sizeBytes<=0||result.sizeBytes>MEDIA_LIMITS[result.kind].bytes||!/^[a-f0-9]{64}$/.test(result.sha256)
      ||!['camera','gallery','recorder','attachment'].includes(result.source)||typeof result.generation!=='string'||!/^\d+$/.test(result.generation)||!Number.isFinite(Date.parse(result.receivedAt)))throw fieldError('invalid_procedure_evidence','Metadata de evidencia no válida.',409);
  if(!result.storagePath?.startsWith(`field-evidence/${result.visitId}/procedures/${result.interventionId}/${result.createdBy}/`)||result.storagePath.includes('..'))throw fieldError('invalid_procedure_evidence_path','Ruta de evidencia no válida.',409);
  return result;
}
function canonicalEvidence(records,expected) {return records.filter(r=>r.targetType==='service_procedure').map(r=>projectProcedureEvidence(r,expected));}
function validateProcedureContent(workflow,evidence) {
  const w=protocol.validateWorkflow(workflow),used=new Set(),objects=new Set();
  for(const part of protocol.PARTS)for(const d of w.protocol.parts[part].steps)for(const eid of w.parts[part].steps[d.id].evidenceIds){
    const e=evidence.find(x=>x.id===eid);
    if(!e||used.has(eid)||e.part!==part||e.procedureId!==d.id||e.targetComponent!==(d.targetComponent||part)
        ||objects.has(e.storagePath+'@'+e.generation))throw fieldError('procedure_evidence_link_conflict','Vínculo de evidencia ausente, repetido o de otro procedimiento.',409);
    if(![...d.views,'supplemental',...(d.measurement?['instrument']:[])].includes(e.view))throw fieldError('procedure_evidence_view_conflict','Vista de evidencia no admitida.',409);
    if(['before','after'].includes(e.view)&&evidence.some(other=>other.id!==e.id&&other.part===part&&other.procedureId===d.id&&other.sha256===e.sha256&&['before','after'].includes(other.view)&&other.view!==e.view))throw fieldError('procedure_before_after_duplicate','El mismo archivo no puede demostrar ANTES y DESPUÉS.',409);
    used.add(eid);objects.add(e.storagePath+'@'+e.generation);
  }
  return w;
}

function createProcedureWorkflowCommands({db,resolveAssignment,appendAuditInTransaction,verifyStoredMedia,now=()=>new Date().toISOString()}={}) {
  if(!db?.runTransaction||!resolveAssignment||!appendAuditInTransaction)throw new Error('Procedure workflow requires the existing transactional Field authorities.');
  async function load(transaction,{identity,visitId,interventionId},action='read',readOnly=false){
    if(!identity?.uid)throw fieldError('unauthenticated','Se requiere autenticación.',401);
    const context=await loadCurrentVisitMutationContext({db,transaction,identity,visitId:id(visitId,'visita'),resolveAssignment,action,requireCurrent:!readOnly,allowCompletedRead:readOnly});
    const ref=db.collection('workInterventions').doc(id(interventionId,'intervención')),snap=await transaction.get(ref);
    if(!snap.exists)throw fieldError('work_intervention_not_found','Intervención no disponible.',404);
    const stored=fieldSnapshotRecord(snap),expected={visitId,workOrderId:context.workOrderId,customerId:context.customerId,propertyId:context.propertyId};
    const intervention=projectWorkIntervention(stored,{...expected,dwellingId:context.dwellingId||''});
    const assetSnap=await transaction.get(db.collection('visitAssets').doc(intervention.visitAssetId));
    if(!assetSnap.exists)throw fieldError('visit_asset_not_found','Aire no disponible en esta visita.',404);
    const asset=projectVisitAsset(fieldSnapshotRecord(assetSnap),{...expected,dwellingId:context.dwellingId||''});
    if(asset.assetId!==intervention.assetId)throw fieldError('procedure_asset_conflict','El aire no corresponde a la intervención.',409);
    const mediaSnap=await transaction.get(db.collection('fieldEvidence').where('interventionId','==',interventionId));
    const evidence=canonicalEvidence(mediaSnap.docs.map(fieldSnapshotRecord),{...expected,interventionId,assetId:intervention.assetId,visitAssetId:intervention.visitAssetId});
    const reviewId='FOR-'+crypto.createHash('sha256').update(context.workOrderId).digest('hex').slice(0,24);
    const reviewSnap=await transaction.get(db.collection('fieldOfficeReviews').doc(reviewId));
    const review=reviewSnap.exists?fieldSnapshotRecord(reviewSnap):null;
    if(review&&review.workOrderId!==context.workOrderId)throw fieldError('office_review_identity_conflict','La revisión no corresponde a este trabajo.',409);
    const workflow=stored.procedureWorkflow?validateProcedureContent(stored.procedureWorkflow,evidence):null;
    return {context,ref,stored,intervention,evidence,workflow,review,expected};
  }
  function bundle(state,at,replayed=false,mutationResult){
    const w=state.workflow;
    return {success:true,version:1,visitId:state.intervention.visitId,interventionId:state.intervention.id,assetId:state.intervention.assetId,workflow:w,
      readiness:w?protocol.completion(w,state.evidence):{complete:false,missing:[{fields:['protocol_not_configured']}],exceptions:[]},
      stepReadiness:Object.fromEntries(protocol.PARTS.map(p=>[p,Object.fromEntries((w?.protocol.parts[p].steps||[]).map(d=>[d.id,protocol.stepMissing(w,p,d.id,state.evidence)]))])),
      evidence:state.evidence,allowedActions:state.context.allowedActions,interventionStatus:state.stored.status,interventionVersion:state.stored.version,serverTime:at,mediaLimits:structuredClone(MEDIA_LIMITS),replayed,...(mutationResult?{mutationResult}:{})};
  }
  async function read(input){const at=now();return db.runTransaction(async transaction=>bundle(await load(transaction,input,'read',true),at));}
  async function authorizeUpload(input){
    return db.runTransaction(async transaction=>{
      const state=await load(transaction,input,'evidence.add');
      const key=id(input.captureId,'captura'),record=state.workflow?.pendingCaptures[key];
      if(!record||record.ownerUserId!==input.identity.uid)throw fieldError('procedure_capture_not_reserved','La captura no tiene una reserva autorizada de este usuario.',409);
      if(state.review&&state.review.status!=='returned'||state.context.canonicalVisit.status!=='in_progress'||state.stored.status!=='in_progress')throw fieldError('procedure_capture_locked','La intervención no acepta archivos ahora.',409);
      if(state.workflow.parts[record.part].ownerUserId!==input.identity.uid||state.workflow.parts[record.part].ownerStaffId!==input.identity.staffId)throw fieldError('permission_denied','La parte cambió de responsable.',403);
      return structuredClone(record);
    });
  }
  async function mutate(input){
    const command=commandInput(input.command),stable=stableRequestId(input.requestId),at=now();
    if(!Number.isFinite(Date.parse(at)))throw new Error('Invalid server clock');
    const owner=actor(input.identity),eventId=docId('FPE',JSON.stringify([input.visitId,input.interventionId,owner.userId,stable]));
    const digest=hash(stableJson(command));
    let verified=null;
    if(command.action==='commit_media'){
      // First authenticate before touching private Storage. A committed retry requires no object upload.
      const current=await read(input),eid=evidenceId(input.visitId,input.interventionId,owner.userId,command.captureId);
      if(!current.evidence.some(e=>e.id===eid)){
        const reservation=await authorizeUpload({...input,captureId:command.captureId});
        if(typeof verifyStoredMedia!=='function')throw fieldError('procedure_media_unavailable','No está configurada la verificación privada de archivos.',503);
        verified=await verifyStoredMedia(reservation.storagePath,reservation.manifest.kind);
      }
    }
    return db.runTransaction(async transaction=>{
      const action=OFFICE_ACTIONS.has(command.action)?'office.review':command.action==='commit_media'||command.action==='prepare_media'||command.action==='cancel_media'?'evidence.add':command.action==='resolve_risk'&&input.identity.operations?'office.review':'report.edit';
      const state=await load(transaction,input,action),{context,ref,stored,evidence,review}=state;
      const eventRef=db.collection('fieldOperationEvents').doc(eventId),prior=await transaction.get(eventRef);
      if(prior.exists){
        const old=prior.data();if(old.metadata?.procedureCommandHash!==digest||old.performedByUserId!==owner.userId)throw fieldError('procedure_request_conflict','El identificador ya fue usado para otra captura.',409);
        return bundle(state,at,true,old.metadata?.mutationResult);
      }
      if(review&&review.status!=='returned')throw fieldError('procedure_review_locked','La revisión enviada o aprobada no se modifica desde campo.',409);
      if(!['on_site','in_progress','pending'].includes(context.canonicalVisit.status))throw fieldError('procedure_visit_locked','La visita no está abierta para captura.',409);
      if(!PREPARATION_ACTIONS.has(command.action)&&command.action!=='reopen_for_correction'&&(stored.status!=='in_progress'||context.canonicalVisit.status!=='in_progress'))throw fieldError('procedure_intervention_not_started','El técnico responsable debe iniciar la intervención compartida antes de registrar ejecución.',409);
      let w=state.workflow?structuredClone(state.workflow):null;
      if(!w){
        if(command.action!=='initialize')throw fieldError('procedure_not_initialized','El catálogo no tiene un protocolo congelado para esta intervención.',409);
        const service=await transaction.get(db.collection('services').doc(state.intervention.serviceCatalogItemId));
        if(!service.exists)throw fieldError('service_not_available','Servicio no disponible en el catálogo.',409);
        w=protocol.initialWorkflow(protocol.protocolForService(fieldSnapshotRecord(service)));
        if(!w)throw fieldError('procedure_not_configured','Este servicio aún no tiene un protocolo definido; no se aplica Standard Service por su nombre.',409);
        if(stored.status==='in_progress'){
          const sameVisit=await transaction.get(db.collection('workInterventions').where('visitId','==',input.visitId));
          if(sameVisit.docs.map(fieldSnapshotRecord).some(row=>row.id!==stored.id&&row.assetId===stored.assetId&&(row.status==='in_progress'||row.procedureWorkflow&&protocol.blockers(protocol.validateWorkflow(row.procedureWorkflow)).length)))throw fieldError('field_asset_protocol_active','Este aire ya tiene otra intervención o riesgo activo.',409);
        }
      }
      const before={revision:w.revision,action:command.action},patch={},extraWrites=[];
      let mutationResult;
      const auditDetails={};
      const bump=(part)=>{w.parts[part].version+=1;w.parts[part].completedAt=null;w.parts[part].safeToTest=false;};
      if(PREPARATION_ACTIONS.has(command.action)&&!['confirmed','in_progress'].includes(stored.status))throw fieldError('procedure_intervention_locked','Intervención cerrada o pendiente de autorización.',409);
      switch(command.action){
        case 'initialize': break;
        case 'claim_part':{
          const p=partState(w,command,input.identity,{own:false});
          if(p.ownerUserId&&p.ownerUserId!==owner.userId)throw fieldError('procedure_part_taken','Otro compañero tomó esta parte.',409,{ownerName:p.ownerName});
          if(p.completedAt)throw fieldError('procedure_part_finished','La parte ya fue finalizada.',409);
          p.ownerUserId=owner.userId;p.ownerStaffId=id(owner.staffId,'empleado');p.ownerName=owner.name;p.version+=1;break;
        }
        case 'release_part':case 'recover_part':{
          const p=partState(w,command,input.identity,{own:command.action==='release_part'});
          if(command.action==='recover_part')requireLead(context);
          if(pendingFor(w,command.part).length)throw fieldError('procedure_upload_pending','Hay archivos de esta parte pendientes; deben recuperarse por su autor.',409);
          if(!p.ownerUserId)throw fieldError('procedure_part_not_owned','La parte todavía no está tomada.',409);
          auditDetails.reason=reason(command.note);auditDetails.previousOwner=p.ownerUserId;
          p.ownerUserId=command.action==='recover_part'?owner.userId:null;p.ownerStaffId=p.ownerUserId?id(owner.staffId,'empleado'):null;p.ownerName=p.ownerUserId?owner.name:null;
          bump(command.part);invalidateFinal(w);w.safety.revision+=1;break;
        }
        case 'save_step':{
          const p=partState(w,command,input.identity),d=protocol.definitionFor(w,command.part,command.stepId);workPhase(w,command,d);
          if(p.completedAt)throw fieldError('procedure_part_finished','La parte ya se finalizó; reabre la corrección con trazabilidad.',409);
          if(d.competent)requireCompetence(command);
          const previous=p.steps[d.id];if(previous.exception?.reviewStatus==='approved')throw fieldError('procedure_exception_frozen','La excepción revisada se conserva; no sustituirla por una ejecución ficticia.',409);
          if(command.complete!==undefined&&typeof command.complete!=='boolean')throw fieldError('invalid_procedure_complete','La confirmación debe ser explícita.',400);
          const result=command.result===undefined||command.result===null||command.result===''?null:command.result;
          if(result!==null&&!d.options.includes(result))throw fieldError('invalid_procedure_result','Resultado fuera de las opciones del procedimiento.',400);
          let measurement=command.measurement??null;
          if(measurement!==null&&(!d.measurement||typeof measurement!=='object'||!Number.isFinite(measurement.value)||!text(measurement.unit,20)))throw fieldError('invalid_procedure_measurement','Medición no válida.',400);
          if(measurement)measurement={value:measurement.value,unit:text(measurement.unit,20)};
          if(d.id==='O02'&&measurement&&!['psi','bar','kPa','MPa'].includes(measurement.unit))throw fieldError('invalid_pressure_unit','Indica una unidad de presión admitida.',400);
          if(!d.recommendation&&(command.customerDecision!=null||command.decisionPerson))throw fieldError('invalid_customer_decision','La decisión debe pertenecer a una inspección con recomendación.',400);
          if(command.customerDecision!==undefined&&command.customerDecision!==null&&!['accepted','declined','pending'].includes(command.customerDecision))throw fieldError('invalid_customer_decision','Respuesta del cliente no válida.',400);
          const next={...previous,result,note:text(command.note),measurement,author:owner,receivedAt:at,competenceConfirmed:command.competenceConfirmed===true,
            customerDecision:command.customerDecision||null,decisionPerson:text(command.decisionPerson,180),exception:null,status:'in_progress'};
          p.steps[d.id]=next;
          if(command.complete===true)next.status=protocol.stepMissing(w,command.part,d.id,evidence).length?'needs_information':'documented';
          if(result==='alto_riesgo'){
            const riskId=`risk-${command.part}-${d.id}`;
            w.risks[riskId]={id:riskId,parts:[...protocol.PARTS],status:'open',reason:`${d.title}: Alto riesgo`,author:owner,receivedAt:at,resolution:null};
            invalidateFinal(w);w.safety.revision+=1;
          }
          auditDetails.stepBefore=previous;auditDetails.stepAfter=next;
          patch.performedByStaffIds=[...new Set([...(stored.performedByStaffIds||[]),id(owner.staffId,'empleado')])];
          bump(command.part);break;
        }
        case 'request_exception':{
          const p=partState(w,command,input.identity),d=protocol.definitionFor(w,command.part,command.stepId);
          requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
          const s=p.steps[d.id];auditDetails.stepBefore=structuredClone(s);
          s.exception={reason:reason(command.reason),author:owner,receivedAt:at,reviewStatus:'pending'};s.status='exception_requested';s.author=owner;s.receivedAt=at;
          bump(command.part);invalidateFinal(w);w.safety.revision+=1;break;
        }
        case 'review_exception':{
          if(!input.identity.operations)throw fieldError('permission_denied','Solo oficina puede resolver la excepción.',403);
          const p=partState(w,command,input.identity,{own:false}),d=protocol.definitionFor(w,command.part,command.stepId),s=p.steps[d.id];
          if(!s.exception||s.exception.reviewStatus!=='pending')throw fieldError('procedure_exception_not_pending','No existe una excepción pendiente.',409);
          if(!['approve','reject'].includes(command.decision)||command.decision==='approve'&&!protocol.DISPOSITIONS.has(command.disposition))throw fieldError('procedure_exception_decision_required','La decisión y disposición son obligatorias.',400);
          s.exception={...s.exception,reviewStatus:command.decision==='approve'?'approved':'rejected',reviewer:owner,reviewedAt:at,reviewReason:reason(command.reason),...(command.decision==='approve'?{disposition:command.disposition}:{})};
          s.status=command.decision==='approve'?'exception_approved':'exception_rejected';bump(command.part);invalidateFinal(w);w.safety.revision+=1;break;
        }
        case 'confirm_isolation':{
          requireLead(context);requireCompetence(command);requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
          if(pendingFor(w).length)throw fieldError('procedure_upload_pending','Sincroniza las verificaciones iniciales antes de cambiar la coordinación.',409);
          for(const part of protocol.PARTS)for(const d of w.protocol.parts[part].steps.filter(s=>s.stage==='initial')){
            if(protocol.stepMissing(w,part,d.id,evidence).length||!['documented','exception_approved'].includes(w.parts[part].steps[d.id].status))throw fieldError('initial_checks_incomplete','Completa o documenta las excepciones de las verificaciones iniciales.',409,{part,stepId:d.id});
          }
          w.safety={...w.safety,revision:w.safety.revision+1,phase:'isolated',isolation:{author:owner,receivedAt:at,note:reason(command.note)},finalTest:null};break;
        }
        case 'finish_part':{
          const p=partState(w,command,input.identity);requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
          if(w.safety.phase!=='isolated'||protocol.blockers(w,command.part).length)throw fieldError('procedure_part_unsafe','No se puede finalizar con coordinación o riesgo pendientes.',409);
          if(pendingFor(w,command.part).length)throw fieldError('procedure_upload_pending','Hay archivos pendientes en esta parte.',409);
          const missing=w.protocol.parts[command.part].steps.filter(d=>protocol.stepMissing(w,command.part,d.id,evidence).length||!['documented','exception_approved'].includes(p.steps[d.id].status)).map(d=>d.id);
          if(missing.length)throw fieldError('procedure_part_incomplete','Faltan procedimientos o evidencia.',409,{steps:missing});
          if(command.safeToTest!==true)throw fieldError('procedure_safe_to_test_required','Confirma que tu parte está terminada y fuera de riesgo para coordinar la prueba.',409);
          p.version+=1;p.completedAt=at;p.safeToTest=true;break;
        }
        case 'record_final_test':{
          requireLead(context);requireCompetence(command);requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
          if(w.safety.phase!=='isolated'||protocol.blockers(w).length||pendingFor(w).length)throw fieldError('procedure_final_test_unsafe','La prueba final no tiene coordinación segura y sincronizada.',409);
          for(const part of protocol.PARTS){const p=w.parts[part];requireVersion(p.version,command.partVersions?.[part],part);if(!p.completedAt||!p.safeToTest)throw fieldError('procedure_both_parts_required','Ambas partes deben estar finalizadas y fuera de riesgo.',409);}
          if(!['enfria','no_enfria','inconcluso','no_se_pudo_verificar'].includes(command.result))throw fieldError('procedure_final_result_required','Registra el resultado observado.',400);
          const note=text(command.note);if(command.result!=='enfria'&&note.length<3)reason(command.note);
          w.safety={...w.safety,revision:w.safety.revision+1,phase:'final_test',finalTest:{author:owner,receivedAt:at,result:command.result,note,partVersions:{...command.partVersions}}};break;
        }
        case 'report_risk':{
          const parts=command.affectedParts;if(!Array.isArray(parts)||!parts.length||parts.some(p=>!protocol.PARTS.includes(p)))throw fieldError('risk_parts_required','Indica las partes afectadas.',400);
          const riskId=docId('RISK',JSON.stringify([owner.userId,stable]));
          w.risks[riskId]={id:riskId,parts:[...new Set(parts)],status:'open',reason:reason(command.reason),author:owner,receivedAt:at,resolution:null};invalidateFinal(w);w.safety.revision+=1;
          mutationResult={riskId};break;
        }
        case 'resolve_risk':{
          if(!input.identity.operations)requireLead(context);requireCompetence(command);requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
          const risk=w.risks[command.riskId];if(!risk||risk.status!=='open')throw fieldError('procedure_risk_not_open','El riesgo no está abierto.',409);
          risk.status='resolved';risk.resolution={author:owner,receivedAt:at,reason:reason(command.reason),competentPerson:reason(command.competentPerson)};
          invalidateFinal(w);w.safety.revision+=1;for(const part of risk.parts){w.parts[part].safeToTest=false;w.parts[part].completedAt=null;w.parts[part].version+=1;}break;
        }
        case 'reopen_for_correction':{
          requireLead(context);requireVersion(stored.version,command.expectedVersion,'la intervención');
          if(review?.status!=='returned'||stored.status!=='completed')throw fieldError('procedure_correction_not_authorized','Oficina debe devolver primero esta revisión.',409);
          auditDetails.reason=reason(command.note);patch.status='in_progress';patch.completedAt=null;
          for(const p of protocol.PARTS)bump(p);
          w.safety={revision:w.safety.revision+1,phase:'initial',isolation:null,finalTest:null};break;
        }
        case 'prepare_media':{
          const p=partState(w,command,input.identity),d=protocol.definitionFor(w,command.part,command.stepId);workPhase(w,command,d);
          if(p.completedAt)throw fieldError('procedure_part_finished','La parte está finalizada.',409);
          const manifest=safeManifest(command,input.identity,input.visitId,input.interventionId);
          if(![...d.views,'supplemental',...(d.measurement?['instrument']:[])].includes(manifest.view))throw fieldError('invalid_procedure_media_view','La vista no corresponde al procedimiento.',400);
          if(manifest.view==='after'&&d.views.includes('before')&&!p.steps[d.id].evidenceIds.some(eid=>evidence.some(e=>e.id===eid&&e.kind==='photo'&&e.view==='before')))throw fieldError('procedure_before_missing','Falta la captura ANTES de este procedimiento; no se puede sustituir con una foto posterior.',409);
          const existing=w.pendingCaptures[manifest.captureId];
          if(existing)throw fieldError('procedure_capture_conflict','Esta captura ya está reservada; utiliza el mismo identificador de solicitud para recuperarla.',409);
          const eid=evidenceId(input.visitId,input.interventionId,owner.userId,manifest.captureId);
          if(evidence.some(e=>e.id===eid))throw fieldError('procedure_capture_already_linked','Esta captura ya está vinculada.',409);
          w.pendingCaptures[manifest.captureId]={captureId:manifest.captureId,ownerUserId:owner.userId,part:command.part,stepId:command.stepId,storagePath:manifest.storagePath,sha256:manifest.sha256,manifest,receivedAt:at,safetyRevision:w.safety.revision};
          mutationResult={evidenceId:eid};break;
        }
        case 'commit_media':{
          const key=id(command.captureId,'captura'),reservation=w.pendingCaptures[key];
          if(!reservation||reservation.ownerUserId!==owner.userId)throw fieldError('procedure_capture_not_reserved','Reserva de captura no disponible.',409);
          const p=w.parts[reservation.part],d=protocol.definitionFor(w,reservation.part,reservation.stepId),m=reservation.manifest;
          if(p.ownerUserId!==owner.userId||p.ownerStaffId!==owner.staffId||p.completedAt)throw fieldError('procedure_capture_locked','La parte no admite esta captura.',409);
          if(w.safety.revision!==reservation.safetyRevision){
            if(command.acknowledgeCoordinationChange!==true)throw fieldError('procedure_media_coordination_changed','La coordinación cambió. El archivo se conserva; confirma su recuperación documental, sin autorizar actividad física.',409);
            auditDetails.mediaRecovery={reason:reason(command.reason),reservedSafetyRevision:reservation.safetyRevision,currentSafetyRevision:w.safety.revision};
          }
          // Linking an already reserved file is documentation, never a safety permission.
          invalidateFinal(w);
          if(!verified||verified.sha256!==m.sha256||verified.contentType!==m.contentType||verified.sizeBytes!==m.sizeBytes||!/^\d+$/.test(String(verified.generation)))throw fieldError('procedure_media_verification_failed','El objeto privado no coincide con la captura reservada.',409);
          const eid=evidenceId(input.visitId,input.interventionId,owner.userId,key),evidenceRef=db.collection('fieldEvidence').doc(eid);
          const existing=await transaction.get(evidenceRef);if(existing.exists)throw fieldError('procedure_evidence_conflict','La evidencia ya existe con otro vínculo.',409);
          const e=fieldFirestoreData({id:eid,fieldAuthorityVersion:1,targetType:'service_procedure',visitId:input.visitId,workOrderId:context.workOrderId,clientId:context.customerId,propertyId:context.propertyId,visitAssetId:state.intervention.visitAssetId,assetId:state.intervention.assetId,interventionId:input.interventionId,
            part:reservation.part,procedureId:reservation.stepId,targetComponent:d.targetComponent||reservation.part,kind:m.kind,view:m.view,storagePath:m.storagePath,contentType:m.contentType,sizeBytes:m.sizeBytes,sha256:m.sha256,generation:String(verified.generation),source:m.source,declaredCapturedAt:m.declaredCapturedAt,
            ...(m.durationSeconds===undefined?{}:{durationSeconds:m.durationSeconds}),createdAt:at,createdByUserId:owner.userId,createdByStaffId:id(owner.staffId,'empleado'),version:1},'procedureEvidence');
          extraWrites.push({ref:evidenceRef,value:e});evidence.push(projectProcedureEvidence(e));p.steps[d.id].evidenceIds.push(eid);
          delete w.pendingCaptures[key];bump(reservation.part);mutationResult={evidenceId:eid};break;
        }
        case 'abandon_capture':{
          if(!input.identity.operations)throw fieldError('permission_denied','Solo oficina puede resolver un pendiente de otro usuario.',403);
          requireVersion(w.safety.revision,command.expectedSafetyRevision,'la coordinación');
          const key=id(command.captureId,'captura'),capture=w.pendingCaptures[key];
          if(!capture)throw fieldError('procedure_capture_not_reserved','No hay reserva pendiente para resolver.',409);
          // No bytes are deleted and the original author/path remain in append-only audit.
          // Missing required views still block completion; office cannot fabricate evidence.
          auditDetails.abandonedCapture=structuredClone(capture);auditDetails.reason=reason(command.reason);
          delete w.pendingCaptures[key];bump(capture.part);invalidateFinal(w);w.safety.revision+=1;break;
        }
        case 'cancel_media':{
          const key=id(command.captureId,'captura'),p=w.pendingCaptures[key];if(!p||p.ownerUserId!==owner.userId)throw fieldError('procedure_capture_not_reserved','Reserva ajena o no disponible.',409);
          auditDetails.discardedCapture=structuredClone(p);auditDetails.reason=reason(command.reason);delete w.pendingCaptures[key];break;
        }
      }
      w.revision+=1;validateProcedureContent(w,evidence);
      if(Buffer.byteLength(JSON.stringify(w))>500000)throw fieldError('procedure_record_limit','El expediente supera el tamaño permitido.',409);
      const update=fieldFirestoreData({...patch,procedureWorkflow:w,version:stored.version+1,updatedAt:at,updatedByUserId:owner.userId,...(owner.staffId?{updatedByStaffId:owner.staffId}:{})},'procedureWorkflowUpdate');
      // All reads, including replay and assignment/review checks, precede the first write.
      transaction.update(ref,update);for(const write of extraWrites)transaction.create(write.ref,write.value);
      await appendAuditInTransaction({transaction,identity:input.identity,visit:context.storedVisit,event:{
        id:eventId,type:`procedure_${command.action}`,entityType:'WorkIntervention',entityId:input.interventionId,visitId:input.visitId,interventionId:input.interventionId,assetId:state.intervention.assetId,workOrderId:context.workOrderId,appointmentId:context.appointmentId,customerId:context.customerId,propertyId:context.propertyId,
        requestId:stable,occurredAt:at,performedByUserId:owner.userId,performedByStaffId:owner.staffId||undefined,performedByName:owner.name,
        before,after:{revision:w.revision,action:command.action,...auditDetails},metadata:{procedureCommandHash:digest,...(mutationResult?{mutationResult}:{})},
      }});
      return bundle({...state,workflow:w,stored:{...stored,...update},evidence},at,false,mutationResult);
    });
  }
  async function authorizeMediaRead(input){
    const state=await read(input),e=state.evidence.find(row=>row.id===input.evidenceId);
    if(!e)throw fieldError('procedure_evidence_not_found','Archivo no disponible en este contexto.',404);
    return e;
  }
  return {read,mutate,authorizeUpload,authorizeMediaRead};
}

module.exports={MEDIA_LIMITS,MIME,createProcedureWorkflowCommands,projectProcedureEvidence,canonicalEvidence,validateProcedureContent,evidenceId};
