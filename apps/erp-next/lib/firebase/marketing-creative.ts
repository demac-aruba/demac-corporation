'use client';

import { requireFirebaseWebSession } from './session';

export type MarketingCreativeStatus = 'qa_passed' | 'qa_failed' | 'needs_review' | 'approved';

export type MarketingCreativeProduct = {
  source: string;
  btu: string;
  price: string;
  specs: string;
};

export type MarketingCreativeQa = {
  source: string;
  status: 'passed' | 'failed' | 'needs_review' | string;
  score: number;
  selectionScore?: number;
  overallScore?: number;
  benchmarkLevel?: 'amateur' | 'competent' | 'professional' | 'agency' | 'top_tier' | string;
  adSpendReady?: boolean;
  visibleTextExact?: boolean;
  inventedFacts?: boolean;
  creativeDirection?: number;
  composition?: number;
  typography?: number;
  professionalFinish?: number;
  brandDistinctiveness?: number;
  conversionClarity?: number;
  textFidelity?: number;
  footerSafety?: number;
  originality?: number;
  thumbnailImpact?: number;
  mobileLegibility: number;
  visualHierarchy: number;
  contrast: number;
  footerClearance: number;
  authenticity: number;
  professionalism: number;
  creativeQuality?: number;
  scrollStoppingPower?: number;
  agencyFeel?: number;
  photoIntegration?: number;
  ctaProminence?: number;
  visualSophistication?: number;
  commercialCompleteness?: number;
  layoutRichness?: number;
  brandSystemCoherence?: number;
  offerClarity?: number;
  attempt: number;
  amateurSignals?: string[];
  issues: string[];
  revisionInstructions: string[];
  hardChecks?: {
    brandCenterLive: boolean;
    languagePassed: boolean;
    exactWhatsapp: boolean;
    productFactsApproved: boolean;
    footerReserved: boolean;
    allPassed: boolean;
  } | null;
};

export type MarketingCreativeVariant = {
  id: string;
  conceptId: string;
  name: string;
  rationale: string;
  stage?: string;
  parentVariantId?: string;
  imageStoragePath?: string;
  imageUrl: string;
  imageModel?: string;
  selectionScore?: number;
  revised?: boolean;
  layout?: {
    headlineZone?: string;
    ctaZone?: string;
    textPanelStyle?: string;
    textAlign?: string;
    accentStyle?: string;
    photoFocus?: string;
    compositionTemplate?: string;
    visualEnergy?: string;
    graphicLanguage?: string;
    typographyDirection?: string;
    persuasionMechanism?: string;
    thumbnailIdea?: string;
  };
  qa: MarketingCreativeQa;
};

export type MarketingCreative = {
  id: string;
  sessionId: string;
  campaignId: string;
  campaignType: string;
  version: number;
  status: MarketingCreativeStatus | string;
  builderVersion?: string;
  heroAssetId: string;
  imageStoragePath?: string;
  imageUrl: string;
  approvedUrl?: string;
  width: number;
  height: number;
  reservedFooterPx: number;
  renderTemplate: string;
  renderMode: string;
  artDirectorModel?: string;
  imageModel?: string;
  qaModel?: string;
  selectedVariantId?: string;
  variantCount?: number;
  autoRevised?: boolean;
  variants?: MarketingCreativeVariant[];
  providerManifest?: {
    activeProvider?: string;
    activeImageModel?: string;
    providers?: {
      openai_full_design?: boolean;
      ideogram_v4_structured?: boolean;
      canva_layered_production?: boolean;
    };
    notes?: string[];
  };
  designIntelligence?: {
    explorationCount?: number;
    shortlistCount?: number;
    refinementCount?: number;
    strategyDiagnosis?: string;
    benchmarkDefinition?: string;
    creativeNorthStar?: string;
    exploredConcepts?: Array<{
      id?: string;
      name?: string;
      archetype?: string;
      thumbnailIdea?: string;
      whyItCouldWin?: string;
    }>;
    finalJury?: {
      spendConfidence?: number;
      reason?: string;
      loserWeakness?: string;
    };
  };
  artDirection?: {
    campaignSummary?: string;
    creativeNorthStar?: string;
  };
  exactText: {
    headline: string;
    subheadline: string;
    primaryText?: string;
    cta: string;
    whatsapp: string;
    offer: string;
    eyebrow?: string;
    proofLabel?: string;
    supportPoints?: string[];
    products: MarketingCreativeProduct[];
  };
  captionText: string;
  papiamentoValidationStatus: string;
  qa: MarketingCreativeQa;
  approvedAt?: string;
  approvedByName?: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
};

type CallablePayload = {
  result?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: { message?: string };
};

async function callCreativeFunction(name: 'requestMarketingCreativeBuild' | 'approveMarketingCreative' | 'getMarketingCreativeState', data: Record<string, unknown>) {
  const session = await requireFirebaseWebSession();
  const response = await fetch(`https://us-central1-demac-corporation.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });
  const text = await response.text();
  let payload: CallablePayload = {};
  try { payload = text ? JSON.parse(text) as CallablePayload : {}; } catch { /* handled below */ }
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || text || `${name} failed (${response.status}).`);
  }
  return payload.result ?? payload.data ?? {};
}

export async function listMarketingCreatives(sessionId?: string) {
  const result = await callCreativeFunction('getMarketingCreativeState', sessionId ? { sessionId } : {});
  return {
    creatives: Array.isArray(result.creatives) ? result.creatives as MarketingCreative[] : [],
    approvedCount: Number(result.approvedCount) || 0,
    qaPassedCount: Number(result.qaPassedCount) || 0,
  };
}

export async function requestMarketingCreativeBuild(sessionId: string) {
  return callCreativeFunction('requestMarketingCreativeBuild', { sessionId });
}

export async function approveMarketingCreative(creativeId: string) {
  return callCreativeFunction('approveMarketingCreative', { creativeId });
}
