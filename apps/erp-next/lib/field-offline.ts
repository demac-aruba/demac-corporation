const FIELD_OFFLINE_DB = 'demac-field-offline-v1';
const FIELD_OFFLINE_DB_VERSION = 1;
const OUTBOX_STORE = 'outbox';
const CACHE_STORE = 'readCache';
const DRAFT_STORE = 'drafts';
export const FIELD_OFFLINE_STATE_EVENT = 'demac:field-offline-state';

const MUTATION_ACTIONS = new Set([
  'submit_visit_for_office_review', 'decide_office_review', 'create_field_sale_line', 'decide_field_sale_line',
  'transition_field_sale_line', 'prepare_visit', 'create_return_visit', 'transition_visit', 'attach_visit_asset',
  'attach_visit_asset_by_qr', 'register_visit_asset', 'create_planned_intervention', 'record_planned_work_disposition',
  'create_additional_intervention', 'record_additional_intervention_decision', 'transition_intervention',
  'add_report_photo_evidence', 'add_report_voice_evidence', 'add_report_measurement', 'add_report_finding',
  'set_report_checklist_item', 'set_report_free_text', 'record_customer_report_acknowledgement',
]);

export type FieldOutboxStatus = 'pending' | 'blocked';
export type FieldOutboxRecord = {
  id: string;
  ownerUserId: string;
  action: string;
  requestId: string;
  data: Record<string, unknown>;
  payloadSignature: string;
  status: FieldOutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
};

export type FieldOutboxConflict = { id: string; action: string; requestId: string; message: string };
export type FieldOutboxSummary = { pending: number; blocked: number; total: number; conflicts: FieldOutboxConflict[] };
export type FieldOutboxSendResult =
  | { ok: true }
  | { ok: false; retryable: boolean; code?: string; message: string };

export type FieldOfflineDraft = {
  id: string;
  ownerUserId: string;
  workOrderId: string;
  interventionId: string;
  sectionId: string;
  baseVersion: number;
  value: string;
  updatedAt: string;
};

type FieldReadCacheRecord = {
  id: string;
  ownerUserId: string;
  cacheKey: string;
  value: unknown;
  capturedAt: string;
};

export class FieldOfflineQueuedError extends Error {
  readonly queued = true;
  constructor(readonly outboxId: string) {
    super('Sin conexión confirmada. La operación quedó pendiente en este dispositivo y todavía no es verdad canónica. Se reintentará con el mismo identificador al recuperar conexión.');
    this.name = 'FieldOfflineQueuedError';
  }
}

function requiredText(value: unknown, label: string, limit = 240) {
  const result = String(value ?? '').trim();
  if (!result || result.length > limit) throw new Error(`${label} is invalid.`);
  return result;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Offline payload contains non-finite numeric data.');
  if (['string', 'number', 'boolean'].includes(typeof value) || value === null) return value;
  throw new Error('Offline payload contains unsupported data.');
}

function signature(value: unknown) { return JSON.stringify(stableValue(value)); }
function nowIso(now: () => Date) { const value = now().toISOString(); if (Number.isNaN(Date.parse(value))) throw new Error('Offline clock is invalid.'); return value; }
function outboxId(ownerUserId: string, requestId: string) { return `${encodeURIComponent(ownerUserId)}:${encodeURIComponent(requestId)}`; }
function draftId(ownerUserId: string, workOrderId: string, interventionId: string, sectionId: string) {
  return [ownerUserId, workOrderId, interventionId, sectionId].map(encodeURIComponent).join(':');
}

export function buildFieldOutboxRecord(
  ownerUserId: string,
  action: string,
  data: Record<string, unknown>,
  now: () => Date = () => new Date(),
): FieldOutboxRecord {
  const owner = requiredText(ownerUserId, 'Offline owner', 180);
  const normalizedAction = requiredText(action, 'Offline action', 100);
  if (!MUTATION_ACTIONS.has(normalizedAction)) throw new Error('Only governed Field mutations may enter the offline outbox.');
  const requestId = requiredText(data.requestId, 'Offline request id');
  const normalizedData = stableValue(data) as Record<string, unknown>;
  const payloadSignature = signature({ action: normalizedAction, data: normalizedData });
  if (payloadSignature.length > 100_000) throw new Error('Offline Field mutation is too large for the governed outbox.');
  const timestamp = nowIso(now);
  return {
    id: outboxId(owner, requestId), ownerUserId: owner, action: normalizedAction, requestId,
    data: normalizedData, payloadSignature,
    status: 'pending', attempts: 0, createdAt: timestamp, updatedAt: timestamp,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Offline storage is unavailable in this browser.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FIELD_OFFLINE_DB, FIELD_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' }).createIndex('ownerUserId', 'ownerUserId');
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'id' }).createIndex('ownerUserId', 'ownerUserId');
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: 'id' }).createIndex('ownerUserId', 'ownerUserId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline storage could not be opened.'));
  });
}

async function readRecord<T>(storeName: string, id: string): Promise<T | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(id);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Offline record could not be read.'));
    transaction.oncomplete = () => db.close();
  });
}

async function writeRecord(storeName: string, value: unknown) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline record could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline record write was aborted.'));
  });
  db.close();
}

async function deleteRecord(storeName: string, id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline record could not be deleted.'));
  });
  db.close();
}

async function recordsForOwner<T extends { ownerUserId: string }>(storeName: string, ownerUserId: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).index('ownerUserId').getAll(ownerUserId);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error('Offline records could not be listed.'));
    transaction.oncomplete = () => db.close();
  });
}

function notifyOfflineState() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIELD_OFFLINE_STATE_EVENT));
}

export async function enqueueFieldMutation(ownerUserId: string, action: string, data: Record<string, unknown>) {
  const candidate = buildFieldOutboxRecord(ownerUserId, action, data);
  const db = await openDatabase();
  const saved = await new Promise<FieldOutboxRecord>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = transaction.objectStore(OUTBOX_STORE);
    const request = store.get(candidate.id);
    let result = candidate;
    request.onsuccess = () => {
      const existing = request.result as FieldOutboxRecord | undefined;
      if (existing) {
        if (existing.ownerUserId !== candidate.ownerUserId || existing.payloadSignature !== candidate.payloadSignature) {
          transaction.abort(); reject(new Error('Offline request id was already used for a different Field mutation. Refresh before retrying.')); return;
        }
        if (existing.status === 'blocked') {
          transaction.abort(); reject(new Error(existing.lastErrorMessage || 'This offline Field operation has a canonical conflict and requires review.')); return;
        }
        result = existing;
      } else {
        store.add(candidate);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Offline outbox could not be read.'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline outbox could not be written.'));
    transaction.onabort = () => db.close();
  });
  db.close();
  notifyOfflineState();
  return saved;
}

export async function removeQueuedFieldMutation(ownerUserId: string, requestId: string) {
  await deleteRecord(OUTBOX_STORE, outboxId(requiredText(ownerUserId, 'Offline owner', 180), requiredText(requestId, 'Offline request id')));
  notifyOfflineState();
}

export async function getFieldOutboxSummary(ownerUserId: string): Promise<FieldOutboxSummary> {
  const records = await recordsForOwner<FieldOutboxRecord>(OUTBOX_STORE, requiredText(ownerUserId, 'Offline owner', 180));
  const pending = records.filter((item) => item.status === 'pending').length;
  const blocked = records.filter((item) => item.status === 'blocked').length;
  return {
    pending, blocked, total: pending + blocked,
    conflicts: records.filter((item) => item.status === 'blocked').map((item) => ({
      id: item.id, action: item.action, requestId: item.requestId,
      message: item.lastErrorMessage || 'Canonical Field state rejected this offline operation.',
    })),
  };
}

export async function discardBlockedFieldMutation(ownerUserId: string, id: string) {
  const owner = requiredText(ownerUserId, 'Offline owner', 180);
  const record = await readRecord<FieldOutboxRecord>(OUTBOX_STORE, requiredText(id, 'Offline outbox id', 600));
  if (!record || record.ownerUserId !== owner || record.status !== 'blocked') throw new Error('Only this user’s reviewed blocked Field operation may be discarded.');
  await deleteRecord(OUTBOX_STORE, record.id);
  notifyOfflineState();
}

export function fieldOutboxFailureRecord(
  record: FieldOutboxRecord,
  result: Extract<FieldOutboxSendResult, { ok: false }>,
  now: () => Date = () => new Date(),
): FieldOutboxRecord {
  return {
    ...record,
    status: result.retryable ? 'pending' : 'blocked',
    attempts: record.attempts + 1,
    updatedAt: nowIso(now),
    lastErrorCode: result.code,
    lastErrorMessage: result.message,
  };
}

export async function flushFieldOutbox(
  ownerUserId: string,
  send: (record: FieldOutboxRecord) => Promise<FieldOutboxSendResult>,
  now: () => Date = () => new Date(),
) {
  const records = (await recordsForOwner<FieldOutboxRecord>(OUTBOX_STORE, requiredText(ownerUserId, 'Offline owner', 180)))
    .filter((item) => item.status === 'pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let completed = 0; let blocked = 0; let deferred = 0;
  for (const record of records) {
    const result = await send(record);
    if (result.ok) {
      await deleteRecord(OUTBOX_STORE, record.id);
      completed += 1;
      continue;
    }
    if (result.retryable) {
      await writeRecord(OUTBOX_STORE, fieldOutboxFailureRecord(record, result, now));
      deferred = records.length - completed - blocked;
      break;
    }
    await writeRecord(OUTBOX_STORE, fieldOutboxFailureRecord(record, result, now));
    blocked += 1;
  }
  notifyOfflineState();
  return { completed, blocked, deferred };
}

function cacheId(ownerUserId: string, cacheKey: string) { return `${encodeURIComponent(ownerUserId)}:${encodeURIComponent(cacheKey)}`; }

export async function cacheFieldRead(ownerUserId: string, cacheKey: string, value: unknown, now: () => Date = () => new Date()) {
  const owner = requiredText(ownerUserId, 'Offline owner', 180); const key = requiredText(cacheKey, 'Offline cache key', 500);
  const normalizedValue = stableValue(value);
  if (signature(normalizedValue).length > 1_000_000) throw new Error('Offline Field read is too large to cache.');
  await writeRecord(CACHE_STORE, { id: cacheId(owner, key), ownerUserId: owner, cacheKey: key, value: normalizedValue, capturedAt: nowIso(now) } satisfies FieldReadCacheRecord);
  const records = (await recordsForOwner<FieldReadCacheRecord>(CACHE_STORE, owner)).sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  await Promise.all(records.slice(24).map((record) => deleteRecord(CACHE_STORE, record.id)));
}

export async function readCachedFieldRead(ownerUserId: string, cacheKey: string, maxAgeMs = 24 * 60 * 60 * 1000) {
  const owner = requiredText(ownerUserId, 'Offline owner', 180); const key = requiredText(cacheKey, 'Offline cache key', 500);
  const record = await readRecord<FieldReadCacheRecord>(CACHE_STORE, cacheId(owner, key));
  if (!record || record.ownerUserId !== owner || record.cacheKey !== key || Number.isNaN(Date.parse(record.capturedAt))) return null;
  if (Date.now() - Date.parse(record.capturedAt) > maxAgeMs) return null;
  return { value: record.value, capturedAt: record.capturedAt };
}

export async function saveFieldOfflineDraft(input: Omit<FieldOfflineDraft, 'id' | 'updatedAt'>, now: () => Date = () => new Date()) {
  const draft = buildFieldOfflineDraft(input, now);
  await writeRecord(DRAFT_STORE, draft);
  return draft;
}

export function buildFieldOfflineDraft(input: Omit<FieldOfflineDraft, 'id' | 'updatedAt'>, now: () => Date = () => new Date()) {
  const ownerUserId = requiredText(input.ownerUserId, 'Draft owner', 180);
  const workOrderId = requiredText(input.workOrderId, 'Draft Work Order', 180);
  const interventionId = requiredText(input.interventionId, 'Draft intervention', 180);
  const sectionId = requiredText(input.sectionId, 'Draft section', 180);
  if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0 || input.value.length > 5000) throw new Error('Offline draft version or content is invalid.');
  const draft: FieldOfflineDraft = { ...input, ownerUserId, workOrderId, interventionId, sectionId, id: draftId(ownerUserId, workOrderId, interventionId, sectionId), updatedAt: nowIso(now) };
  return draft;
}

export async function readFieldOfflineDraft(ownerUserId: string, workOrderId: string, interventionId: string, sectionId: string) {
  const values = [ownerUserId, workOrderId, interventionId, sectionId].map((value, index) => requiredText(value, ['Draft owner', 'Draft Work Order', 'Draft intervention', 'Draft section'][index], 180));
  return readRecord<FieldOfflineDraft>(DRAFT_STORE, draftId(values[0], values[1], values[2], values[3]));
}

export async function deleteFieldOfflineDraft(ownerUserId: string, workOrderId: string, interventionId: string, sectionId: string) {
  const values = [ownerUserId, workOrderId, interventionId, sectionId].map((value, index) => requiredText(value, ['Draft owner', 'Draft Work Order', 'Draft intervention', 'Draft section'][index], 180));
  await deleteRecord(DRAFT_STORE, draftId(values[0], values[1], values[2], values[3]));
}

export function isGovernedFieldMutation(action: string) { return MUTATION_ACTIONS.has(action); }
