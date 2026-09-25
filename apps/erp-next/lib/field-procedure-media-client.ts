import type { FieldProcedureTarget } from './field-procedure-contract';
import { assertProcedureOwner, hashProcedureBlob, type ProcedureCapture } from './field-procedure-capture-store';
import type { ProcedureEvidence } from './field-procedure-workspace';
import { firebaseClientConfig } from './firebase/client-config';
import { firebaseTransportUrl } from './firebase/isolated-preview';
import { fetchFirebaseResponse, FirebaseRequestError, readFirebaseJson } from './firebase/request-error';
import { requireFirebaseWebSession } from './firebase/session';

function url(target: FieldProcedureTarget, mode: 'upload' | 'read', key: string) {
  const address = new URL(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/fieldOperationsAuthority`);
  address.search = new URLSearchParams({procedureMedia:mode,visitId:target.visitId,interventionId:target.interventionId,
    [mode === 'upload' ? 'captureId' : 'evidenceId']:key}).toString();
  return firebaseTransportUrl(address.href);
}
async function transfer<T>(target: FieldProcedureTarget, address: string, init: RequestInit, receive: (response: Response) => Promise<T>): Promise<T> {
  assertProcedureOwner(target);
  const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(),60_000);
  let rejectTimeout: (() => void) | undefined;
  const timeout = new Promise<never>((_,reject) => { rejectTimeout = () => reject(new FirebaseRequestError('La transferencia tardó demasiado. El archivo permanece guardado; reintenta.',0,'procedure_media_timeout')); controller.signal.addEventListener('abort',rejectTimeout,{once:true}); });
  try {
    const session = await Promise.race([requireFirebaseWebSession(),timeout]); assertProcedureOwner(target);
    if (session.uid !== target.ownerUserId) throw new FirebaseRequestError('La sesión cambió.',401,'procedure_session_changed');
    const response = await Promise.race([fetchFirebaseResponse(address,{...init,headers:{...init.headers,Authorization:`Bearer ${session.idToken}`},signal:controller.signal,cache:'no-store',redirect:'error'}),timeout]);
    assertProcedureOwner(target);
    if (!response.ok) {
      let code = '';
      try { const raw = await Promise.race([readFirebaseJson<{error?:{code?:unknown}}>(response),timeout]);
        if (typeof raw.error?.code === 'string' && /^[a-z_]{3,80}$/.test(raw.error.code)) code = raw.error.code; } catch { /* HTTP status remains authoritative; never expose a response body. */ }
      throw new FirebaseRequestError(response.status === 401 || response.status === 403 ? 'El acceso no está confirmado. Los archivos locales no se han borrado.' : 'El servidor no confirmó el archivo. Se conserva para reintentar o recuperar con oficina.',response.status,code);
    }
    const value = await Promise.race([receive(response),timeout]); assertProcedureOwner(target); return value;
  } finally { window.clearTimeout(timer); if (rejectTimeout) controller.signal.removeEventListener('abort',rejectTimeout); }
}
export function uploadProcedureCapture(target: FieldProcedureTarget, capture: ProcedureCapture): Promise<void> {
  if (!capture.blob || capture.target.ownerUserId !== target.ownerUserId || capture.target.visitId !== target.visitId
      || capture.target.interventionId !== target.interventionId || capture.target.assetId !== target.assetId) throw new Error('Archivo local fuera del contexto solicitado.');
  return transfer(target,url(target,'upload',capture.id),{method:'POST',headers:{'Content-Type':capture.contentType},body:capture.blob},async response => {
    const r = await readFirebaseJson<Record<string,unknown>>(response);
    if (r.success !== true || r.uploaded !== true || r.linked !== false || r.captureId !== capture.id || r.sha256 !== capture.sha256
        || r.sizeBytes !== capture.sizeBytes || r.contentType !== capture.contentType || typeof r.generation !== 'string' || !/^\d+$/.test(r.generation)
        || typeof r.replayed !== 'boolean') throw new FirebaseRequestError('La confirmación del archivo no coincide con la captura. Se conserva el original.',409,'procedure_upload_ack_invalid');
  });
}
export function readProcedureEvidence(target: FieldProcedureTarget, evidence: ProcedureEvidence): Promise<Blob> {
  return transfer(target,url(target,'read',evidence.id),{method:'GET'},async response => {
    if (response.headers.get('Content-Type')?.split(';')[0].trim() !== evidence.contentType) throw new FirebaseRequestError('El archivo recibido tiene otro formato.',409,'procedure_read_type');
    const bytes = await response.blob();
    if (bytes.size !== evidence.sizeBytes || await hashProcedureBlob(bytes) !== evidence.sha256) throw new FirebaseRequestError('El archivo recibido no coincide con la evidencia registrada.',409,'procedure_read_hash');
    return bytes;
  });
}
