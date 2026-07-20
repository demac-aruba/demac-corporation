import { getValidFirebaseSession } from './firebase';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const TARGET_MAX_DIMENSION = 1280;
const TARGET_JPEG_QUALITY = 0.68;
const SKIP_COMPRESSION_BELOW = 420 * 1024;

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

type PreparedImage = {
  blob: Blob;
  contentType: string;
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
  if (existing && contentType !== 'image/jpeg') return existing.toLowerCase();
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic' || contentType === 'image/heif') return 'heic';
  return 'jpg';
}

function jpegFileName(fileName?: string | null) {
  if (!fileName) return 'inventory-photo.jpg';
  return fileName.replace(/\.[a-zA-Z0-9]{2,5}$/i, '') + '.jpg';
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
  const fallback = text.trim();
  return payload?.error?.message ?? payload?.message ?? (fallback || undefined);
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

async function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function optimizeBrowserImage(blob: Blob, contentType: string, fileName?: string | null): Promise<PreparedImage> {
  if (typeof document === 'undefined' || typeof globalThis.createImageBitmap !== 'function') {
    return { blob, contentType, fileName };
  }
  if (!contentType.startsWith('image/') || contentType === 'image/gif' || contentType === 'image/svg+xml') {
    return { blob, contentType, fileName };
  }
  if (blob.size <= SKIP_COMPRESSION_BELOW && (contentType === 'image/jpeg' || contentType === 'image/webp')) {
    return { blob, contentType, fileName };
  }

  try {
    const bitmap = await globalThis.createImageBitmap(blob);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const longestSide = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(1, TARGET_MAX_DIMENSION / Math.max(1, longestSide));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      bitmap.close?.();
      return { blob, contentType, fileName };
    }
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const compressed = await canvasBlob(canvas, TARGET_JPEG_QUALITY);
    if (!compressed || compressed.size <= 0 || compressed.size >= blob.size) {
      return { blob, contentType, fileName };
    }
    return { blob: compressed, contentType: 'image/jpeg', fileName: jpegFileName(fileName) };
  } catch {
    return { blob, contentType, fileName };
  }
}

async function prepareImage(input: UploadInput): Promise<PreparedImage> {
  const localResponse = await fetch(input.uri);
  if (!localResponse.ok) throw new Error('No se pudo leer la fotografía seleccionada.');
  const original = await localResponse.blob();
  const originalType = input.mimeType || original.type || 'image/jpeg';
  if (!originalType.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.');
  if (original.size > MAX_SOURCE_BYTES) throw new Error('La fotografía original supera el límite de 25 MB.');
  const prepared = await optimizeBrowserImage(original, originalType, input.fileName);
  if (prepared.blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('La fotografía sigue siendo demasiado grande después de optimizarla.');
  }
  return prepared;
}

export async function uploadInventoryImage(input: UploadInput): Promise<InventoryStorageUpload> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const [session, prepared] = await Promise.all([requireSession(), prepareImage(input)]);
  const { blob, contentType, fileName } = prepared;

  const entityId = safeSegment(input.entityId, 'inventory-item');
  const evidenceId = safeSegment(input.evidenceId, randomToken());
  const extension = extensionFor(contentType, fileName);
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
