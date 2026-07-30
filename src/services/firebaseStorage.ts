import { getValidFirebaseSession } from './firebase';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

export type StorageUploadResult = {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  thumbnailStoragePath?: string;
  thumbnailUrl?: string;
  thumbnailContentType?: string;
  thumbnailSizeBytes?: number;
};

type UploadEvidenceInput = {
  uri: string;
  workOrderId: string;
  unitId?: string;
  evidenceId: string;
  mimeType?: string | null;
  fileName?: string | null;
};

type UploadVoiceNoteInput = {
  uri: string;
  workOrderId: string;
  unitId?: string;
  evidenceId: string;
  durationSeconds: number;
  mimeType?: string | null;
};

type ExistingEvidenceThumbnailInput = {
  downloadUrl: string;
  storagePath: string;
  workOrderId: string;
  unitId?: string;
  evidenceId: string;
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

function audioExtensionFor(contentType: string, uri: string) {
  const existing = uri.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/)?.[1];
  if (existing) return existing.toLowerCase();
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('3gpp')) return '3gp';
  if (contentType.includes('mpeg')) return 'mp3';
  return 'm4a';
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

function parseStoragePayload(responseText: string): FirebaseStoragePayload | undefined {
  if (!responseText.trim()) return undefined;
  try {
    return JSON.parse(responseText) as FirebaseStoragePayload;
  } catch {
    return undefined;
  }
}

function storageResponseMessage(responseText: string) {
  const payload = parseStoragePayload(responseText);
  const fallback = responseText.trim();
  return payload?.error?.message ?? payload?.message ?? (fallback || undefined);
}

function downloadTokenFromPayload(payload?: FirebaseStoragePayload) {
  const rawToken = payload?.downloadTokens ?? payload?.metadata?.firebaseStorageDownloadTokens;
  if (Array.isArray(rawToken)) return rawToken[0];
  return rawToken?.split(',')[0];
}

async function fetchGeneratedDownloadToken(storagePath: string, idToken: string) {
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o/${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${idToken}` } });
  const responseText = await response.text();
  if (!response.ok) {
    const message = storageResponseMessage(responseText) ?? 'No se pudo obtener el enlace de descarga de la fotografía.';
    throw new Error(`${message} (Storage ${response.status})`);
  }
  return downloadTokenFromPayload(parseStoragePayload(responseText));
}

async function uploadBlob({
  blob,
  contentType,
  storagePath,
  metadata,
  idToken,
}: {
  blob: Blob;
  contentType: string;
  storagePath: string;
  metadata: Record<string, string>;
  idToken: string;
}) {
  const multipart = buildMultipartUploadBody({ name: storagePath, contentType, metadata }, blob, contentType);
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o?name=${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': multipart.contentTypeHeader,
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body: multipart.body,
  });
  const responseText = await response.text();
  const payload = parseStoragePayload(responseText);
  if (!response.ok) {
    const message = storageResponseMessage(responseText) ?? 'Firebase Storage rechazó la fotografía.';
    throw new Error(`${message} (Storage ${response.status})`);
  }
  const token = downloadTokenFromPayload(payload) ?? await fetchGeneratedDownloadToken(storagePath, idToken);
  if (!token) throw new Error('La fotografía subió, pero Firebase no devolvió su enlace de descarga.');
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
  return { storagePath, downloadUrl, contentType, sizeBytes: blob.size };
}

async function imageBlobToJpeg(blob: Blob, maxWidth: number, maxHeight: number, quality: number) {
  if (typeof document === 'undefined') return undefined;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = document.createElement('img');
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo preparar la miniatura de la fotografía.'));
      element.src = objectUrl;
    });
    const ratio = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob | undefined>((resolve) => canvas.toBlob((result) => resolve(result ?? undefined), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareReportImage(source: Blob) {
  if (source.size > 25 * 1024 * 1024) throw new Error('La fotografía supera el límite de 25 MB antes de optimizarla.');
  if (source.size < 350 * 1024) return { blob: source, contentType: source.type || 'image/jpeg' };
  const optimized = await imageBlobToJpeg(source, 1600, 1600, 0.76).catch(() => undefined);
  if (!optimized || optimized.size >= source.size) return { blob: source, contentType: source.type || 'image/jpeg' };
  return { blob: optimized, contentType: 'image/jpeg' };
}

function thumbnailPathFromOriginal(storagePath: string, evidenceId: string) {
  const slash = storagePath.lastIndexOf('/');
  const directory = slash >= 0 ? storagePath.slice(0, slash) : 'work-orders';
  return `${directory}/${safeSegment(evidenceId, randomToken())}-thumbnail.jpg`;
}

export async function uploadWorkOrderEvidenceImage(input: UploadEvidenceInput): Promise<StorageUploadResult> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const session = await requireSession();
  const localResponse = await fetch(input.uri);
  if (!localResponse.ok) throw new Error('No se pudo leer la fotografía seleccionada.');
  const sourceBlob = await localResponse.blob();
  const sourceContentType = input.mimeType || sourceBlob.type || 'image/jpeg';
  if (!sourceContentType.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.');
  const prepared = await prepareReportImage(sourceBlob);
  const blob = prepared.blob;
  const contentType = prepared.contentType;
  if (blob.size > 12 * 1024 * 1024) throw new Error('La fotografía optimizada supera el límite de 12 MB.');

  const extension = extensionFor(contentType, prepared.blob === sourceBlob ? input.fileName : null);
  const workOrderId = safeSegment(input.workOrderId, 'work-order');
  const unitId = safeSegment(input.unitId || 'general', 'general');
  const evidenceId = safeSegment(input.evidenceId, randomToken());
  const storagePath = `work-orders/${workOrderId}/${unitId}/${evidenceId}.${extension}`;
  const metadata = {
    workOrderId: input.workOrderId,
    unitId: input.unitId || 'general',
    evidenceId: input.evidenceId,
    uploadedByUid: session.uid,
  };

  const thumbnailBlob = await imageBlobToJpeg(blob, 360, 270, 0.62).catch(() => undefined);
  if (!thumbnailBlob) {
    return uploadBlob({ blob, contentType, storagePath, metadata: { ...metadata, variant: 'report' }, idToken: session.idToken });
  }

  const thumbnailStoragePath = thumbnailPathFromOriginal(storagePath, input.evidenceId);
  const [original, thumbnail] = await Promise.all([
    uploadBlob({ blob, contentType, storagePath, metadata: { ...metadata, variant: 'report' }, idToken: session.idToken }),
    uploadBlob({
      blob: thumbnailBlob,
      contentType: 'image/jpeg',
      storagePath: thumbnailStoragePath,
      metadata: { ...metadata, variant: 'thumbnail' },
      idToken: session.idToken,
    }),
  ]);

  return {
    ...original,
    thumbnailStoragePath: thumbnail?.storagePath,
    thumbnailUrl: thumbnail?.downloadUrl,
    thumbnailContentType: thumbnail?.contentType,
    thumbnailSizeBytes: thumbnail?.sizeBytes,
  };
}

export async function createExistingEvidenceThumbnail(input: ExistingEvidenceThumbnailInput) {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const session = await requireSession();
  const response = await fetch(input.downloadUrl);
  if (!response.ok) throw new Error('No se pudo descargar la fotografía original para crear su miniatura.');
  const originalBlob = await response.blob();
  const thumbnailBlob = await imageBlobToJpeg(originalBlob, 360, 270, 0.62);
  if (!thumbnailBlob) throw new Error('El navegador no pudo crear la miniatura.');
  const thumbnailStoragePath = thumbnailPathFromOriginal(input.storagePath, input.evidenceId);
  const thumbnail = await uploadBlob({
    blob: thumbnailBlob,
    contentType: 'image/jpeg',
    storagePath: thumbnailStoragePath,
    metadata: {
      workOrderId: input.workOrderId,
      unitId: input.unitId || 'general',
      evidenceId: input.evidenceId,
      uploadedByUid: session.uid,
      variant: 'thumbnail',
    },
    idToken: session.idToken,
  });
  return {
    thumbnailStoragePath: thumbnail.storagePath,
    thumbnailUrl: thumbnail.downloadUrl,
    thumbnailContentType: thumbnail.contentType,
    thumbnailSizeBytes: thumbnail.sizeBytes,
  };
}

export async function uploadWorkOrderVoiceNote(input: UploadVoiceNoteInput): Promise<StorageUploadResult> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  if (input.durationSeconds <= 0 || input.durationSeconds > 120.5) {
    throw new Error('La nota de voz debe durar un máximo de 2 minutos.');
  }
  const session = await requireSession();
  const response = await fetch(input.uri);
  if (!response.ok) throw new Error('No se pudo leer la nota de voz grabada.');
  const blob = await response.blob();
  const contentType = input.mimeType || blob.type || 'audio/mp4';
  if (!contentType.startsWith('audio/')) throw new Error('El archivo grabado no es una nota de voz válida.');
  if (blob.size > 6 * 1024 * 1024) throw new Error('La nota de voz supera el límite de 6 MB.');

  const workOrderId = safeSegment(input.workOrderId, 'work-order');
  const unitId = safeSegment(input.unitId || 'general', 'general');
  const evidenceId = safeSegment(input.evidenceId, randomToken());
  const storagePath = `work-orders/${workOrderId}/${unitId}/${evidenceId}.${audioExtensionFor(contentType, input.uri)}`;
  return uploadBlob({
    blob,
    contentType,
    storagePath,
    metadata: {
      workOrderId: input.workOrderId,
      unitId: input.unitId || 'general',
      evidenceId: input.evidenceId,
      uploadedByUid: session.uid,
      mediaKind: 'audio',
      durationSeconds: String(Math.round(input.durationSeconds)),
    },
    idToken: session.idToken,
  });
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
