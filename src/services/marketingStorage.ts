import {
  getValidFirebaseSession,
  listFirestoreCollection,
  saveFirestoreDocument,
  updateFirestoreDocument,
} from './firebase';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

export type MarketingCampaignType =
  | 'otro_cliente_contento'
  | 'airco_sales'
  | 'installation'
  | 'service'
  | 'seasonal_heat'
  | 'other';

export type MarketingRecommendedCampaignType = MarketingCampaignType | 'do_not_use';
export type MarketingUploadSessionStatus = 'uploading' | 'ready' | 'partial' | 'failed';
export type MarketingAnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type MarketingShotType =
  | 'customer_handoff'
  | 'installed_unit'
  | 'technician_at_work'
  | 'before_after'
  | 'equipment_detail'
  | 'team'
  | 'vehicle'
  | 'property'
  | 'product'
  | 'unclear'
  | 'other';

export type MarketingUploadSession = {
  id: string;
  name: string;
  campaignType: MarketingCampaignType;
  status: MarketingUploadSessionStatus;
  expectedAssetCount: number;
  uploadedAssetCount: number;
  failedAssetCount: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByName: string;
  analysisStatus?: MarketingAnalysisStatus;
  analysisRequestedAt?: string;
  analysisStartedAt?: string;
  analysisCompletedAt?: string;
  analysisFailedAt?: string;
  analysisSourceKey?: string;
  analysisModel?: string;
  analysisError?: string;
  analyzedAssetCount?: number;
  usableAssetCount?: number;
  primaryAssetId?: string | null;
  bestAssetIds?: string[];
  recommendedCampaignType?: MarketingCampaignType;
};

export type MarketingAsset = {
  id: string;
  sessionId: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  downloadUrl: string;
  thumbnailStoragePath?: string;
  thumbnailUrl?: string;
  status: 'uploaded' | 'analysis_pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  uploadedByUserId: string;
  analysisStatus?: 'processing' | 'completed' | 'failed';
  analysisSourceKey?: string;
  analysisModel?: string;
  analysisError?: string;
  qualityScore?: number;
  marketingSuitabilityScore?: number;
  compositionScore?: number;
  lightingScore?: number;
  sharpnessScore?: number;
  subjectClarityScore?: number;
  brandSafetyScore?: number;
  rankingScore?: number;
  rank?: number;
  recommendedCampaignType?: MarketingRecommendedCampaignType;
  shotType?: MarketingShotType;
  strengths?: string[];
  issues?: string[];
  recommendedUse?: string;
  doNotUse?: boolean;
  rejectionReason?: string;
  containsPerson?: boolean;
  personUsageNote?: string;
  containsReadableSensitiveData?: boolean;
  sensitiveDataNote?: string;
  analysisSummary?: string;
  analyzedAt?: string;
};

export type MarketingStorageUploadResult = {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  thumbnailStoragePath?: string;
  thumbnailUrl?: string;
};

type MarketingAssetUploadInput = {
  uri: string;
  sessionId: string;
  assetId: string;
  fileName?: string | null;
  mimeType?: string | null;
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
  const existing = fileName?.match(/\.([a-zA-Z0-9]{2,6})$/)?.[1];
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
  const boundary = `demac-marketing-${randomToken().replace(/[^a-zA-Z0-9_-]/g, '')}`;
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
    const message = storageResponseMessage(responseText) ?? 'No se pudo obtener el enlace de descarga de la imagen.';
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
    const message = storageResponseMessage(responseText) ?? 'Firebase Storage rechazó la imagen de marketing.';
    throw new Error(`${message} (Storage ${response.status})`);
  }
  const token = downloadTokenFromPayload(payload) ?? await fetchGeneratedDownloadToken(storagePath, idToken);
  if (!token) throw new Error('La imagen subió, pero Firebase no devolvió su enlace de descarga.');
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
      element.onerror = () => reject(new Error('No se pudo preparar la miniatura de la imagen.'));
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

export async function uploadMarketingAssetImage(input: MarketingAssetUploadInput): Promise<MarketingStorageUploadResult> {
  if (!storageBucket) throw new Error('Firebase Storage no está configurado para este entorno.');
  const session = await requireSession();
  const localResponse = await fetch(input.uri);
  if (!localResponse.ok) throw new Error('No se pudo leer la imagen seleccionada.');
  const sourceBlob = await localResponse.blob();
  const contentType = input.mimeType || sourceBlob.type || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.');
  if (sourceBlob.size > 25 * 1024 * 1024) throw new Error('La imagen supera el límite de 25 MB.');

  const sessionId = safeSegment(input.sessionId, 'session');
  const assetId = safeSegment(input.assetId, randomToken());
  const extension = extensionFor(contentType, input.fileName);
  const storagePath = `marketing/originals/${sessionId}/${assetId}.${extension}`;
  const baseMetadata = {
    sessionId: input.sessionId,
    assetId: input.assetId,
    uploadedByUid: session.uid,
    originalFileName: input.fileName || `${assetId}.${extension}`,
  };

  const thumbnailBlob = await imageBlobToJpeg(sourceBlob, 480, 480, 0.72).catch(() => undefined);
  const original = await uploadBlob({
    blob: sourceBlob,
    contentType,
    storagePath,
    metadata: { ...baseMetadata, variant: 'original' },
    idToken: session.idToken,
  });

  if (!thumbnailBlob) return original;

  const thumbnailStoragePath = `marketing/thumbnails/${sessionId}/${assetId}.jpg`;
  const thumbnail = await uploadBlob({
    blob: thumbnailBlob,
    contentType: 'image/jpeg',
    storagePath: thumbnailStoragePath,
    metadata: { ...baseMetadata, variant: 'thumbnail' },
    idToken: session.idToken,
  });

  return {
    ...original,
    thumbnailStoragePath: thumbnail.storagePath,
    thumbnailUrl: thumbnail.downloadUrl,
  };
}

export async function listMarketingUploadSessions() {
  const sessions = await listFirestoreCollection<MarketingUploadSession>('marketingUploadSessions');
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listMarketingAssets() {
  const assets = await listFirestoreCollection<MarketingAsset>('marketingAssets');
  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createMarketingUploadSession(session: MarketingUploadSession) {
  await saveFirestoreDocument('marketingUploadSessions', session);
}

export async function updateMarketingUploadSession(sessionId: string, changes: Partial<Omit<MarketingUploadSession, 'id'>>) {
  await updateFirestoreDocument('marketingUploadSessions', sessionId, changes);
}

export async function requestMarketingAnalysis(sessionId: string) {
  const now = new Date().toISOString();
  await updateMarketingUploadSession(sessionId, {
    analysisStatus: 'queued',
    analysisRequestedAt: now,
    analysisError: undefined,
    updatedAt: now,
  });
}

export async function saveMarketingAsset(asset: MarketingAsset) {
  await saveFirestoreDocument('marketingAssets', asset);
}