import {
  parseFieldProcedureSummary, type FieldPartCommand, type FieldPartSummary,
  type FieldProcedurePart, type FieldProcedureSummary, type FieldProcedureTarget,
} from './field-procedure-contract';

export type ProcedureMediaKind = 'photo' | 'audio' | 'video';
export type ProcedureMediaSource = 'camera' | 'gallery' | 'recorder' | 'attachment';
export type ProcedureStepState = 'not_started' | 'in_progress' | 'needs_information' | 'documented'
  | 'exception_requested' | 'exception_approved' | 'exception_rejected';
export type ProcedureActor = { userId: string; staffId: string | null; name: string };
export type ProcedureMeasurement = { value: number; unit: string };
export type ProcedureStep = {
  id: string; title: string; instruction: string; views: string[]; options: string[];
  stage: 'initial' | 'isolated'; measurement: boolean; competent: boolean; recommendation: string | null;
  status: ProcedureStepState; result: string | null; note: string; evidenceIds: string[];
  recordedMeasurement: ProcedureMeasurement | null; author: ProcedureActor | null; receivedAt: string | null;
  customerDecision: 'accepted' | 'declined' | 'pending' | null; decisionPerson: string;
  exception: { reason: string; reviewStatus: 'pending' | 'approved' | 'rejected'; disposition: string | null } | null;
  missing: string[];
};
export type ProcedureEvidence = {
  id: string; captureId: string; part: FieldProcedurePart; procedureId: string; kind: ProcedureMediaKind; view: string;
  contentType: string; sizeBytes: number; sha256: string; source: ProcedureMediaSource;
  declaredCapturedAt: string | null; receivedAt: string; createdBy: string; generation: string;
};
export type ProcedureReservation = {
  captureId: string; ownerUserId: string; part: FieldProcedurePart; stepId: string; safetyRevision: number;
  sha256: string;
};
export type ProcedureRisk = {
  id: string; parts: FieldProcedurePart[]; status: 'open' | 'resolved'; reason: string;
  author: ProcedureActor; receivedAt: string; resolution: { reason: string; competentPerson: string } | null;
};
export type FieldProcedureWorkspace = FieldProcedureSummary & {
  interventionVersion: number;
  procedureParts: Array<FieldPartSummary & { safeToTest: boolean; steps: ProcedureStep[] }>;
  safety: { revision: number; phase: 'initial' | 'isolated' | 'final_test'; finalResult: string | null } | null;
  risks: ProcedureRisk[]; pendingCaptures: ProcedureReservation[]; evidence: ProcedureEvidence[];
  readiness: { complete: boolean; missing: Array<{ part: FieldProcedurePart | null; stepId: string | null; fields: string[] }> };
  mediaLimits: Record<ProcedureMediaKind, { bytes: number }>;
  mutationResult: { evidenceId?: string; riskId?: string } | null;
};

type PartVersion = { part: FieldProcedurePart; expectedPartVersion: number };
type StepVersion = PartVersion & { stepId: string; expectedSafetyRevision: number };
export type PrepareProcedureMedia = StepVersion & {
  action: 'prepare_media'; captureId: string; kind: ProcedureMediaKind; view: string; contentType: string;
  sizeBytes: number; sha256: string; source: ProcedureMediaSource; declaredCapturedAt: string | null; durationSeconds?: number;
};
export type FieldProcedureCommand = FieldPartCommand
  | (StepVersion & { action: 'save_step'; result?: string | null; note: string; measurement?: ProcedureMeasurement | null;
      complete: boolean; competenceConfirmed?: boolean; customerDecision?: 'accepted' | 'declined' | 'pending' | null; decisionPerson?: string })
  | (StepVersion & { action: 'request_exception'; reason: string })
  | (PartVersion & { action: 'recover_part'; note: string })
  | (PartVersion & { action: 'review_exception'; stepId: string; decision: 'approve' | 'reject'; reason: string;
      disposition?: 'not_documented' | 'not_applicable' | 'not_performed' })
  | { action: 'confirm_isolation'; expectedSafetyRevision: number; competenceConfirmed: boolean; note: string }
  | (PartVersion & { action: 'finish_part'; expectedSafetyRevision: number; safeToTest: boolean })
  | { action: 'record_final_test'; expectedSafetyRevision: number; partVersions: Record<FieldProcedurePart, number>;
      competenceConfirmed: boolean; result: string; note: string }
  | { action: 'report_risk'; affectedParts: FieldProcedurePart[]; reason: string }
  | { action: 'resolve_risk'; riskId: string; expectedSafetyRevision: number; reason: string; competentPerson: string; competenceConfirmed: boolean }
  | { action: 'reopen_for_correction'; expectedVersion: number; note: string }
  | PrepareProcedureMedia
  | { action: 'commit_media'; captureId: string; acknowledgeCoordinationChange?: boolean; reason?: string }
  | { action: 'cancel_media'; captureId: string; reason: string }
  | { action: 'abandon_capture'; captureId: string; expectedSafetyRevision: number; reason: string };

export const PROCEDURE_MEDIA_TYPES: Readonly<Record<ProcedureMediaKind, readonly string[]>> = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'],
  video: ['video/mp4', 'video/webm'],
};
const parts = ['indoor', 'outdoor'] as const;
function fail(): never { throw new Error('Expediente de procedimientos inválido o de otro contexto.'); }
function object(v: unknown): Record<string, unknown> { return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(); }
function string(v: unknown, max = 2000): string { return typeof v === 'string' && v.length <= max ? v : fail(); }
function id(v: unknown): string { const s = string(v, 180); return /^[-A-Za-z0-9_.:]+$/.test(s) && !s.includes('..') && s !== '.' ? s : fail(); }
function count(v: unknown): number { return Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : fail(); }
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : fail(); }
function strings(v: unknown, max = 60): string[] { return Array.isArray(v) && v.length <= max ? v.map(x => string(x, 200)) : fail(); }
function time(v: unknown): string { const s = string(v, 100); return Number.isFinite(Date.parse(s)) ? s : fail(); }
function part(v: unknown): FieldProcedurePart { return parts.includes(v as FieldProcedurePart) ? v as FieldProcedurePart : fail(); }
function kind(v: unknown): ProcedureMediaKind { return ['photo','audio','video'].includes(String(v)) ? v as ProcedureMediaKind : fail(); }
function actor(v: unknown): ProcedureActor { const a = object(v); return {userId:id(a.userId),staffId:a.staffId === null ? null : id(a.staffId),name:string(a.name,180)}; }
function choice<const T extends string>(v: unknown, values: readonly T[]): T { return values.includes(v as T) ? v as T : fail(); }

/** Defensive read projection only. Completion, safety, ownership and prices remain server decisions. */
export function parseFieldProcedureWorkspace(value: unknown, target: FieldProcedureTarget): FieldProcedureWorkspace {
  const summary = parseFieldProcedureSummary(value, target), raw = object(value), limits = object(raw.mediaLimits), readiness = object(raw.readiness);
  if (!Array.isArray(raw.evidence) || raw.evidence.length > 920 || !Array.isArray(readiness.missing) || readiness.missing.length > 200) fail();
  const result: FieldProcedureWorkspace = {
    ...summary, interventionVersion:count(raw.interventionVersion), procedureParts:[], safety:null, risks:[], pendingCaptures:[], evidence:[],
    readiness:{complete:bool(readiness.complete),missing:readiness.missing.map(item => { const m = object(item); return {
      part:m.part == null ? null : part(m.part),stepId:m.stepId == null ? null : id(m.stepId),fields:strings(m.fields),
    }; })},
    mediaLimits:Object.fromEntries(['photo','audio','video'].map(k => { const bytes = count(object(limits[k]).bytes); if (!bytes || bytes > 20*1024*1024) fail(); return [k,{bytes}]; })) as FieldProcedureWorkspace['mediaLimits'],
    mutationResult:null,
  };
  if (raw.mutationResult != null) {
    const m = object(raw.mutationResult); result.mutationResult = {
      ...(m.evidenceId === undefined ? {} : {evidenceId:id(m.evidenceId)}), ...(m.riskId === undefined ? {} : {riskId:id(m.riskId)}),
    };
  }
  if (raw.workflow === null) { if (raw.evidence.length || result.readiness.complete) fail(); return result; }
  const w = object(raw.workflow), protocol = object(w.protocol), definitions = object(protocol.parts), states = object(w.parts), stepReadiness = object(raw.stepReadiness);
  const safety = object(w.safety);
  result.safety = {revision:count(safety.revision),phase:choice(safety.phase,['initial','isolated','final_test']),
    finalResult:safety.finalTest === null ? null : choice(object(safety.finalTest).result,['enfria','no_enfria','inconcluso','no_se_pudo_verificar'])};
  for (const p of summary.parts) {
    const state = object(states[p.id]), steps = object(state.steps), missing = object(stepReadiness[p.id]);
    const rawDefinitions = object(definitions[p.id]).steps as unknown[];
    result.procedureParts.push({...p,safeToTest:bool(state.safeToTest),steps:rawDefinitions.map(rawDefinition => {
      const d = object(rawDefinition), key = id(d.id), s = object(steps[key]);
      const options = strings(d.options), views = strings(d.views);
      if (s.result !== null && !options.includes(String(s.result))) fail();
      const measurement = s.measurement === null ? null : object(s.measurement);
      if (measurement && (typeof measurement.value !== 'number' || !Number.isFinite(measurement.value))) fail();
      const ex = s.exception === null ? null : object(s.exception);
      return {id:key,title:string(d.title,180),instruction:string(d.instruction),views,options,stage:choice(d.stage,['initial','isolated']),
        measurement:d.measurement === true,competent:d.competent === true,recommendation:d.recommendation == null ? null : string(d.recommendation,80),
        status:s.status as ProcedureStepState,result:s.result === null ? null : string(s.result,100),note:string(s.note),
        recordedMeasurement:measurement ? {value:measurement.value as number,unit:string(measurement.unit,20)} : null,
        evidenceIds:strings(s.evidenceIds,40).map(id),author:s.author === null ? null : actor(s.author),receivedAt:s.receivedAt === null ? null : time(s.receivedAt),
        customerDecision:s.customerDecision == null ? null : choice(s.customerDecision,['accepted','declined','pending']),decisionPerson:s.decisionPerson == null ? '' : string(s.decisionPerson,180),
        exception:ex ? {reason:string(ex.reason),reviewStatus:choice(ex.reviewStatus,['pending','approved','rejected']),disposition:ex.disposition == null ? null : choice(ex.disposition,['not_documented','not_applicable','not_performed'])} : null,
        missing:strings(missing[key]),
      };
    })});
  }
  const seen = new Set<string>();
  result.evidence = raw.evidence.map(item => {
    const e = object(item), mediaKind = kind(e.kind), evidenceId = id(e.id), mediaPart = part(e.part), stepId = id(e.procedureId);
    if (e.visitId !== target.visitId || e.interventionId !== target.interventionId || e.assetId !== target.assetId || seen.has(evidenceId)) fail();
    seen.add(evidenceId);
    const step = result.procedureParts.find(p => p.id === mediaPart)?.steps.find(s => s.id === stepId);
    if (!step || !step.evidenceIds.includes(evidenceId)) fail();
    const contentType = string(e.contentType,80), sizeBytes = count(e.sizeBytes), sha256 = string(e.sha256,64), generation = string(e.generation,40);
    if (!PROCEDURE_MEDIA_TYPES[mediaKind].includes(contentType) || !sizeBytes || sizeBytes > result.mediaLimits[mediaKind].bytes || !/^[a-f0-9]{64}$/.test(sha256) || !/^\d+$/.test(generation)) fail();
    const creator = id(e.createdBy), path = string(e.storagePath,1000), prefix = `field-evidence/${target.visitId}/procedures/${target.interventionId}/${creator}/`;
    if (!path.startsWith(prefix)) fail();
    const captureId = id(path.slice(prefix.length));
    return {id:evidenceId,captureId,part:mediaPart,procedureId:stepId,kind:mediaKind,view:string(e.view,40),contentType,sizeBytes,sha256,generation,
      source:choice(e.source,['camera','gallery','recorder','attachment']),declaredCapturedAt:e.declaredCapturedAt === null ? null : time(e.declaredCapturedAt),receivedAt:time(e.receivedAt),createdBy:id(e.createdBy)};
  });
  for (const p of result.procedureParts) for (const s of p.steps) if (s.evidenceIds.some(e => !seen.has(e))) fail();
  result.pendingCaptures = Object.entries(object(w.pendingCaptures)).map(([key,item]) => {
    const r = object(item); if (key !== r.captureId) fail();
    const p = part(r.part), stepId = id(r.stepId);
    if (!result.procedureParts.find(x => x.id === p)?.steps.some(s => s.id === stepId)) fail();
    return {captureId:id(key),ownerUserId:id(r.ownerUserId),part:p,stepId,safetyRevision:count(r.safetyRevision),sha256:string(r.sha256,64)};
  });
  result.risks = Object.entries(object(w.risks)).map(([key,item]) => {
    const r = object(item); if (key !== r.id || !Array.isArray(r.parts) || !r.parts.length || r.parts.length > 2) fail();
    const resolution = r.resolution === null ? null : object(r.resolution);
    return {id:id(key),parts:r.parts.map(part),status:choice(r.status,['open','resolved']),reason:string(r.reason),author:actor(r.author),receivedAt:time(r.receivedAt),
      resolution:resolution ? {reason:string(resolution.reason),competentPerson:string(resolution.competentPerson)} : null};
  });
  return result;
}
