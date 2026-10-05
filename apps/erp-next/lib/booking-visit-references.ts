import { firebaseClientConfig } from './firebase/client-config';
import { firebaseTransportUrl } from './firebase/isolated-preview';
import { requireFirebaseWebSession } from './firebase/session';

export type VisitReferenceFile = { id: string; fileName: string; kind: 'image' | 'video' | 'voice'; mimeType: string; size: number; description: string };
export type VisitReferences = { notes: string; location: { url: string; label: string } | null; files: VisitReferenceFile[]; version?: number };
export const emptyVisitReferences = (): VisitReferences => ({ notes: '', location: null, files: [], version: 0 });
export const hasVisitReferences = (value: VisitReferences) => Boolean(value.notes.trim() || value.location?.url.trim() || value.files.length);
export const visitReferenceRequestId = () => `references-${crypto.randomUUID()}`;
function endpoint(query: URLSearchParams) {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase is not configured.');
  return firebaseTransportUrl(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/bookingVisitReferences?${query}`);
}
async function request(query: URLSearchParams, init: RequestInit = {}) {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(endpoint(query), { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.idToken}` },
      signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || 'No se pudo completar la solicitud de referencias.');
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Recarga para verificar antes de volver a guardar.');
    throw error;
  } finally { clearTimeout(timer); }
}
export async function uploadVisitReference(file: File, uploadId: string): Promise<VisitReferenceFile> {
  if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Cada archivo debe tener contenido y pesar como máximo 25 MB.');
  const response = await request(new URLSearchParams({ action: 'upload', uploadId, fileName: file.name }), {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  });
  const result = await response.json();
  if (!result.success || !result.file?.id) throw new Error('No se pudo verificar la carga del archivo.');
  return { ...result.file, description: '' };
}
export type ReferenceContext = { appointmentId?: string; workOrderId?: string };
export async function loadVisitReferences(context: ReferenceContext): Promise<VisitReferences> {
  const response = await request(new URLSearchParams(Object.entries(context).filter((entry): entry is [string, string] => Boolean(entry[1]))));
  const result = await response.json();
  if (!result.success || !result.references) throw new Error('No se pudieron cargar las referencias.');
  return result.references;
}
export async function readVisitReference(file: VisitReferenceFile, context: ReferenceContext): Promise<Blob> {
  const query = new URLSearchParams(Object.entries(context).filter((entry): entry is [string, string] => Boolean(entry[1])));
  query.set('fileId', file.id);
  return (await request(query)).blob();
}
export async function saveVisitReferences(appointmentId: string, references: VisitReferences, expectedVersion: number, requestId: string): Promise<VisitReferences> {
  const response = await request(new URLSearchParams(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointmentId, references, expectedVersion, requestId }) });
  const result = await response.json();
  if (!result.success || !result.references) throw new Error('No se pudo verificar que las referencias quedaron guardadas.');
  return result.references;
}
