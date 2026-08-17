const { buildRenderDirection } = require('./marketingCreativeIntelligenceV4');
const { HARD_FAILURES } = require('./marketingCreativeSkillsV4');
const { providerBenchmarkManifest } = require('./marketingCreativeBenchmarkProvidersV4');

const BENCHMARK_VERSION = 1;
const OUTPUT_SIZE = 1080;
const FOOTER_RESERVED_PX = 156;
const VARIANTS_PER_PROVIDER = 2;

function safeString(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function reconstructCandidate(creative, blueprintEntry) {
  const explored = Array.isArray(creative?.designIntelligence?.exploredConcepts)
    ? creative.designIntelligence.exploredConcepts
    : [];
  const territory = explored.find((item) => item?.id === blueprintEntry?.id) || {};
  return {
    ...territory,
    id: safeString(blueprintEntry?.id, 120),
    name: safeString(blueprintEntry?.name || territory?.name, 180),
    diversityRationale: safeString(blueprintEntry?.diversityRationale, 700),
    blueprint: blueprintEntry?.blueprint || {},
  };
}

function benchmarkCandidates(creative) {
  const blueprints = Array.isArray(creative?.designIntelligence?.selectedBlueprints)
    ? creative.designIntelligence.selectedBlueprints
    : [];
  return blueprints.map((entry) => reconstructCandidate(creative, entry)).filter((item) => item.id && item.blueprint);
}

function exactFromCreative(creative) {
  const exact = creative?.exactText || {};
  return {
    headline: safeString(exact.headline, 300),
    subheadline: safeString(exact.subheadline, 600),
    primaryText: safeString(exact.primaryText, 1200),
    cta: safeString(exact.cta, 240),
    whatsapp: safeString(exact.whatsapp, 120),
    offer: safeString(exact.offer, 500),
    products: Array.isArray(exact.products) ? exact.products : [],
    brandName: safeString(exact.eyebrow || 'DEMAC', 180) || 'DEMAC',
  };
}

function buildProviderBenchmarkPrompt({ creative, candidate }) {
  const brief = creative?.creativeBrief || {};
  const exact = exactFromCreative(creative);
  const renderDirection = buildRenderDirection({
    brief,
    candidate,
    exact,
    footerReservedPx: Number(creative?.reservedFooterPx) || FOOTER_RESERVED_PX,
    outputSize: Number(creative?.width) || OUTPUT_SIZE,
  });
  return [
    'Create a COMPLETE finished 1:1 paid-social advertisement for DEMAC Professional Cooling Solutions by transforming the supplied real HVAC installation photo.',
    'This is a controlled cross-provider benchmark. Follow the strategy and layout blueprint exactly enough to make comparison fair, while using your own strongest native visual capabilities.',
    'Do not imitate another provider or previous candidate. Produce senior-agency advertising craft, not a generic HVAC flyer, poster template, landing-page hero, or dashboard UI.',
    renderDirection,
    '',
    'AUTHENTICITY / PROOF:',
    '- Preserve the real installed condenser, property geometry, workmanship, mounting, and scene identity as genuine evidence.',
    '- Do not fabricate extra HVAC equipment, swap the real unit for a synthetic hero product, or create impossible installation geometry.',
    '- The real installation must remain immediately recognizable and persuasive.',
    '',
    'COPY FIDELITY:',
    '- Render the approved customer-facing strings exactly. Never substitute a more sales-like headline from memory or from generic HVAC advertising.',
    '- Do not add unapproved claims, offers, prices, warranty language, BTU, SEER, voltage, discounts, slogans, or alternate phone numbers.',
    '- If a text element cannot be rendered exactly, simplify the composition rather than inventing different copy.',
    '',
    'CRAFT:',
    '- Use one coherent visual idea with strong hierarchy, typography, crop, negative space, brand integration, CTA clarity, and mobile readability.',
    '- Avoid generic rounded cards, pills, checklists, dark text slabs, template symmetry, and tiny filler copy.',
    '- The output should plausibly compete with paid-social work from a professional creative agency.',
  ].join('\n');
}

function providerBenchmarkQaPrompt({ creative, candidate, providerId, copyAudit }) {
  const brief = creative?.creativeBrief || {};
  const exact = exactFromCreative(creative);
  return [
    'You are an independent benchmark jury comparing an image-generation provider against the same DEMAC campaign brief used by all providers.',
    'Do not reward the provider for merely producing a clean image. Judge real paid-social agency quality and conversion usefulness.',
    `Provider under test: ${providerId}.`,
    `Creative mode: ${safeString(brief.creativeMode, 120)}.`,
    `Creative North Star: ${safeString(brief.creativeNorthStar, 1200)}.`,
    `Conversion goal: ${safeString(brief.conversionGoal, 900)}.`,
    `Primary promise: ${safeString(brief.primaryPromise, 900)}.`,
    `Candidate: ${safeString(candidate?.name, 240)}.`,
    `Expected headline: ${JSON.stringify(exact.headline)}.`,
    `Expected supporting line: ${JSON.stringify(exact.subheadline)}.`,
    `Expected CTA: ${JSON.stringify(exact.cta)}.`,
    `Expected WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    `Independent visible-copy audit: ${JSON.stringify(copyAudit || {})}.`,
    '',
    'VISUAL DESIGN benchmark: composition, typography, professional finish, brand coherence, authentic photo integration, originality, and mobile readability.',
    'PERFORMANCE benchmark: scroll stopping, promise clarity, proof strength, CTA prominence, conversion path, audience relevance, and fit to the selected creative mode.',
    'Hard-fail any candidate that violates the independent copy audit, invents facts, loses the real installation as proof, looks like a generic template, or becomes mainly typography with weak proof.',
    'Non-negotiable hard failures:',
    ...HARD_FAILURES.map((item) => `- ${item}`),
  ].join('\n');
}

function benchmarkPlan(creative) {
  const candidates = benchmarkCandidates(creative);
  if (!candidates.length) throw new Error('Benchmark requires at least one V4 selected blueprint.');
  return {
    version: BENCHMARK_VERSION,
    productionProviderUnchanged: true,
    sourceCreativeId: safeString(creative?.id, 220),
    sourceCreativeVersion: Number(creative?.version) || 0,
    campaignId: safeString(creative?.campaignId, 220),
    creativeMode: safeString(creative?.creativeMode || creative?.creativeBrief?.creativeMode, 120),
    variantsPerProvider: VARIANTS_PER_PROVIDER,
    candidateCount: candidates.length,
    candidates,
    exactText: exactFromCreative(creative),
    providers: providerBenchmarkManifest().providers,
    gate: {
      independentCopyAuditRequired: true,
      visualAndPerformanceQaRequired: true,
      productionCutoverAutomatic: false,
      minimumAgencyPassesBeforePromotion: 2,
    },
  };
}

module.exports = {
  BENCHMARK_VERSION,
  OUTPUT_SIZE,
  FOOTER_RESERVED_PX,
  VARIANTS_PER_PROVIDER,
  reconstructCandidate,
  benchmarkCandidates,
  exactFromCreative,
  buildProviderBenchmarkPrompt,
  providerBenchmarkQaPrompt,
  benchmarkPlan,
};
