'use client';

import { firebaseClientConfig } from './client-config';
import {
  getFirestoreDocument,
  listFirestoreCollection,
  saveFirestoreDocument,
  updateFirestoreDocument,
} from './firestore-rest';
import { requireFirebaseWebSession } from './session';

export type MarketingCampaignType =
  | 'otro_cliente_contento'
  | 'airco_sales'
  | 'installation'
  | 'service'
  | 'seasonal_heat'
  | 'other';

export type MarketingAnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type MarketingUploadError = {
  fileName: string;
  message: string;
};

export type MarketingUploadResult = {
  sessionId: string;
  uploadedAssetCount: number;
  failedAssetCount: number;
  errors: MarketingUploadError[];
};

export type MarketingUploadSession = {
  id: string;
  name: string;
  campaignType: MarketingCampaignType;
  status: 'uploading' | 'ready' | 'partial' | 'failed';
  expectedAssetCount: number;
  uploadedAssetCount: number;
  failedAssetCount: number;
  uploadErrors?: MarketingUploadError[];
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByName: string;
  analysisStatus?: MarketingAnalysisStatus;
  analysisError?: string;
  analyzedAssetCount?: number;
  usableAssetCount?: number;
  primaryAssetId?: string | null;
  bestAssetIds?: string[];
  recommendedCampaignType?: MarketingCampaignType;
  campaignStrategyStatus?: 'processing' | 'completed' | 'failed';
  campaignStrategyId?: string;
  campaignStrategyError?: string;
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
  qualityScore?: number;
  marketingSuitabilityScore?: number;
  compositionScore?: number;
  lightingScore?: number;
  sharpnessScore?: number;
  brandSafetyScore?: number;
  rankingScore?: number;
  rank?: number;
  recommendedCampaignType?: MarketingCampaignType | 'do_not_use';
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
};

export type MarketingCampaign = {
  id: string;
  sessionId: string;
  campaignType: MarketingCampaignType;
  objective: string;
  angle: string;
  targetAction: string;
  heroAssetId: string;
  supportingAssetIds: string[];
  copy: {
    language: 'pap_aw';
    headline: string;
    subheadline: string;
    primaryText: string;
    cta: string;
  };
  visualDirection: {
    heroTreatment: string;
    hierarchy: string[];
    overlayNotes: string[];
    footerInstruction: string;
  };
  factPolicy: {
    priceOrPromoIncluded: boolean;
    factNotes: string[];
  };
  papiamentoValidationStatus: 'passed' | 'needs_review';
  papiamentoUnknownWords: string[];
  papiamentoRevisionAttempted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketingBrandSettings = {
  id: 'default';
  companyName: string;
  brandName: string;
  whatsapp: string;
  primaryContact: string;
  primaryColor: string;
  secondaryColor: string;
  style: string;
  language: string;
  defaultFormat: string;
  footerRule: string;
  realPhotoRule: string;
  approvedClaims: string[];
  approvedProducts: string[];
  approvedOffers: string[];
  approvedPapiamentoPhrases: string[];
  campaignNotes: string[];
  updatedAt?: string;
  updatedByUserId?: string;
  updatedByName?: string;
};

export const DEFAULT_MARKETING_BRAND_SETTINGS: MarketingBrandSettings = {
  id: 'default',
  companyName: 'DEMAC Professional Cooling Solutions',
  brandName: 'DEMAC',
  whatsapp: '564-26-25',
  primaryContact: 'WhatsApp',
  primaryColor: 'Royal Blue',
  secondaryColor: 'White',
  style: 'Premium, modern, clean, professional, high contrast, mobile-first',
  language: 'Papiamento di Aruba',
  defaultFormat: 'Facebook / Instagram Feed · square 1:1 · high resolution',
  footerRule: 'Reserve a sufficiently large clean blank bottom margin for the original DEMAC company footer. Never generate, recreate, redesign, or alter the footer inside the advertisement.',
  realPhotoRule: 'Use real DEMAC customer installation and work photos authentically. Preserve people, installed equipment, surroundings, and official branding unless an edit is explicitly required.',
  approvedClaims: [
    'DEMAC Professional Cooling Solutions — Aruba.',
    'Primary customer contact is WhatsApp 564-26-25.',
    'Adina Optima air conditioners sold by DEMAC are Inverter R32, 220V, SEER 21, with Double Condenser Coil.',
    'A 2-year full-unit warranty may be advertised only when the air conditioner is installed by DEMAC.',
  ],
  approvedProducts: [
    'Adina Optima Inverter R32 — 12,000 BTU — Afl. 699 — 220V — SEER 21 — Double Condenser Coil.',
    'Adina Optima Inverter R32 — 18,000 BTU — Afl. 1,199 — 220V — SEER 21 — Double Condenser Coil.',
    'Adina Optima Inverter R32 — 24,000 BTU — Afl. 1,399 — 220V — SEER 21 — Double Condenser Coil.',
  ],
  approvedOffers: [],
  approvedPapiamentoPhrases: [
    'WhatsApp nos awe mes',
    'Traha bo Cita Awe mes',
    'Service bo Airco',
    'Instala bo Airco Nobo',
    'Stop di drumi den Calor.',
    'Cumpra bo Airco awe mes.',
  ],
  campaignNotes: [
    'Default CTA should direct customers to WhatsApp.',
    'OTRO CLIENTE CONTENTO is an approved social-proof campaign concept.',
    'Keep layouts premium, uncluttered, mobile-readable, and visually focused on real DEMAC work.',
    'Never invent or infer an active promotion. approvedOffers is the only source of promotional claims.',
  ],
};

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeFileName(name: string) {
  const extension = name.includes('.') ? `.${name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${stem}${extension || '.jpg'}`;
}

function normalizedImageContentType(file: File) {
  const browserType = String(file.type || '').trim().toLowerCase();
  if (browserType.startsWith('image/')) return browserType;
  const extension = file.name.split('.').pop()?.trim().toLowerCase() || '';
  const inferred: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jfif: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  const contentType = inferred[extension];
  if (contentType) return contentType;
  throw new Error(`${file.name}: unsupported image format or missing image type. Use JPG, JPEG, PNG, or WebP.`);
}

function readableUploadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown upload error.');
  if (/permission denied/i.test(message)) return 'Firebase Storage denied the upload. Please refresh the ERP and try again; if it repeats, report this exact message.';
  if (/failed to fetch|networkerror|network request/i.test(message)) return 'The browser could not reach Firebase Storage. Check the connection and try again.';
  return message;
}

function parseStoragePayload(text: string) {
  if (!text.trim()) return {} as { downloadTokens?: string; metadata?: Record<string, string>; error?: { message?: string } };
  try { return JSON.parse(text) as { downloadTokens?: string; metadata?: Record<string, string>; error?: { message?: string } }; }
  catch { return {} as { downloadTokens?: string; metadata?: Record<string, string>; error?: { message?: string } }; }
}

async function uploadBlob(path: string, blob: Blob, contentType: string, metadata: Record<string, string>) {
  const bucket = firebaseClientConfig.storageBucket;
  if (!bucket) throw new Error('Firebase Storage is not configured.');
  const session = await requireFirebaseWebSession();
  const boundary = `demac-marketing-${id().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const downloadToken = id();
  const storageMetadata = { ...metadata, firebaseStorageDownloadTokens: downloadToken };
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=utf-8\r\n\r\n',
    JSON.stringify({ name: path, contentType, metadata: storageMetadata }),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body,
  });
  const text = await response.text();
  const payload = parseStoragePayload(text);
  if (!response.ok) {
    const reason = payload.error?.message || text || 'Unknown Firebase Storage error.';
    throw new Error(`Storage upload failed (${response.status}): ${reason}`);
  }
  let token = payload.downloadTokens?.split(',')[0]
    || payload.metadata?.firebaseStorageDownloadTokens?.split(',')[0]
    || downloadToken;
  if (!token) {
    const metadataResponse = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${session.idToken}` },
    });
    const metadataText = await metadataResponse.text();
    const metadataPayload = parseStoragePayload(metadataText);
    token = metadataPayload.downloadTokens?.split(',')[0] || metadataPayload.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
  }
  if (!token) throw new Error('Firebase uploaded the image but did not return a download token.');
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
}

async function thumbnail(file: File) {
  if (typeof document === 'undefined') return null;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not decode image.'));
      element.src = objectUrl;
    });
    const scale = Math.min(480 / image.naturalWidth, 480 / image.naturalHeight, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.76));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadMarketingData() {
  const [sessions, assets, campaigns, brand] = await Promise.all([
    listFirestoreCollection<MarketingUploadSession>('marketingUploadSessions'),
    listFirestoreCollection<MarketingAsset>('marketingAssets'),
    listFirestoreCollection<MarketingCampaign>('marketingCampaigns'),
    getFirestoreDocument<MarketingBrandSettings>('marketingBrandSettings', 'default'),
  ]);
  return {
    sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    assets: assets.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.createdAt.localeCompare(a.createdAt)),
    campaigns: campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    brand: brand ?? DEFAULT_MARKETING_BRAND_SETTINGS,
    brandIsLive: Boolean(brand),
  };
}

export async function createMarketingSessionWithFiles(input: {
  name: string;
  campaignType: MarketingCampaignType;
  files: File[];
  createdByUserId: string;
  createdByName: string;
  onProgress?: (uploaded: number, total: number) => void;
}): Promise<MarketingUploadResult> {
  if (!input.files.length) throw new Error('Choose at least one image.');
  const sessionId = id();
  const now = new Date().toISOString();
  const session: MarketingUploadSession = {
    id: sessionId,
    name: input.name.trim() || `Marketing upload ${new Date().toLocaleDateString()}`,
    campaignType: input.campaignType,
    status: 'uploading',
    expectedAssetCount: input.files.length,
    uploadedAssetCount: 0,
    failedAssetCount: 0,
    uploadErrors: [],
    createdAt: now,
    updatedAt: now,
    createdByUserId: input.createdByUserId,
    createdByName: input.createdByName,
  };
  await saveFirestoreDocument('marketingUploadSessions', session);
  let uploaded = 0;
  let failed = 0;
  const errors: MarketingUploadError[] = [];
  for (const file of input.files) {
    try {
      const contentType = normalizedImageContentType(file);
      if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} exceeds 25 MB.`);
      const assetId = id();
      const fileName = safeFileName(file.name);
      const originalPath = `marketing/originals/${sessionId}/${assetId}-${fileName}`;
      const originalUrl = await uploadBlob(originalPath, file, contentType, {
        sessionId,
        assetId,
        uploadedByUid: input.createdByUserId,
        originalFileName: file.name,
        variant: 'original',
      });
      const thumb = await thumbnail(file).catch(() => null);
      let thumbnailUrl: string | undefined;
      let thumbnailStoragePath: string | undefined;
      if (thumb) {
        thumbnailStoragePath = `marketing/thumbnails/${sessionId}/${assetId}.jpg`;
        thumbnailUrl = await uploadBlob(thumbnailStoragePath, thumb, 'image/jpeg', {
          sessionId,
          assetId,
          uploadedByUid: input.createdByUserId,
          originalFileName: file.name,
          variant: 'thumbnail',
        }).catch(() => undefined);
      }
      const createdAt = new Date().toISOString();
      await saveFirestoreDocument<MarketingAsset>('marketingAssets', {
        id: assetId,
        sessionId,
        originalFileName: file.name,
        contentType,
        sizeBytes: file.size,
        storagePath: originalPath,
        downloadUrl: originalUrl,
        thumbnailStoragePath,
        thumbnailUrl,
        status: 'uploaded',
        createdAt,
        updatedAt: createdAt,
        uploadedByUserId: input.createdByUserId,
      });
      uploaded += 1;
    } catch (error) {
      const uploadError = { fileName: file.name, message: readableUploadError(error) };
      console.error('Marketing upload failed:', uploadError.fileName, uploadError.message);
      errors.push(uploadError);
      failed += 1;
    }
    input.onProgress?.(uploaded + failed, input.files.length);
    await updateFirestoreDocument('marketingUploadSessions', sessionId, {
      uploadedAssetCount: uploaded,
      failedAssetCount: failed,
      uploadErrors: errors.slice(-12),
      status: uploaded === input.files.length ? 'ready' : failed > 0 && uploaded > 0 ? 'partial' : failed === input.files.length ? 'failed' : 'uploading',
      updatedAt: new Date().toISOString(),
    });
  }
  return { sessionId, uploadedAssetCount: uploaded, failedAssetCount: failed, errors };
}

async function callMarketingFunction(name: 'requestMarketingImageAnalysis' | 'requestMarketingCampaignStrategy', sessionId: string) {
  const session = await requireFirebaseWebSession();
  const response = await fetch(`https://us-central1-demac-corporation.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { sessionId } }),
  });
  const text = await response.text();
  let payload: { result?: Record<string, unknown>; data?: Record<string, unknown>; error?: { message?: string } } = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
  if (!response.ok || payload.error) throw new Error(payload.error?.message || text || `${name} failed (${response.status}).`);
  return payload.result ?? payload.data ?? {};
}

export function requestMarketingImageAnalysis(sessionId: string) {
  return callMarketingFunction('requestMarketingImageAnalysis', sessionId);
}

export function requestMarketingCampaignStrategy(sessionId: string) {
  return callMarketingFunction('requestMarketingCampaignStrategy', sessionId);
}

export async function saveMarketingBrandSettings(settings: MarketingBrandSettings, updatedByUserId: string, updatedByName: string) {
  const now = new Date().toISOString();
  const next: MarketingBrandSettings = { ...settings, id: 'default', updatedAt: now, updatedByUserId, updatedByName };
  await saveFirestoreDocument('marketingBrandSettings', next);
  await saveFirestoreDocument('papiamentoCorrections', {
    id: 'marketing-brand-approved-phrases',
    sectionKey: 'marketing_brand_center',
    sourceText: 'DEMAC approved marketing phrases',
    generatedText: '',
    correctedText: next.approvedPapiamentoPhrases.join('\n'),
    active: true,
    createdAt: now,
    updatedAt: now,
    approvedByUserId: updatedByUserId,
    approvedByName: updatedByName,
  });
  return next;
}
