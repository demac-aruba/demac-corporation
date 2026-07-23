import { getValidFirebaseSession } from './firebase';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
const THUMBNAIL_MAX_DIMENSION = 180;
const THUMBNAIL_JPEG_QUALITY = 0.58;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type InventoryThumbnailUpload = {
  thumbnailStoragePath: string;
  thumbnailDownloadUrl: string;
  thumbnailContentType: 'image/jpeg';
  thumbnailSizeBytes: number;
};

type ThumbnailInput = {
  uri: string;
  scope: 'van-tool' | 'warehouse';
  entityId: string;
  evidenceId: string;
  mimeType?: string | null;
};

type FirebaseStoragePayload = {
  downloadTokens?: string | string[];
  metadata?: Record<string, string>;
  error?: { message?: string };
  message?: string;
};

type DrawableImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
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

function buildMultipartUploadBody(metadata: Record<string, unknown>, file: Blob) {
  const boundary = `demac-thumb-${randomToken().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=utf-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    'Content-Type: image/jpeg\r\n\r\n',
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
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'No se pudo obtener el enlace de la miniatura.'} (Storage ${response.status})`);
  return downloadToken(parsePayload(text));
}

async function loadDrawableImage(blob: Blob): Promise<DrawableImage | null> {
  if (typeof document === 'undefined') return null;

  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close?.(),
      };
    } catch {
      // Fall through to HTMLImageElement when createImageBitmap is unavailable or unreliable.
    }
  }

  const ImageConstructor = globalThis.Image;
  if (!ImageConstructor) return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new ImageConstructor();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo procesar la fotografía para crear la miniatura.'));
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (cause) {
    URL.revokeObjectURL(objectUrl);
    throw cause;
  }
}

async function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', THUMBNAIL_JPEG_QUALITY));
}

async function createThumbnail(uri: string, mimeType?: string | null) {
  if (typeof document === 'undefined') return null;
  const response = await fetch(uri);
  if (!response.ok) throw new Error('No se pudo leer la fotografía para crear su miniatura.');
  const sourceBlob = await response.blob();
  const sourceType = mimeType || sourceBlob.type || 'image/jpeg';
  if (!sourceType.startsWith('image/')) throw new Error('El archivo no es una imagen válida.');
  if (sourceBlob.size > MAX_SOURCE_BYTES) throw new Error('La fotografía supera el límite de 25 MB.');

  const drawable = await loadDrawableImage(sourceBlob);
  if (!drawable) return null;
  try {
    const longestSide = Math.max(1, drawable.width, drawable.height);
    const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / longestSide);
    const width = Math.max(1, Math.round(drawable.width * scale));
    const height = Math.max(1, Math.round(drawable.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(drawable.source, 0, 0, width, height);
    const thumbnail = await canvasBlob(canvas);
    return thumbnail && thumbnail.size > 0 ? thumbnail : null;
  } finally {
    drawable.cleanup();
  }
}

export async function uploadInventoryThumbnail(input: ThumbnailInput): Promise<InventoryThumbnailUpload | null> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const [session, thumbnail] = await Promise.all([
    getValidFirebaseSession(),
    createThumbnail(input.uri, input.mimeType),
  ]);
  if (!session) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
  if (!thumbnail) return null;

  const entityId = safeSegment(input.entityId, 'inventory-item');
  const evidenceId = safeSegment(input.evidenceId, randomToken());
  const thumbnailStoragePath = `inventory/${input.scope}/${entityId}/${evidenceId}-thumb.jpg`;
  const metadata = {
    name: thumbnailStoragePath,
    contentType: 'image/jpeg',
    metadata: {
      scope: input.scope,
      entityId: input.entityId,
      evidenceId: input.evidenceId,
      variant: 'thumbnail',
      uploadedByUid: session.uid,
    },
  };
  const multipart = buildMultipartUploadBody(metadata, thumbnail);
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o?name=${encodeURIComponent(thumbnailStoragePath)}`;
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
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'Firebase Storage rechazó la miniatura.'} (Storage ${response.status})`);

  const token = downloadToken(payload) ?? await fetchGeneratedToken(thumbnailStoragePath, session.idToken);
  if (!token) throw new Error('La miniatura subió, pero Firebase no devolvió su enlace de descarga.');
  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;
  return {
    thumbnailStoragePath,
    thumbnailDownloadUrl,
    thumbnailContentType: 'image/jpeg',
    thumbnailSizeBytes: thumbnail.size,
  };
}
