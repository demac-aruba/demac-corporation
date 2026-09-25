import { FIELD_ALLOWED_ACTIONS, type FieldAllowedAction } from './field-authority-contract';

export type FieldProcedurePart = 'indoor' | 'outdoor';
export type FieldProcedureTarget = { ownerUserId: string; visitId: string; interventionId: string; assetId: string };
export type FieldPartCommand =
  | { action: 'initialize' }
  | { action: 'claim_part'; part: FieldProcedurePart; expectedPartVersion: number }
  | { action: 'release_part'; part: FieldProcedurePart; expectedPartVersion: number; note: string };
export type FieldPartSummary = {
  id: FieldProcedurePart; label: string; version: number; ownerUserId: string | null;
  ownerStaffId: string | null; ownerName: string | null; completedAt: string | null;
  total: number; documented: number; exceptions: number; pendingFiles: number;
};
/** Presentation of the server response, not another workflow or safety authority. */
export type FieldProcedureSummary = {
  visitId: string; interventionId: string; assetId: string; serverTime: string;
  revision: number | null; protocolName: string | null; parts: FieldPartSummary[];
  allowedActions: FieldAllowedAction[]; interventionStatus: string; replayed: boolean;
};
const states = new Set(['not_started','in_progress','needs_information','documented','exception_requested','exception_approved','exception_rejected']);
const interventionStates = new Set(['planned','confirmed','in_progress','pending_authorization','pending_part','not_performed','declined','cancelled','completed']);
function invalid(): never { throw new Error('La respuesta de procedimientos no coincide con el trabajo autorizado.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 180): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid();
  return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function ownerLabel(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 180) invalid();
  return value; // A missing display name does not invent another employee identity.
}
function counter(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) return invalid(); return value as number; }
function timestamp(value: unknown): string { const result = text(value, 100); if (!Number.isFinite(Date.parse(result))) return invalid(); return result; }
export function assertFieldProcedureTarget(target: FieldProcedureTarget) {
  if (!target || typeof target !== 'object') invalid();
  for (const value of [target.ownerUserId, target.visitId, target.interventionId, target.assetId]) {
    if (typeof value !== 'string' || !/^[-A-Za-z0-9_.:]{1,180}$/.test(value) || value.includes('..')) invalid();
  }
}
export function parseFieldProcedureSummary(value: unknown, target: FieldProcedureTarget): FieldProcedureSummary {
  assertFieldProcedureTarget(target);
  const raw = object(value);
  if (raw.success !== true || raw.version !== 1 || raw.visitId !== target.visitId
      || raw.interventionId !== target.interventionId || raw.assetId !== target.assetId
      || typeof raw.replayed !== 'boolean' || !interventionStates.has(String(raw.interventionStatus))) invalid();
  if (!Array.isArray(raw.allowedActions) || new Set(raw.allowedActions).size !== raw.allowedActions.length
      || raw.allowedActions.some(a => !FIELD_ALLOWED_ACTIONS.includes(a))) invalid();
  const result: FieldProcedureSummary = {
    visitId: target.visitId, interventionId: target.interventionId, assetId: target.assetId,
    serverTime: timestamp(raw.serverTime), allowedActions: [...raw.allowedActions] as FieldAllowedAction[],
    interventionStatus: String(raw.interventionStatus), replayed: raw.replayed,
    revision: null, protocolName: null, parts: [],
  };
  if (raw.workflow === null) return result;
  const workflow = object(raw.workflow), protocol = object(workflow.protocol);
  if (workflow.schemaVersion !== 1 || protocol.id !== 'demac-standard-service-v1' || protocol.version !== 1) invalid();
  const definitions = object(protocol.parts), parts = object(workflow.parts), pending = object(workflow.pendingCaptures);
  if (Object.keys(pending).length > 60) invalid();
  if (Object.keys(parts).sort().join() !== 'indoor,outdoor' || Object.keys(definitions).sort().join() !== 'indoor,outdoor') invalid();
  result.revision = counter(workflow.revision); result.protocolName = text(protocol.name);
  for (const [id, prefix, count] of [['indoor','I',14], ['outdoor','O',9]] as const) {
    const definition = object(definitions[id]), state = object(parts[id]), steps = object(state.steps);
    if (!Array.isArray(definition.steps) || definition.steps.length !== count || Object.keys(steps).length !== count) invalid();
    let documented = 0, exceptions = 0;
    definition.steps.forEach((rawStep, index) => {
      const key = `${prefix}${String(index+1).padStart(2,'0')}`, d = object(rawStep), step = object(steps[key]);
      if (d.id !== key || !states.has(String(step.status))) invalid();
      if (step.status === 'documented') documented += 1;
      if (String(step.status).startsWith('exception_')) exceptions += 1;
    });
    const ownerUserId = nullableText(state.ownerUserId), ownerStaffId = nullableText(state.ownerStaffId), ownerName = ownerLabel(state.ownerName);
    if ((ownerUserId === null) !== (ownerStaffId === null) || (ownerUserId === null) !== (ownerName === null)) invalid();
    const completedAt = state.completedAt === null ? null : timestamp(state.completedAt);
    if (completedAt && !ownerUserId) invalid();
    let pendingFiles = 0;
    for (const [captureId, capture] of Object.entries(pending)) {
      const c = object(capture);
      if (c.captureId !== captureId || !['indoor','outdoor'].includes(String(c.part))) invalid();
      if (c.part === id) { if (!Object.hasOwn(steps, String(c.stepId))) invalid(); pendingFiles += 1; }
    }
    result.parts.push({ id, label: text(definition.label), version: counter(state.version), ownerUserId,
      ownerStaffId, ownerName, completedAt, total: count, documented, exceptions, pendingFiles });
  }
  return result;
}
