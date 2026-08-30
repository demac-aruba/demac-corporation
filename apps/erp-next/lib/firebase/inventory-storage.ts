import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession } from './session';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TARGET_MAX_DIMENSION = 1440;
const TARGET_JPEG_QUALITY = 0.76;
const THUMBNAIL_MAX_DIMENSION = 360;
const THUMBNAIL_JPEG_QUALITY = 0.68;
const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const SKIP_COMPRESSION_BELOW = 450 * 1024;

export type InventoryToolPhotoUpload = {
  storagePath: string;
  downloadUrl: string;
  thumbnailStoragePath: string;
  thumbnailUrl: string;
  contentType: string;
  sizeBytes: number;
};

type UploadVanToolPhotoInput = {
  file: File;
  requestId: string;
  vanId: string;
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
  extension: string;
};

type PreparedImages = {
  original: PreparedImage;
  thumbnail: PreparedImage;
};

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function safeSegment(value: string, fallback: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function extensionFor(contentType: string) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic') return 'heic';
  if (contentType === 'image/heif') return 'heif';
  return 'jpg';
}

function parsePayload(text: string): FirebaseStoragePayload | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as FirebaseStoragePayload;
  } catch {
    return undefined;
  }
}

function responseMessage(text: string) {
  const payload = parsePayload(text);
  return payload?.error?.message ?? payload?.message ?? (text.trim() || undefined);
}

function downloadToken(payload?: FirebaseStoragePayload) {
  const raw = payload?.downloadTokens ?? payload?.metadata?.firebaseStorageDownloadTokens;
  if (Array.isArray(raw)) return raw[0];
  return raw?.split(',')[0];
}

function firebaseDownloadUrl(bucket: string, storagePath: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
}

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function multipartBody(metadata: Record<string, unknown>, file: Blob, contentType: string) {
  const boundary = `demac-${randomToken().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return {
    body: new Blob([
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=utf-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${contentType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ], { type: `multipart/related; boundary=${boundary}` }),
    header: `multipart/related; boundary=${boundary}`,
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close?.() };
    } catch {
      // Fall through to the HTML image decoder for formats the bitmap API rejects.
    }
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('This browser cannot prepare an inventory photo thumbnail.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error('The selected image could not be decoded.'));
      candidate.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function renderJpeg(image: DecodedImage, maxDimension: number, quality: number) {
  const longestSide = Math.max(image.width, image.height);
  const scale = Math.min(1, maxDimension / Math.max(1, longestSide));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The photo could not be optimized in this browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  const blob = await canvasBlob(canvas, quality);
  if (!blob?.size) throw new Error('The photo could not be optimized in this browser.');
  return blob;
}

async function prepareImages(file: File): Promise<PreparedImages> {
  const contentType = file.type || 'application/octet-stream';
  if (!contentType.startsWith('image/')) throw new Error('Choose a valid image file.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('The original photo must be smaller than 25 MB.');
  if (contentType === 'image/svg+xml') throw new Error('Choose a camera photo or raster image instead of an SVG file.');
  const decoded = await decodeImage(file);
  try {
    const [optimizedOriginal, thumbnail] = await Promise.all([
      renderJpeg(decoded, TARGET_MAX_DIMENSION, TARGET_JPEG_QUALITY),
      renderJpeg(decoded, THUMBNAIL_MAX_DIMENSION, THUMBNAIL_JPEG_QUALITY),
    ]);
    const canKeepSmallOriginal = file.size <= SKIP_COMPRESSION_BELOW
      && decoded.width <= TARGET_MAX_DIMENSION
      && decoded.height <= TARGET_MAX_DIMENSION
      && (contentType === 'image/jpeg' || contentType === 'image/webp');
    const original = canKeepSmallOriginal && file.size <= optimizedOriginal.size
      ? { blob: file, contentType, extension: extensionFor(contentType) }
      : { blob: optimizedOriginal, contentType: 'image/jpeg', extension: 'jpg' };
    if (original.blob.size > MAX_UPLOAD_BYTES) throw new Error('The photo remains too large after optimization. Choose a smaller image.');
    if (thumbnail.size > MAX_THUMBNAIL_BYTES) throw new Error('The photo thumbnail remains too large. Choose a smaller image.');
    return {
      original,
      thumbnail: { blob: thumbnail, contentType: 'image/jpeg', extension: 'jpg' },
    };
  } finally {
    decoded.dispose();
  }
}

async function fetchDownloadToken(storagePath: string, idToken: string) {
  const bucket = firebaseClientConfig.storageBucket;
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Firebase ${idToken}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'The uploaded photo could not be read.'} (Storage ${response.status})`);
  return downloadToken(parsePayload(text));
}

async function existingDownloadUrl(storagePath: string, idToken: string) {
  const bucket = firebaseClientConfig.storageBucket;
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Firebase ${idToken}` } });
  if (response.status === 404) return undefined;
  const text = await response.text();
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'The stored photo could not be checked.'} (Storage ${response.status})`);
  const token = downloadToken(parsePayload(text));
  return token ? firebaseDownloadUrl(bucket, storagePath, token) : undefined;
}

async function uploadPreparedImage(input: {
  storagePath: string;
  prepared: PreparedImage;
  idToken: string;
  metadata: Record<string, string>;
}) {
  const bucket = firebaseClientConfig.storageBucket;
  const existing = await existingDownloadUrl(input.storagePath, input.idToken);
  if (existing) return existing;
  const metadata = {
    name: input.storagePath,
    contentType: input.prepared.contentType,
    metadata: input.metadata,
  };
  const multipart = multipartBody(metadata, input.prepared.blob, input.prepared.contentType);
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(input.storagePath)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Firebase ${input.idToken}`,
      'Content-Type': multipart.header,
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body: multipart.body,
  });
  const text = await response.text();
  const payload = parsePayload(text);
  if (!response.ok) throw new Error(`${responseMessage(text) ?? 'Firebase Storage rejected the photo.'} (Storage ${response.status})`);
  const token = downloadToken(payload) ?? await fetchDownloadToken(input.storagePath, input.idToken);
  if (!token) throw new Error('The photo uploaded, but Firebase did not return a download link.');
  return firebaseDownloadUrl(bucket, input.storagePath, token);
}

export async function uploadVanToolPhoto(input: UploadVanToolPhotoInput): Promise<InventoryToolPhotoUpload> {
  const bucket = firebaseClientConfig.storageBucket;
  if (!bucket) throw new Error('Firebase Storage is not configured for this deployment.');

  const [session, prepared] = await Promise.all([
    requireFirebaseWebSession(),
    prepareImages(input.file),
  ]);
  const requestId = safeSegment(input.requestId, 'van-tool');
  const vanId = safeSegment(input.vanId, 'van');
  const storagePath = `inventory/van-tool/${requestId}/photo-${vanId}.${prepared.original.extension}`;
  const thumbnailStoragePath = `inventory/van-tool/${requestId}/thumbnail-${vanId}.jpg`;
  const sharedMetadata = {
    scope: 'van-tool',
    entityId: input.requestId,
    evidenceId: input.requestId,
    vanId: input.vanId,
    uploadedByUid: session.uid,
  };
  const [downloadUrl, thumbnailUrl] = await Promise.all([
    uploadPreparedImage({ storagePath, prepared: prepared.original, idToken: session.idToken, metadata: { ...sharedMetadata, variant: 'original' } }),
    uploadPreparedImage({ storagePath: thumbnailStoragePath, prepared: prepared.thumbnail, idToken: session.idToken, metadata: { ...sharedMetadata, variant: 'thumbnail' } }),
  ]);
  return {
    storagePath,
    downloadUrl,
    thumbnailStoragePath,
    thumbnailUrl,
    contentType: prepared.original.contentType,
    sizeBytes: prepared.original.blob.size,
  };
}
