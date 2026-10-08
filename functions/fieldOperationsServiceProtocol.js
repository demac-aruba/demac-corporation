'use strict';

const { isDeepStrictEqual } = require('node:util');
const { fieldError } = require('./fieldOperationsAuthorityCore');

const PROTOCOL_ID = 'demac-standard-service-v1';
const PARTS = Object.freeze(['indoor', 'outdoor']);
const STATUSES = new Set(['not_started', 'in_progress', 'needs_information', 'documented', 'exception_requested', 'exception_approved', 'exception_rejected']);
const DISPOSITIONS = new Set(['not_documented', 'not_applicable', 'not_performed']);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const counter = (v) => Number.isSafeInteger(v) && v >= 0;
const timestamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const shortText = (v, n = 2000) => typeof v === 'string' && v.length <= n;
const authorValid = (v) => isObject(v) && shortText(v.userId, 180) && !!v.userId && (v.staffId === null || shortText(v.staffId, 180)) && shortText(v.name, 180);
const fail = (message) => { throw fieldError('invalid_procedure_workflow', message, 409); };
const step = (id, title, instruction, views, options = [], extra = {}) => ({ id, title, instruction, views, options, stage: 'isolated', ...extra });

// The numbered list is the owner's Standard Service protocol, not a generic checklist,
// a Deep Cleaning protocol, an electrical qualification or a diagnosis engine.
const PROTOCOL = {
  id: PROTOCOL_ID, version: 1, name: 'Standard Service',
  disclaimer: 'Documentar no certifica que el equipo funcione bien. La aplicación no sustituye capacitación, evaluación física, aislamiento ni instrucciones del fabricante.',
  parts: {
    indoor: { label: 'Evaporadora · Indoor', steps: [
      step('I01', 'Vista amplia inicial', 'Fotografiar el aire y el área antes de intervenir.', ['before'], [], { stage: 'initial' }),
      step('I02', 'Verificar flapper', 'Registrar funcionamiento, falla o imposibilidad de verificar. El video es opcional.', [], ['funciona', 'presenta_falla', 'no_se_pudo_verificar'], { stage: 'initial' }),
      step('I03', 'Verificar enfriamiento inicial', 'Registrar lo observado. Adjuntar lectura y foto del instrumento cuando se mida; no inventar valores.', [], ['enfria', 'no_enfria', 'inconcluso', 'no_se_pudo_verificar'], { stage: 'initial', measurement: true }),
      step('I04', 'Carita desmontada y suciedad inicial', 'Tras el aislamiento requerido, documentar el estado antes de limpiar.', ['before']),
      step('I05', 'Protección del área', 'Fotografiar la protección de pared y área antes del lavado.', ['before']),
      step('I06', 'Blower antes del servicio', 'Fotografiar el blower y la suciedad inicial como ANTES.', ['before']),
      step('I07', 'Protección de electrónica y display', 'Documentar la protección después del aislamiento y por personal habilitado según el fabricante.', ['before'], [], { competent: true }),
      step('I08', 'Aplicación de espuma', 'Fotografiar el estado durante la limpieza; el formulario no prescribe químicos.', ['during']),
      step('I09', 'Vista general después del servicio', 'Fotografiar el resultado de limpieza como DESPUÉS, conservando el antes.', ['after']),
      step('I10', 'Coil después del servicio', 'Fotografiar el serpentín limpio y su estado observable.', ['after']),
      step('I11', 'Blower después del servicio', 'Fotografiar el resultado posterior, distinguible de I06.', ['after']),
      step('I12', 'Bandeja de desagüe', 'Fotografiar la bandeja después del servicio y documentar limitaciones.', ['after']),
      step('I13', 'Unidad armada', 'Fotografiar el aire después del armado.', ['after']),
      step('I14', 'Área limpia y ordenada', 'Fotografiar pared, área y orden final.', ['after']),
    ] },
    outdoor: { label: 'Condensadora · Outdoor', steps: [
      step('O01', 'Vista amplia inicial', 'Fotografiar la unidad exterior y su entorno antes de intervenir.', ['before'], [], { stage: 'initial' }),
      step('O02', 'Presión y funcionamiento inicial', 'Registrar presión realmente medida y foto legible del instrumento por personal competente. Una presión aislada no determina una recarga.', ['instrument'], ['enfria', 'no_enfria', 'inconcluso', 'no_se_pudo_verificar'], { stage: 'initial', measurement: true, competent: true }),
      step('O03', 'Apagado, aislamiento e inspección del switch', 'Documentar verificación segura; las vistas interior/exterior solo se toman por persona habilitada y cuando sea seguro. Bajar el switch no demuestra ausencia de tensión.', ['exterior', 'interior'], ['buen_estado', 'desgaste_medio', 'desgaste_avanzado', 'alto_riesgo'], { competent: true, recommendation: 'switch' }),
      step('O04', 'Ventilador y base', 'Fotografiar condición, oxidación o deterioro observable sin atribuir causas no verificadas.', ['condition']),
      step('O05', 'Coil outdoor antes/después', 'Conservar fotos separadas ANTES y DESPUÉS del lavado dentro del mismo procedimiento.', ['before', 'after']),
      step('O06', 'Bracket/soporte', 'Clasificar buen estado, deteriorado o alto riesgo. La negativa del cliente no hace seguro un soporte.', ['condition'], ['buen_estado', 'deteriorado', 'alto_riesgo'], { recommendation: 'bracket' }),
      step('O07', 'Armaflex', 'Documentar estado y recomendación sin inventar ahorro ni fallas.', ['condition'], ['buen_estado', 'deteriorado', 'totalmente_deteriorado'], { recommendation: 'armaflex' }),
      step('O08', 'Kabelgoot / cubierta del lineset', 'Documentar lo observado; una recomendación estética no es un diagnóstico confirmado.', ['condition'], ['buen_estado', 'deteriorado', 'totalmente_deteriorado'], { recommendation: 'kabelgoot' }),
      step('O09', 'Carita y filtros del indoor lavados afuera', 'Documentar ANTES y DESPUÉS. Los componentes pertenecen a la evaporadora del mismo aire, aunque los lave la persona de outdoor.', ['before', 'after'], [], { targetComponent: 'indoor' }),
    ] },
  },
};

function protocolForService(service) {
  const definition = service?.fieldExecutionDefinition;
  if (!definition || definition.procedureProtocolId === undefined) return null;
  if (definition.version !== 1 || definition.procedureProtocolId !== PROTOCOL_ID || service.active === false
      || ['product','producto'].includes(String(service.itemType || '').toLowerCase())) {
    throw fieldError('unsupported_procedure_protocol', 'El catálogo no contiene un protocolo de Standard Service admitido.', 409);
  }
  return structuredClone(PROTOCOL);
}

function emptyStep() {
  return { status: 'not_started', result: null, note: '', measurement: null, evidenceIds: [], author: null, receivedAt: null, exception: null };
}
function initialWorkflow(definition) {
  if (!definition) return null;
  if (!isDeepStrictEqual(definition, PROTOCOL)) fail('La plantilla de procedimientos no coincide con su versión autorizada.');
  return {
    schemaVersion: 1, revision: 0, protocol: structuredClone(PROTOCOL),
    parts: Object.fromEntries(PARTS.map((part) => [part, {
      version: 0, ownerUserId: null, ownerStaffId: null, ownerName: null, completedAt: null, safeToTest: false,
      steps: Object.fromEntries(PROTOCOL.parts[part].steps.map((d) => [d.id, emptyStep()])),
    }])),
    safety: { revision: 0, phase: 'initial', isolation: null, finalTest: null }, risks: {}, pendingCaptures: {},
  };
}
function definitionFor(workflow, part, stepId) {
  if (!PARTS.includes(part)) throw fieldError('invalid_procedure_part', 'Selecciona indoor u outdoor.', 400);
  const definition = workflow.protocol.parts[part].steps.find((s) => s.id === stepId);
  if (!definition) throw fieldError('invalid_procedure_step', 'El procedimiento no pertenece a esta parte.', 400);
  return definition;
}

function validateWorkflow(value) {
  if (!isObject(value) || value.schemaVersion !== 1 || !counter(value.revision) || !isDeepStrictEqual(value.protocol, PROTOCOL)
      || !isObject(value.parts) || !isObject(value.safety) || !counter(value.safety.revision)
      || !['initial','isolated','final_test'].includes(value.safety.phase) || !isObject(value.risks) || !isObject(value.pendingCaptures)) fail('Protocolo o estructura persistida no válida.');
  if (Object.keys(value.parts).sort().join() !== [...PARTS].sort().join()) fail('Partes inesperadas.');
  for (const part of PARTS) {
    const p = value.parts[part];
    if (!isObject(p) || !counter(p.version) || !isObject(p.steps) || typeof p.safeToTest !== 'boolean'
        || !(p.completedAt === null || timestamp(p.completedAt)) || (p.safeToTest && !p.completedAt)) fail('Estado de parte inválido.');
    if (p.ownerUserId === null) {
      if (p.ownerStaffId !== null || p.ownerName !== null || p.completedAt) fail('Autoría de parte inválida.');
    } else if (!shortText(p.ownerUserId,180) || !p.ownerUserId || !shortText(p.ownerStaffId,180) || !p.ownerStaffId || !shortText(p.ownerName,180)) fail('La parte requiere una cuenta y empleado reales.');
    if (Object.keys(p.steps).sort().join() !== PROTOCOL.parts[part].steps.map(s=>s.id).sort().join()) fail('La lista numerada fue alterada.');
    for (const d of PROTOCOL.parts[part].steps) {
      const s = p.steps[d.id];
      if (!isObject(s) || !STATUSES.has(s.status) || !shortText(s.note) || !(s.result === null || d.options.includes(s.result))
          || !Array.isArray(s.evidenceIds) || s.evidenceIds.length > 40 || s.evidenceIds.some(id=>!shortText(id,180)||!id) || new Set(s.evidenceIds).size !== s.evidenceIds.length
          || !(s.author === null || authorValid(s.author)) || !(s.receivedAt === null || timestamp(s.receivedAt))
          || (s.status !== 'not_started' && (!s.author || !s.receivedAt))) fail('Resultado persistido inválido.');
      if (s.measurement !== null && (!isObject(s.measurement) || !Number.isFinite(s.measurement.value) || !shortText(s.measurement.unit,20) || !s.measurement.unit || !d.measurement)) fail('Medición persistida inválida.');
      if (s.competenceConfirmed !== undefined && typeof s.competenceConfirmed !== 'boolean') fail('Declaración de competencia inválida.');
      if (s.customerDecision !== undefined && s.customerDecision !== null && !['accepted','declined','pending'].includes(s.customerDecision)) fail('Decisión del cliente inválida.');
      if (s.status.startsWith('exception_') && s.exception===null)fail('Falta la excepción del estado declarado.');
      if (s.status==='exception_approved' && s.exception?.reviewStatus!=='approved')fail('Excepción aún no aprobada.');
      if (s.status==='documented' && s.exception!==null)fail('Una excepción no es ejecución documentada.');
      if (s.exception !== null) {
        const e = s.exception;
        if (!isObject(e) || !shortText(e.reason) || e.reason.trim().length < 3 || !authorValid(e.author) || !timestamp(e.receivedAt)
            || !['pending','approved','rejected'].includes(e.reviewStatus)) fail('Excepción persistida inválida.');
        if (e.reviewStatus !== 'pending' && (!authorValid(e.reviewer) || !timestamp(e.reviewedAt) || !shortText(e.reviewReason) || e.reviewReason.trim().length < 3)) fail('Revisión de excepción inválida.');
        if (e.reviewStatus === 'approved' && !DISPOSITIONS.has(e.disposition)) fail('Disposición de excepción inválida.');
      }
    }
  }
  const safety = value.safety;
  if (safety.phase !== 'initial' && (!authorValid(safety.isolation?.author) || !timestamp(safety.isolation?.receivedAt) || !shortText(safety.isolation?.note))) fail('Aislamiento no documentado.');
  if(safety.phase==='final_test'&&safety.finalTest===null)fail('Falta la prueba final confirmada.');
  if (safety.finalTest !== null) {
    const f = safety.finalTest;
    if (safety.phase !== 'final_test' || !authorValid(f.author) || !timestamp(f.receivedAt) || !shortText(f.note)
        || !['enfria','no_enfria','inconcluso','no_se_pudo_verificar'].includes(f.result) || !isObject(f.partVersions)
        || PARTS.some(p=>!counter(f.partVersions[p]))) fail('Prueba final inválida.');
  }
  if (Object.keys(value.risks).length > 50 || Object.keys(value.pendingCaptures).length > 60) fail('El expediente supera sus límites.');
  for (const [id,r] of Object.entries(value.risks)) {
    if (!isObject(r) || r.id !== id || !Array.isArray(r.parts) || !r.parts.length || r.parts.some(p=>!PARTS.includes(p))
        || !['open','resolved'].includes(r.status) || !shortText(r.reason) || !r.reason || !authorValid(r.author) || !timestamp(r.receivedAt)) fail('Riesgo persistido inválido.');
    if (r.status === 'resolved' && (!authorValid(r.resolution?.author) || !timestamp(r.resolution?.receivedAt)
        || !shortText(r.resolution?.reason) || !r.resolution.reason || !shortText(r.resolution?.competentPerson,180) || !r.resolution.competentPerson)) fail('Resolución de riesgo inválida.');
    if (r.status === 'open' && r.resolution !== null) fail('Un riesgo abierto no tiene resolución.');
  }
  // Full media manifests are validated by the private-media boundary, not trusted here.
  for (const [id,p] of Object.entries(value.pendingCaptures)) if (!isObject(p) || p.captureId !== id || !shortText(p.ownerUserId,180) || !p.ownerUserId
      || !PARTS.includes(p.part) || !value.parts[p.part].steps[p.stepId] || !shortText(p.storagePath,1000) || !/^[a-f0-9]{64}$/.test(p.sha256)
      || !timestamp(p.receivedAt) || !isObject(p.manifest)) fail('Reserva de evidencia inválida.');
  return structuredClone(value);
}

function blockers(workflow, part) {
  return Object.values(workflow.risks).filter(r=>r.status==='open' && (!part || r.parts.includes(part)));
}
function stepMissing(workflow, part, stepId, evidence) {
  const d = definitionFor(workflow,part,stepId), s = workflow.parts[part].steps[stepId];
  if (s.exception?.reviewStatus === 'approved' && ['not_documented','not_applicable'].includes(s.exception.disposition)) return [];
  const missing=[];
  if (s.exception && s.exception.reviewStatus !== 'rejected') missing.push(s.exception.disposition==='not_performed'?'procedure_not_performed':'exception_review');
  if (!s.author || !s.receivedAt) missing.push('result_not_recorded');
  if (d.options.length && !d.options.includes(s.result)) missing.push('result');
  if (['inconcluso','no_se_pudo_verificar'].includes(s.result) && s.note.trim().length < 3) missing.push('explanation');
  if (d.competent && s.competenceConfirmed !== true) missing.push('competence_confirmation');
  if (stepId==='O02' && !s.measurement) missing.push('measured_pressure');
  if (s.measurement && stepId==='I03' && !s.evidenceIds.some(id=>evidence.some(e=>e.id===id && e.kind==='photo' && e.view==='instrument'))) missing.push('photo:instrument');
  const refs = s.evidenceIds.map(id=>evidence.find(e=>e.id===id));
  if (refs.some(e=>!e || e.part!==part || e.procedureId!==stepId)) missing.push('evidence_link');
  for (const view of d.views) if (!refs.some(e=>e?.kind==='photo' && e.view===view)) missing.push(`photo:${view}`);
  if (d.recommendation && s.result && s.result!=='buen_estado') {
    if (!['accepted','declined','pending'].includes(s.customerDecision)) missing.push('customer_decision');
    if (['accepted','declined'].includes(s.customerDecision) && !s.decisionPerson?.trim()) missing.push('decision_person');
  }
  return [...new Set(missing)];
}
function completion(workflow, evidence=[]) {
  const w=validateWorkflow(workflow),missing=[],exceptions=[];
  for (const part of PARTS) {
    for (const d of w.protocol.parts[part].steps) {
      const s=w.parts[part].steps[d.id], fields=stepMissing(w,part,d.id,evidence);
      if (!['documented','exception_approved'].includes(s.status)) fields.push('step_not_finalized');
      if (fields.length) missing.push({part,stepId:d.id,fields:[...new Set(fields)]});
      if(s.exception?.reviewStatus==='approved') exceptions.push({part,stepId:d.id,disposition:s.exception.disposition,reason:s.exception.reason});
    }
    if (!w.parts[part].completedAt || !w.parts[part].safeToTest) missing.push({part,fields:['part_not_finished_or_safe']});
  }
  if (Object.keys(w.pendingCaptures).length) missing.push({fields:['files_pending']});
  if (blockers(w).length) missing.push({fields:['high_risk_unresolved']});
  if (!w.safety.finalTest || PARTS.some(p=>w.safety.finalTest.partVersions[p]!==w.parts[p].version)) missing.push({fields:['coordinated_final_test']});
  return {complete:missing.length===0,missing,exceptions};
}

module.exports = { PROTOCOL_ID, PARTS, DISPOSITIONS, protocolForService, initialWorkflow, definitionFor, validateWorkflow, blockers, stepMissing, completion };
