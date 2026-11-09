import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession, loadFirebaseWebSession } from './session';
import { firebaseTransportUrl } from './isolated-preview';
import { pendingSupplierSaves, retainSupplierSave, releaseSupplierSave } from '../supplier-bill-recovery';
import type { SaveSupplierDraft, SupplierBillGateway, SupplierDraftReceipt } from '../supplier-bill-records';

const errors: Record<string, string> = {
  'drafts-not-active': 'El guardado compartido todavía no está activado en este entorno.',
  'draft-access-denied': 'Tu rol no tiene acceso a esta operación de compras.',
  'sign-in-required': 'Verifica tu sesión para continuar.',
  'supplier-and-number-required': 'Completa el proveedor y el número de factura.',
  'reason-required': 'Escribe el motivo del cambio.',
  'draft-needs-review': 'El registro necesita revisión antes de continuar.',
  'draft-not-found': 'No se encontró el borrador solicitado.',
  'request-payload-conflict': 'La solicitud pendiente tiene otro contenido y necesita revisión.',
};
async function call<T>(body: object, expectedUid?: string): Promise<T> {
  const session = await requireFirebaseWebSession();
  if (expectedUid && session.uid !== expectedUid) throw new Error('La sesión cambió.');
  if (!firebaseClientConfig.projectId) throw new Error('El entorno de compras no está configurado.');
  const response = await fetch(firebaseTransportUrl(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/supplierBillDrafts`), {
    method: 'POST', headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => null);
  if (loadFirebaseWebSession()?.uid !== session.uid) throw new Error('La sesión cambió.');
  if (!response.ok || !result || result.error) throw new Error(errors[result?.error] || (response.status === 404 ? errors['drafts-not-active'] : 'No se pudo comprobar el resultado. Conservamos cualquier guardado pendiente.'));
  return result as T;
}
async function save(command: SaveSupplierDraft): Promise<SupplierDraftReceipt> {
  const session = await requireFirebaseWebSession();
  const project = firebaseClientConfig.projectId;
  if (!project) throw new Error('El entorno no está configurado.');
  retainSupplierSave(window.localStorage, project, session.uid, command);
  const receipt = await call<SupplierDraftReceipt>(command, session.uid);
  if (receipt.accepted === true) {
    if (receipt.id !== command.id || receipt.version !== command.expectedVersion + 1) throw new Error('La respuesta del guardado necesita revisión.');
  } else if (receipt.accepted !== false || !['draft-version-conflict', 'duplicate-draft-reference'].includes(receipt.code)) {
    throw new Error('No se pudo comprobar el resultado del guardado.');
  }
  // Only a verified terminal server receipt retires the immutable request.
  releaseSupplierSave(window.localStorage, project, session.uid, command);
  return receipt;
}
export const supplierBillGateway: SupplierBillGateway = {
  status: () => call({ action: 'status' }),
  list: after => call({ action: 'list', after }),
  read: id => call({ action: 'read', id }),
  history: (id, beforeVersion) => call({ action: 'history', id, beforeVersion }),
  pending: async () => {
    const session = await requireFirebaseWebSession();
    if (!firebaseClientConfig.projectId) throw new Error('El entorno no está configurado.');
    return pendingSupplierSaves(window.localStorage, firebaseClientConfig.projectId, session.uid);
  },
  save,
};
