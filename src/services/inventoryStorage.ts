import { getValidFirebaseSession } from './firebase';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

export type InventoryStorageUpload = {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
};

type UploadInput = {
  uri: string;
  scope: 'van-tool' | 'warehouse';
  entityId: string;
  evidenceId: string;
  mimeType?: string | null;
  fileName?: string | null;
};

type FirebaseStoragePayload = {
  downloadTokens?: string | string[];
  metadata?: Record<string, string>;
  error?: { message?: string };
  message?: string;
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

function parsePayload(text: string): FirebaseStoragePayload | undefined {
  if (!text.trim()) return undefined;
  try { return JSON.parse(text) as FirebaseStoragePayload; } catch { return undefined; }
}

function responseMessage(text: string) {
  const payload = parsePayload(text);
  return payload?.error?.message ?? payload?.message ?? text.trim() || undefined;
}

function downloadToken(payload?: FirebaseStoragePayload) {
  const raw = payload?.downloadTokens ?? payload?.metadata?.firebaseStorageDownloadTokens;
  if (Array.isArray(raw)) return raw[0];
  return raw?.split(',')[0];
}

async function fetchGeneratedToken(storagePath: string, idToken: string) {
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o/${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${idToken}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'No se pudo obtener el enlace de descarga.'} (Storage ${response.status})`);
  return downloadToken(parsePayload(text));
}

export async function uploadInventoryImage(input: UploadInput): Promise<InventoryStorageUpload> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const session = await requireSession();
  const localResponse = await fetch(input.uri);
  if (!localResponse.ok) throw new Error('No se pudo leer la fotografía seleccionada.');
  const blob = await localResponse.blob();
  const contentType = input.mimeType || blob.type || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.');
  if (blob.size > 12 * 1024 * 1024) throw new Error('La fotografía supera el límite de 12 MB.');

  const entityId = safeSegment(input.entityId, 'inventory-item');
  const evidenceId = safeSegment(input.evidenceId, randomToken());
  const extension = extensionFor(contentType, input.fileName);
  const storagePath = `inventory/${input.scope}/${entityId}/${evidenceId}.${extension}`;
  const metadata = {
    name: storagePath,
    contentType,
    metadata: {
      scope: input.scope,
      entityId: input.entityId,
      evidenceId: input.evidenceId,
      uploadedByUid: session.uid,
    },
  };

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
  const text = await response.text();
  const payload = parsePayload(text);
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'Firebase Storage rechazó la fotografía.'} (Storage ${response.status})`);

  const token = downloadToken(payload) ?? await fetchGeneratedToken(storagePath, session.idToken);
  if (!token) throw new Error('La fotografía subió, pero Firebase no devolvió su enlace de descarga.');
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
  return { storagePath, downloadUrl, contentType, sizeBytes: blob.size };
}
