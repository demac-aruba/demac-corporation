import { getValidFirebaseSession } from './firebase';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

export type StorageUploadResult = {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
};

type UploadEvidenceInput = {
  uri: string;
  workOrderId: string;
  unitId?: string;
  evidenceId: string;
  mimeType?: string | null;
  fileName?: string | null;
};

function safeSegment(value: string, fallback: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function randomToken() {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function extensionFor(contentType: string, fileName?: string | null) {
  const existing = fileName?.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
  if (existing) return existing.toLowerCase();
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic' || contentType === 'image/heif') return 'heic';
  return 'jpg';
}

async function requireSession() {
  const session = await getValidFirebaseSession();
  if (!session) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
  return session;
}

function buildMultipartUploadBody(metadata: Record<string, unknown>, file: Blob, contentType: string) {
  const boundary = `demac-${randomToken().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=utf-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  return { body, contentTypeHeader: `multipart/related; boundary=${boundary}` };
}

function storageResponseMessage(responseText: string) {
  if (!responseText.trim()) return undefined;
  try {
    const payload = JSON.parse(responseText);
    return payload?.error?.message ?? payload?.message ?? responseText.trim();
  } catch {
    return responseText.trim();
  }
}

export async function uploadWorkOrderEvidenceImage(input: UploadEvidenceInput): Promise<StorageUploadResult> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const session = await requireSession();
  const localResponse = await fetch(input.uri);
  if (!localResponse.ok) throw new Error('No se pudo leer la fotografía seleccionada.');
  const blob = await localResponse.blob();
  const contentType = input.mimeType || blob.type || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.');
  if (blob.size > 12 * 1024 * 1024) throw new Error('La fotografía supera el límite de 12 MB.');

  const extension = extensionFor(contentType, input.fileName);
  const workOrderId = safeSegment(input.workOrderId, 'work-order');
  const unitId = safeSegment(input.unitId || 'general', 'general');
  const evidenceId = safeSegment(input.evidenceId, randomToken());
  const storagePath = `work-orders/${workOrderId}/${unitId}/${evidenceId}.${extension}`;
  const downloadToken = randomToken();
  const metadata = {
    name: storagePath,
    contentType,
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
      workOrderId: input.workOrderId,
      unitId: input.unitId || 'general',
      evidenceId: input.evidenceId,
      uploadedByUid: session.uid,
    },
  };

  // Match the Firebase Web SDK multipart protocol exactly: the Firebase
  // endpoint uses X-Goog-Upload-Protocol and a name query parameter. The
  // Cloud Storage JSON API uploadType parameter is not valid on this endpoint.
  const multipart = buildMultipartUploadBody(metadata, blob, contentType);
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o?name=${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': multipart.contentTypeHeader,
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body: multipart.body,
  });
  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : undefined;
  if (!response.ok) {
    const message = storageResponseMessage(responseText) ?? 'Firebase Storage rechazó la fotografía.';
    throw new Error(`${message} (Storage ${response.status})`);
  }

  const token = payload?.downloadTokens || payload?.metadata?.firebaseStorageDownloadTokens || downloadToken;
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(String(token).split(',')[0])}`;
  return { storagePath, downloadUrl, contentType, sizeBytes: blob.size };
}

export async function deleteWorkOrderEvidenceImage(storagePath: string) {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const session = await requireSession();
  const response = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(storagePath)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${session.idToken}` } },
  );
  if (response.status === 404) return;
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw new Error(payload?.error?.message ?? 'No se pudo eliminar la fotografía de Firebase Storage.');
  }
}
