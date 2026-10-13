import type { ChargeLineInput, ChargeRecord } from './appointment-charges';

// A private form recovery copy, never a financial record or a reusable edit lease.
const PREFIX = 'demac.erp-next.charge-recovery.v1:';
const MAX_CHARS = 1_000_000;
export type PendingChargeOperation = { action: string; data: Record<string, unknown> };
export type ChargeRecovery = {
  schema: 1; userId: string; appointmentId: string; savedAt: number;
  draft: { lines: ChargeLineInput[]; note: string; version: number; baseline: string } | null;
  pending: PendingChargeOperation | null;
};
const key = (userId: string, appointmentId: string) => PREFIX + encodeURIComponent(userId) + ':' + encodeURIComponent(appointmentId);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
};
export function chargeRecoveryBaseline(record: ChargeRecord) {
  // Acquiring a new lease advances version without changing these financial values.
  const { version: _version, ...financial } = record.state || { schemaVersion: 1, version: 0,
    originalEstimate: null, estimate: null, final: null, receivedCents: 0, paymentCount: 0 };
  return canonical({ financial, payments: [...record.payments].sort((a,b) => a.id.localeCompare(b.id)),
    candidate: record.candidateEvidence?.fingerprint || '', blocker: record.blocker, status: record.appointmentStatus });
}
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
function validLine(value: unknown): value is ChargeLineInput {
  if (!value || typeof value !== 'object') return false;
  const line = value as ChargeLineInput;
  return text(line.id, 180) && Boolean(line.id) && text(line.label, 700)
    && (typeof line.quantity === 'number' ? Number.isFinite(line.quantity) : text(line.quantity, 40))
    && ['workLineId','presetId','serviceId'].every(k => (line as Record<string,unknown>)[k] === undefined || text((line as Record<string,unknown>)[k], 180))
    && [line.btu,line.unitPrice].every(v => v == null || (typeof v === 'number' ? Number.isFinite(v) : text(v, 40)))
    && (line.reason === undefined || text(line.reason, 1000));
}
export function decodeChargeRecovery(raw: string | null, userId: string, appointmentId: string): ChargeRecovery | null {
  if (!raw) return null;
  if (raw.length > MAX_CHARS) throw Error('El borrador guardado excede el tamaño permitido.');
  const value = JSON.parse(raw) as ChargeRecovery;
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'draft') || !Object.hasOwn(value, 'pending') || value.schema !== 1 || value.userId !== userId || value.appointmentId !== appointmentId || !Number.isFinite(value.savedAt)) throw Error('No se pudo validar el borrador guardado.');
  const draft = value.draft;
  if (draft && (!Array.isArray(draft.lines) || draft.lines.length > 60 || !draft.lines.every(validLine)
    || !text(draft.note, 1000) || !Number.isSafeInteger(draft.version) || draft.version < 0 || !text(draft.baseline, MAX_CHARS))) throw Error('No se pudo validar el borrador guardado.');
  const request = value.pending;
  if (request && (!['record_appointment_payment','void_appointment_payment','finalize_appointment_charges'].includes(request.action)
    || !request.data || Number(request.data.expectedVersion) < 0 || request.data.appointmentId !== appointmentId || !Number.isSafeInteger(request.data.expectedVersion)
    || !['requestId','editSessionId','editToken'].every(k => text(request.data[k], 200) && Boolean(request.data[k])))) throw Error('No se pudo validar la operación pendiente.');
  if (!draft && !request) return null;
  return value;
}
export function readChargeRecovery(userId: string, appointmentId: string) {
  return decodeChargeRecovery(window.sessionStorage.getItem(key(userId, appointmentId)), userId, appointmentId);
}
export function writeChargeRecovery(value: ChargeRecovery) {
  const storage = window.sessionStorage, name = key(value.userId, value.appointmentId);
  if (!value.draft && !value.pending) { storage.removeItem(name); return; }
  const raw = JSON.stringify(value);
  decodeChargeRecovery(raw, value.userId, value.appointmentId);
  storage.setItem(name, raw);
}
export function clearChargeRecovery(storage: Storage | null) {
  if (!storage) return;
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(PREFIX));
  for (const name of keys) {
    try {
      const raw = storage.getItem(name!), identity = JSON.parse(raw || 'null');
      const value = decodeChargeRecovery(raw, identity?.userId, identity?.appointmentId);
      // Signing out is not proof that an uncertain monetary request failed. Retain
      // its exact envelope (and unparseable copies) until this UID can reconcile it.
      if (value && !value.pending) storage.removeItem(name!);
    } catch { /* Preserve an unreadable copy for explicit reconciliation. */ }
  }
}

// A lease expiry alone cannot prove the first in-flight transaction did not commit.
// A different acquired lease with an observed advanced appointment version fences
// that transaction. A subsequent replay miss then safely resolves this uncertainty.
export function chargeRetryWasNotCommitted(code: string | undefined, request: PendingChargeOperation, freshLease: { editSessionId: string } | null, observedVersion: number) {
  return ['charge_edit_lost', 'charge_conflict'].includes(code || '') && Boolean(freshLease)
    && freshLease!.editSessionId !== request.data.editSessionId
    && observedVersion > Number(request.data.expectedVersion);
}
