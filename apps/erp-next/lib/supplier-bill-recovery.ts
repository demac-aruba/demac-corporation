import { openDraft } from './supplier-bill-draft';
import type { SaveSupplierDraft } from './supplier-bill-records';
type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const prefix = (project: string, uid: string) => 'demac.supplier-save.v1.' + encodeURIComponent(JSON.stringify([project, uid])) + '.';
export function newSupplierDraftId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}

export function validateSaveCommand(value: unknown): asserts value is SaveSupplierDraft {
  if (!value || typeof value !== 'object') throw new Error('Solicitud pendiente inválida.');
  const row = value as SaveSupplierDraft;
  if (row.action !== 'save' || !validId(row.id) || !validId(row.requestId) || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 0 || row.expectedVersion >= 1000000000 || typeof row.reason !== 'string' || row.reason.length > 500) throw new Error('Solicitud pendiente inválida.');
  openDraft(JSON.stringify(row.draft));
  if (!row.draft.supplier.trim() || !row.draft.invoiceNumber.trim() || (row.expectedVersion > 0 && !row.reason.trim()) || row.draft.lines.some(line => typeof line.confirmed !== 'boolean')) throw new Error('Completa proveedor, número y motivo de cambio.');
}
export function pendingSupplierSaves(store: Store, project: string, uid: string): SaveSupplierDraft[] {
  const start = prefix(project, uid), result: SaveSupplierDraft[] = [];
  for (let n = 0; n < store.length; n++) {
    const key = store.key(n);
    if (!key?.startsWith(start)) continue;
    const raw = store.getItem(key);
    if (!raw || raw.length > 300000) throw new Error('Hay un guardado pendiente que requiere revisión.');
    const value: unknown = JSON.parse(raw); validateSaveCommand(value);
    if (key !== start + value.requestId) throw new Error('La referencia pendiente requiere revisión.');
    result.push(value);
  }
  return result;
}
export function retainSupplierSave(store: Store, project: string, uid: string, command: SaveSupplierDraft) {
  validateSaveCommand(command);
  const key = prefix(project, uid) + command.requestId, raw = JSON.stringify(command), existing = store.getItem(key);
  if (existing !== null && existing !== raw) throw new Error('La solicitud pendiente tiene otro contenido.');
  if (new TextEncoder().encode(raw).byteLength > 280000) throw new Error('El borrador supera el tamaño permitido.');
  if (existing === null && pendingSupplierSaves(store, project, uid).length >= 20) throw new Error('Resuelve los guardados pendientes antes de continuar.');
  store.setItem(key, raw);
  if (store.getItem(key) !== raw) throw new Error('No se pudo conservar la solicitud antes de enviarla.');
}
export function releaseSupplierSave(store: Store, project: string, uid: string, command: SaveSupplierDraft) {
  const key = prefix(project, uid) + command.requestId, raw = store.getItem(key);
  if (raw !== null && raw !== JSON.stringify(command)) throw new Error('La solicitud pendiente cambió.');
  store.removeItem(key);
}
