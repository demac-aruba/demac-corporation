import { assertFieldProcedureTarget, type FieldProcedurePart, type FieldProcedureTarget } from './field-procedure-contract';
import { loadFirebaseWebSession } from './firebase/session';
import { PROCEDURE_MEDIA_TYPES, type PrepareProcedureMedia, type ProcedureMediaKind, type ProcedureMediaSource } from './field-procedure-workspace';

// Browser-only recovery storage, never another business database or authorization source.
// Keep the existing text outbox schema unchanged. Tokens and public URLs never enter this database.
const DB = 'demac-field-procedure-captures-v1';
export type ProcedureCapture = {
  id: string; target: FieldProcedureTarget; part: FieldProcedurePart; stepId: string; view: string;
  kind: ProcedureMediaKind; source: ProcedureMediaSource; contentType: string; sizeBytes: number; sha256: string;
  declaredCapturedAt: string | null; capturedSafetyRevision: number; blob: Blob | null;
  stage: 'local' | 'reserved' | 'uploaded' | 'confirmed'; revision: number; createdAt: string; updatedAt: string;
  prepare: { requestId: string; command: PrepareProcedureMedia } | null;
  commit: { requestId: string; command: { action: 'commit_media'; captureId: string; acknowledgeCoordinationChange?: boolean; reason?: string } };
  evidenceId: string | null;
};
export type ProcedureDraft = {
  id: string; target: FieldProcedureTarget; part: FieldProcedurePart; stepId: string;
  basePartVersion: number; baseSafetyRevision: number; value: string; revision: number; updatedAt: string;
};
export class ProcedureLocalConflict extends Error {
  constructor() { super('Otra pestaña actualizó esta captura. Actualiza sin borrar el borrador.'); this.name = 'ProcedureLocalConflict'; }
}
export class ProcedureStorageError extends Error {
  constructor() { super('No se pudo guardar en este dispositivo. Conserva el archivo abierto y libera espacio o reintenta; todavía no está protegido frente a un cierre.'); this.name = 'ProcedureStorageError'; }
}
export function assertProcedureOwner(target: FieldProcedureTarget): void {
  assertFieldProcedureTarget(target);
  if (loadFirebaseWebSession()?.uid !== target.ownerUserId) throw new Error('La sesión cambió. Los archivos permanecen en la cuenta de su autor.');
}
export function procedureContextKey(target: FieldProcedureTarget): string {
  assertFieldProcedureTarget(target);
  return JSON.stringify([target.ownerUserId,target.visitId,target.interventionId,target.assetId]);
}
function equalTarget(a: FieldProcedureTarget, b: FieldProcedureTarget) { return procedureContextKey(a) === procedureContextKey(b); }
function assertStep(part: FieldProcedurePart, stepId: string) {
  if (part !== 'indoor' && part !== 'outdoor' || !(part === 'indoor' ? /^I(0[1-9]|1[0-4])$/ : /^O0[1-9]$/).test(stepId)) throw new Error('Procedimiento inválido.');
}
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new ProcedureStorageError());
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB,1); let failed = false;
    request.onupgradeneeded = () => {
      for (const name of ['captures','drafts']) {
        const store = request.result.createObjectStore(name,{keyPath:'id'});
        store.createIndex('context','context');
      }
    };
    request.onerror = () => reject(new ProcedureStorageError());
    request.onblocked = () => { failed = true; reject(new ProcedureStorageError()); };
    request.onsuccess = () => {
      const db = request.result; db.onversionchange = () => db.close();
      if (failed) db.close(); else resolve(db);
    };
  });
}
async function transaction<T>(target: FieldProcedureTarget, storeName: string, mode: IDBTransactionMode,
  action: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  assertProcedureOwner(target);
  const db = await open();
  try {
    assertProcedureOwner(target);
    return await new Promise<T>((resolve,reject) => {
      const tx = db.transaction(storeName,mode); let value: T; let error: Error | undefined;
      tx.oncomplete = () => { try { assertProcedureOwner(target); resolve(value); } catch (e) { reject(e); } };
      tx.onabort = tx.onerror = () => reject(error || new ProcedureStorageError());
      const fail = (e: Error) => { error = e; tx.abort(); };
      try { action(tx.objectStore(storeName),v => { value = v; },fail); } catch (e) { fail(e instanceof Error && e.name === 'Error' ? e : new ProcedureStorageError()); }
    });
  } finally { db.close(); }
}
function onSuccess<T>(request: IDBRequest<T>, fail: (error: Error) => void, run: (value: T) => void) {
  request.onsuccess = () => {
    try { run(request.result); }
    catch (error) { fail(error instanceof ProcedureLocalConflict ? error : new ProcedureStorageError()); }
  };
}
async function hashProcedureBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function hashProcedureBlob(blob: Blob): Promise<string> {
  return hashProcedureBytes(await blob.arrayBuffer());
}

type StoredProcedureCapture = Omit<ProcedureCapture,'blob'> & { context?: string; byteEncoding: 'array-buffer-v1'; bytes: ArrayBuffer | null };
function restoreCapture(value: ProcedureCapture | StoredProcedureCapture): ProcedureCapture {
  if (!('byteEncoding' in value)) return value; // Existing native-Blob receipts remain readable.
  const {bytes,byteEncoding,...metadata} = value;
  if (byteEncoding !== 'array-buffer-v1' || (bytes === null ? value.stage !== 'confirmed'
      : !(bytes instanceof ArrayBuffer) || bytes.byteLength !== value.sizeBytes || value.stage === 'confirmed')) throw new ProcedureStorageError();
  return {...metadata,blob:bytes === null ? null : new Blob([bytes],{type:value.contentType})};
}
export async function storeProcedureCapture(target: FieldProcedureTarget, input: {
  part: FieldProcedurePart; stepId: string; view: string; kind: ProcedureMediaKind; source: ProcedureMediaSource;
  blob: Blob; safetyRevision: number; declaredCapturedAt?: string | null; limitBytes: number;
}): Promise<ProcedureCapture> {
  assertProcedureOwner(target); assertStep(input.part,input.stepId);
  const contentType = input.blob.type.split(';')[0].trim().toLowerCase();
  if (!PROCEDURE_MEDIA_TYPES[input.kind]?.includes(contentType) || input.blob.size <= 0
      || input.blob.size > input.limitBytes || input.blob.size > 20*1024*1024 || !Number.isSafeInteger(input.safetyRevision) || input.safetyRevision < 0
      || !['camera','gallery','recorder','attachment'].includes(input.source) || !/^[a-z_]{1,40}$/.test(input.view)
      || input.declaredCapturedAt != null && !Number.isFinite(Date.parse(input.declaredCapturedAt))) throw new Error('Tipo, tamaño o contexto del archivo no admitido.');
  // Persist exact binary bytes, not a browser-specific native Blob reference. Some
  // WebKit private contexts cannot serialize native Blobs into IndexedDB. No base64.
  const bytes = await input.blob.arrayBuffer(), sha256 = await hashProcedureBytes(bytes); assertProcedureOwner(target);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const capture: ProcedureCapture = {id,target:{...target},part:input.part,stepId:input.stepId,view:input.view,kind:input.kind,source:input.source,
    contentType,sizeBytes:input.blob.size,sha256,declaredCapturedAt:input.declaredCapturedAt || null,capturedSafetyRevision:input.safetyRevision,
    blob:input.blob,stage:'local',revision:0,createdAt:now,updatedAt:now,prepare:null,
    commit:{requestId:`procedure-link-${id}`,command:{action:'commit_media',captureId:id}},evidenceId:null};
  // Resolve only after the Blob and all retry identifiers have committed atomically.
  return transaction(target,'captures','readwrite',(store,done) => { const {blob:_blob,...metadata} = capture;
    store.add({...metadata,context:procedureContextKey(target),byteEncoding:'array-buffer-v1',bytes}); done(capture); });
}
export function listProcedureCaptures(target: FieldProcedureTarget): Promise<ProcedureCapture[]> {
  return transaction(target,'captures','readonly',(store,done,fail) => {
    const request = store.index('context').getAll(procedureContextKey(target));
    request.onsuccess = () => {
      try { const rows = (request.result as Array<ProcedureCapture | StoredProcedureCapture>).map(restoreCapture); if (rows.some(r => !equalTarget(r.target,target))) throw new ProcedureLocalConflict();
        done(rows.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))); } catch (e) { fail(e as Error); }
    };
  });
}
export function readProcedureCapture(target: FieldProcedureTarget, captureId: string): Promise<ProcedureCapture | null> {
  return transaction(target,'captures','readonly',(store,done,fail) => {
    const request = store.get(captureId); onSuccess(request,fail,value => {
      const row = value ? restoreCapture(value) : undefined;
      if (row && !equalTarget(row.target,target)) fail(new ProcedureLocalConflict()); else done(row || null);
    });
  });
}
/** Compare-and-swap prevents late writers / concurrent tabs from moving progress backward. */
export function advanceProcedureCapture(target: FieldProcedureTarget, previous: ProcedureCapture,
  patch: Partial<Pick<ProcedureCapture,'stage'|'prepare'|'evidenceId'|'blob'>>): Promise<ProcedureCapture> {
  return transaction(target,'captures','readwrite',(store,done,fail) => {
    const request = store.get(previous.id); onSuccess(request,fail,value => {
      const current = value ? restoreCapture(value) : undefined;
      if (!current || !equalTarget(current.target,target) || current.revision !== previous.revision) return fail(new ProcedureLocalConflict());
      if (patch.blob !== undefined && patch.blob !== null) return fail(new ProcedureLocalConflict());
      const next = {...current,...patch,revision:current.revision+1,updatedAt:new Date().toISOString()};
      const stages = ['local','reserved','uploaded','confirmed'];
      if (stages.indexOf(next.stage) < stages.indexOf(current.stage) || current.prepare && JSON.stringify(current.prepare) !== JSON.stringify(next.prepare)
          || next.stage === 'confirmed' && (!next.evidenceId || next.blob !== null) || next.stage !== 'confirmed' && !(next.blob instanceof Blob)) return fail(new ProcedureLocalConflict());
      if ('byteEncoding' in value) {
        const {blob:_blob,...metadata} = next;
        store.put({...metadata,byteEncoding:'array-buffer-v1',bytes:next.blob === null ? null : value.bytes});
      } else store.put(next);
      done(next);
    });
  });
}
export function discardUnsentProcedureCapture(target: FieldProcedureTarget, captureId: string): Promise<void> {
  return transaction(target,'captures','readwrite',(store,done,fail) => {
    const request = store.get(captureId); onSuccess(request,fail,value => {
      const row = value as ProcedureCapture | undefined;
      if (row && (!equalTarget(row.target,target) || row.stage !== 'local' || row.prepare !== null)) return fail(new Error('La captura pudo llegar al servidor. Se conserva para recuperación autorizada.'));
      if (row) store.delete(captureId); done(undefined);
    });
  });
}
export function readProcedureDraft(target: FieldProcedureTarget, part: FieldProcedurePart, stepId: string): Promise<ProcedureDraft | null> {
  assertStep(part,stepId); const key = JSON.stringify([procedureContextKey(target),part,stepId]);
  return transaction(target,'drafts','readonly',(store,done,fail) => { const r = store.get(key); onSuccess(r,fail,value => { if (value && !equalTarget(value.target,target)) return fail(new ProcedureLocalConflict()); done(value || null); }); });
}
export function saveProcedureDraft(target: FieldProcedureTarget, input: Omit<ProcedureDraft,'id'|'target'|'revision'|'updatedAt'>, expectedRevision: number | null): Promise<ProcedureDraft> {
  assertStep(input.part,input.stepId); if (input.value.length > 16000) return Promise.reject(new Error('Borrador demasiado largo.'));
  const key = JSON.stringify([procedureContextKey(target),input.part,input.stepId]);
  return transaction(target,'drafts','readwrite',(store,done,fail) => {
    const request = store.get(key); onSuccess(request,fail,value => {
      const old = value as ProcedureDraft | undefined;
      if ((old?.revision ?? null) !== expectedRevision) return fail(new ProcedureLocalConflict());
      const next: ProcedureDraft = {...input,id:key,target:{...target},revision:(old?.revision ?? -1)+1,updatedAt:new Date().toISOString()};
      store.put({...next,context:procedureContextKey(target)}); done(next);
    });
  });
}
export async function procedureStoragePersisted(): Promise<boolean> {
  try { return await navigator.storage?.persisted?.() || false; } catch { return false; }
}
