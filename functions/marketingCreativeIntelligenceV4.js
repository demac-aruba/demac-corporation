const {
  CREATIVE_MODES,
  buildV4SkillContext,
} = require('./marketingCreativeSkillsV4');

const EXPLORATION_COUNT = 12;
const SHORTLIST_COUNT = 4;
const TERRITORY_IDS = Array.from({ length: EXPLORATION_COUNT }, (_, index) => `territory_${String(index + 1).padStart(2, '0')}`);
const MODE_VALUES = Object.values(CREATIVE_MODES);

function safeString(value, max = 1600) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function compactList(value, maxItems = 8, maxLen = 260) {
  return Array.isArray(value) ? value.map((item) => safeString(item, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}

function deterministicModeHint({ campaign = {}, exact = {}, hero = {} }) {
  const type = safeString(campaign.campaignType, 120).toLowerCase();
  const objective = `${safeString(campaign.objective, 500)} ${safeString(campaign.angle, 500)}`.toLowerCase();
  const hasOffer = Boolean(exact.offer);
  const hasProducts = Array.isArray(exact.products) && exact.products.length > 0;
  const photo = `${safeString(hero.analysisSummary, 900)} ${safeString(hero.assetType, 120)}`.toLowerCase();
  if (hasOffer) return CREATIVE_MODES.OFFER;
  if (type === 'airco_sales' && hasProducts) return CREATIVE_MODES.PRODUCT;
  if (/installation|install|instalacion|instalación|completed|trabou|workmanship/.test(`${type} ${objective} ${photo}`)) return CREATIVE_MODES.PROOF;
  if (/maintenance|service|repair|heat|calor|dirty|sucio|problem|error|consumption|consumo/.test(`${type} ${objective}`)) return CREATIVE_MODES.PROBLEM_SOLUTION;
  if (/educat|explain|tip|why|how|porque|consejo/.test(objective)) return CREATIVE_MODES.EDUCATIONAL;
  if (/trust|authority|experience|fleet|team|commercial|professional/.test(objective)) return CREATIVE_MODES.BRAND_AUTHORITY;
  return CREATIVE_MODES.PROOF;
}

const CAMPAIGN_INTELLIGENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'creativeMode', 'modeConfidence', 'modeReason', 'conversionGoal', 'targetAudience',
    'primaryPromise', 'supportingProof', 'persuasionMechanism', 'heroAssetRole', 'brandRole',
    'visualPriority', 'mandatoryInformation', 'optionalInformation', 'forbiddenClaims',
    'authenticityConstraints', 'mobileRequirements', 'creativeNorthStar',
  ],
  properties: {
    creativeMode: { type: 'string', enum: MODE_VALUES },
    modeConfidence: { type: 'integer', minimum: 0, maximum: 100 },
    modeReason: { type: 'string' },
    conversionGoal: { type: 'string' },
    targetAudience: { type: 'string' },
    primaryPromise: { type: 'string' },
    supportingProof: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
    persuasionMechanism: { type: 'string' },
    heroAssetRole: { type: 'string' },
    brandRole: { type: 'string' },
    visualPriority: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
    mandatoryInformation: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string' } },
    optionalInformation: { type: 'array', maxItems: 8, items: { type: 'string' } },
    forbiddenClaims: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
    authenticityConstraints: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string' } },
    mobileRequirements: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } },
    creativeNorthStar: { type: 'string' },
  },
};

const TERRITORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['benchmarkDefinition', 'territories'],
  properties: {
    benchmarkDefinition: { type: 'string' },
    territories: {
      type: 'array',
      minItems: EXPLORATION_COUNT,
      maxItems: EXPLORATION_COUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'name', 'persuasionMechanism', 'heroTreatment', 'composition', 'typographyBehavior',
          'graphicLanguage', 'ctaStrategy', 'proofStrategy', 'whyItMayConvert', 'distinctnessAxis', 'risk',
        ],
        properties: {
          id: { type: 'string', enum: TERRITORY_IDS },
          name: { type: 'string' },
          persuasionMechanism: { type: 'string' },
          heroTreatment: { type: 'string' },
          composition: { type: 'string' },
          typographyBehavior: { type: 'string' },
          graphicLanguage: { type: 'string' },
          ctaStrategy: { type: 'string' },
          proofStrategy: { type: 'string' },
          whyItMayConvert: { type: 'string' },
          distinctnessAxis: { type: 'string' },
          risk: { type: 'string' },
        },
      },
    },
  },
};

const DIVERSITY_BLUEPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['portfolioRationale', 'selected'],
  properties: {
    portfolioRationale: { type: 'string' },
    selected: {
      type: 'array',
      minItems: SHORTLIST_COUNT,
      maxItems: SHORTLIST_COUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'whySelected', 'diversityRationale', 'blueprint'],
        properties: {
          id: { type: 'string', enum: TERRITORY_IDS },
          whySelected: { type: 'string' },
          diversityRationale: { type: 'string' },
          blueprint: {
            type: 'object',
            additionalProperties: false,
            required: [
              'heroRegion', 'heroSharePercent', 'headlineRegion', 'headlineMaxLines', 'supportRegion',
              'ctaRegion', 'brandRegion', 'proofRegion', 'typographyScale', 'negativeSpacePlan',
              'cropInstruction', 'primaryGraphicDevice', 'mobileReadSequence', 'footerExclusion',
              'mustPreserve', 'mustAvoid',
            ],
            properties: {
              heroRegion: { type: 'string' },
              heroSharePercent: { type: 'integer', minimum: 35, maximum: 80 },
              headlineRegion: { type: 'string' },
              headlineMaxLines: { type: 'integer', minimum: 1, maximum: 4 },
              supportRegion: { type: 'string' },
              ctaRegion: { type: 'string' },
              brandRegion: { type: 'string' },
              proofRegion: { type: 'string' },
              typographyScale: { type: 'string' },
              negativeSpacePlan: { type: 'string' },
              cropInstruction: { type: 'string' },
              primaryGraphicDevice: { type: 'string' },
              mobileReadSequence: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
              footerExclusion: { type: 'string' },
              mustPreserve: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string' } },
              mustAvoid: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

function campaignIntelligencePrompt({ core, exact, previousIssues = [], footerReservedPx = 156, outputSize = 1080 }) {
  const { campaign, brand, hero } = core;
  const hint = deterministicModeHint({ campaign, exact, hero });
  const footerPercent = Math.ceil((footerReservedPx / outputSize) * 100);
  return [
    'You are the strategy lead of a senior performance-marketing and art-direction team.',
    'Before any image generation, diagnose what KIND of paid-social advertisement this campaign needs and compile a production-grade creative brief.',
    'Choose exactly one creativeMode from the allowed modes. Choose based on conversion objective, approved facts, and the strongest evidence in the supplied real image.',
    `Deterministic evidence-based mode hint: ${hint}. You may override it only when the campaign facts clearly justify another mode, and explain why.`,
    'Do not solve the layout yet. Define the conversion job, promise, proof, role of the real photo, role of brand, information hierarchy, authenticity rules, and mobile requirements.',
    'If the source is a real completed installation, authenticity is valuable proof and must not be sacrificed merely to make the work look more synthetic or artistic.',
    `The bottom ${footerPercent}% is reserved for the original DEMAC footer and cannot carry critical content.`,
    `Campaign type: ${safeString(campaign.campaignType, 120)}.`,
    `Objective: ${safeString(campaign.objective, 700)}.`,
    `Angle: ${safeString(campaign.angle, 700)}.`,
    `Headline: ${JSON.stringify(exact.headline)}.`,
    `Supporting line: ${JSON.stringify(exact.subheadline)}.`,
    `CTA: ${JSON.stringify(exact.cta)}.`,
    `WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    exact.offer ? `Approved offer: ${JSON.stringify(exact.offer)}.` : 'No offer is approved.',
    exact.products?.length ? `Approved products/facts: ${JSON.stringify(exact.products)}.` : 'No product-price facts are approved for this creative.',
    `Hero analysis: ${safeString(hero.analysisSummary, 1100)}.`,
    `Brand style: ${safeString(brand.style, 700)}.`,
    previousIssues.length ? `Previous rejection feedback: ${JSON.stringify(previousIssues.slice(0, 10))}.` : '',
    '',
    buildV4SkillContext({ mode: hint, campaign, brand, previousIssues }),
    '',
    'The creativeNorthStar must be a short decision rule that later designers can use to reject attractive but strategically wrong executions.',
  ].filter(Boolean).join('\n');
}

async function compileCampaignIntelligence({ core, exact, heroBuffer, previousIssues = [], footerReservedPx, outputSize, structuredResponse, model }) {
  const parsed = await structuredResponse({
    model,
    prompt: campaignIntelligencePrompt({ core, exact, previousIssues, footerReservedPx, outputSize }),
    schemaName: 'demac_creative_v4_campaign_intelligence',
    schema: CAMPAIGN_INTELLIGENCE_SCHEMA,
    imageBuffers: [heroBuffer],
  });
  const mode = MODE_VALUES.includes(parsed.creativeMode) ? parsed.creativeMode : deterministicModeHint({ campaign: core.campaign, exact, hero: core.hero });
  return {
    creativeMode: mode,
    modeConfidence: Number(parsed.modeConfidence) || 0,
    modeReason: safeString(parsed.modeReason, 900),
    conversionGoal: safeString(parsed.conversionGoal, 500),
    targetAudience: safeString(parsed.targetAudience, 500),
    primaryPromise: safeString(parsed.primaryPromise, 500),
    supportingProof: compactList(parsed.supportingProof, 6, 320),
    persuasionMechanism: safeString(parsed.persuasionMechanism, 600),
    heroAssetRole: safeString(parsed.heroAssetRole, 500),
    brandRole: safeString(parsed.brandRole, 500),
    visualPriority: compactList(parsed.visualPriority, 6, 240),
    mandatoryInformation: compactList(parsed.mandatoryInformation, 10, 240),
    optionalInformation: compactList(parsed.optionalInformation, 8, 240),
    forbiddenClaims: compactList(parsed.forbiddenClaims, 10, 260),
    authenticityConstraints: compactList(parsed.authenticityConstraints, 10, 280),
    mobileRequirements: compactList(parsed.mobileRequirements, 8, 260),
    creativeNorthStar: safeString(parsed.creativeNorthStar, 900),
  };
}

function explorationPrompt({ brief, core, exact, previousIssues = [] }) {
  const { campaign, brand, hero } = core;
  return [
    'You are the concept wall team at a high-end performance creative agency.',
    `Create exactly ${EXPLORATION_COUNT} materially different paid-social creative territories before any expensive image rendering.`,
    `The campaign has already been diagnosed as ${brief.creativeMode}; do not drift into another ad type merely because it looks fashionable.`,
    `Creative North Star: ${brief.creativeNorthStar}`,
    `Conversion goal: ${brief.conversionGoal}`,
    `Primary promise: ${brief.primaryPromise}`,
    `Supporting proof: ${JSON.stringify(brief.supportingProof)}`,
    `Hero role: ${brief.heroAssetRole}`,
    `Persuasion mechanism: ${brief.persuasionMechanism}`,
    'Every territory must differ visibly at thumbnail size in hero treatment, crop, composition, typography behavior, graphic language, CTA strategy, and proof strategy.',
    'Do not create twelve versions of a blue panel, giant headline, checklist cards, or white boxes over a photo.',
    'Some territories may be quiet and premium, others bold, documentary, architectural, retail, editorial, kinetic, or conversion-forward — but all must remain strategically correct for the selected mode.',
    `Exact headline: ${JSON.stringify(exact.headline)}; CTA: ${JSON.stringify(exact.cta)}; WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    `Hero analysis: ${safeString(hero.analysisSummary, 900)}.`,
    `Campaign angle: ${safeString(campaign.angle, 500)}.`,
    '',
    buildV4SkillContext({ mode: brief.creativeMode, campaign, brand, previousIssues }),
    '',
    'whyItMayConvert must link the visual idea to attention, comprehension, trust, persuasion, or action. distinctnessAxis must name what makes this concept structurally different from the rest.',
  ].join('\n');
}

async function exploreTerritories({ brief, core, exact, previousIssues = [], structuredResponse, model }) {
  const parsed = await structuredResponse({
    model,
    prompt: explorationPrompt({ brief, core, exact, previousIssues }),
    schemaName: 'demac_creative_v4_territories',
    schema: TERRITORY_SCHEMA,
  });
  const byId = new Map((parsed.territories || []).map((item) => [item.id, item]));
  const territories = TERRITORY_IDS.map((id) => byId.get(id)).filter(Boolean).map((item) => ({
    id: item.id,
    name: safeString(item.name, 160),
    persuasionMechanism: safeString(item.persuasionMechanism, 500),
    heroTreatment: safeString(item.heroTreatment, 500),
    composition: safeString(item.composition, 500),
    typographyBehavior: safeString(item.typographyBehavior, 500),
    graphicLanguage: safeString(item.graphicLanguage, 500),
    ctaStrategy: safeString(item.ctaStrategy, 500),
    proofStrategy: safeString(item.proofStrategy, 500),
    whyItMayConvert: safeString(item.whyItMayConvert, 600),
    distinctnessAxis: safeString(item.distinctnessAxis, 400),
    risk: safeString(item.risk, 400),
  }));
  if (territories.length !== EXPLORATION_COUNT) throw new Error('V4 exploration did not return all twelve territories.');
  const distinctAxes = new Set(territories.map((item) => item.distinctnessAxis.toLowerCase()).filter(Boolean));
  if (distinctAxes.size < 8) throw new Error('V4 exploration failed the diversity pre-check: too many territories share the same distinctness axis.');
  return { benchmarkDefinition: safeString(parsed.benchmarkDefinition, 1100), territories };
}

function diversityBlueprintPrompt({ brief, exploration, core, exact, footerReservedPx = 156, outputSize = 1080, previousIssues = [] }) {
  const { campaign, brand } = core;
  const footerPercent = Math.ceil((footerReservedPx / outputSize) * 100);
  return [
    'You are the executive creative director and layout director reviewing twelve concepts before paid image production.',
    `Select exactly ${SHORTLIST_COUNT} territories. They must form a visually diverse portfolio, not four stylistic cousins.`,
    'Reject generic flyers, web UI, poster-only ideas with weak conversion structure, and concepts that hide or damage the campaign evidence.',
    `Campaign mode: ${brief.creativeMode}. Creative North Star: ${brief.creativeNorthStar}.`,
    `Benchmark: ${exploration.benchmarkDefinition}.`,
    `Mandatory information: ${JSON.stringify(brief.mandatoryInformation)}.`,
    `Authenticity constraints: ${JSON.stringify(brief.authenticityConstraints)}.`,
    `Mobile requirements: ${JSON.stringify(brief.mobileRequirements)}.`,
    `Exact headline: ${JSON.stringify(exact.headline)}; CTA: ${JSON.stringify(exact.cta)}; WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    `Bottom ${footerPercent}% is an absolute footer exclusion zone.`,
    brief.creativeMode === CREATIVE_MODES.PROOF ? 'PROOF MODE HARD RULE: the real job must remain the dominant credibility anchor; target roughly 60–75% hero authority and do not let typography turn the piece into a poster.' : '',
    'For each selected concept create a concrete layout blueprint. The blueprint is direction for an image model, not SVG instructions and not a web-grid specification.',
    'mobileReadSequence must describe what the viewer understands first, second, third, etc. primaryGraphicDevice must be ONE coherent device, not a list of unrelated decorations.',
    '',
    buildV4SkillContext({ mode: brief.creativeMode, campaign, brand, previousIssues }),
    '',
    `TERRITORIES:\n${JSON.stringify(exploration.territories)}`,
  ].filter(Boolean).join('\n');
}

async function selectDiverseBlueprints({ brief, exploration, core, exact, footerReservedPx, outputSize, previousIssues = [], structuredResponse, model }) {
  const parsed = await structuredResponse({
    model,
    prompt: diversityBlueprintPrompt({ brief, exploration, core, exact, footerReservedPx, outputSize, previousIssues }),
    schemaName: 'demac_creative_v4_diversity_blueprints',
    schema: DIVERSITY_BLUEPRINT_SCHEMA,
  });
  const territoryMap = new Map(exploration.territories.map((item) => [item.id, item]));
  const ids = (parsed.selected || []).map((item) => item.id);
  if (ids.length !== SHORTLIST_COUNT || new Set(ids).size !== SHORTLIST_COUNT || ids.some((id) => !territoryMap.has(id))) {
    throw new Error('V4 Diversity Gate must select four distinct explored territories.');
  }
  const selected = parsed.selected.map((selection) => {
    const territory = territoryMap.get(selection.id);
    const rawBlueprint = selection.blueprint || {};
    const heroShare = brief.creativeMode === CREATIVE_MODES.PROOF
      ? Math.max(60, Math.min(75, Number(rawBlueprint.heroSharePercent) || 65))
      : Math.max(35, Math.min(80, Number(rawBlueprint.heroSharePercent) || 55));
    return {
      ...territory,
      whySelected: safeString(selection.whySelected, 600),
      diversityRationale: safeString(selection.diversityRationale, 600),
      blueprint: {
        heroRegion: safeString(rawBlueprint.heroRegion, 240),
        heroSharePercent: heroShare,
        headlineRegion: safeString(rawBlueprint.headlineRegion, 240),
        headlineMaxLines: Math.max(1, Math.min(4, Number(rawBlueprint.headlineMaxLines) || 3)),
        supportRegion: safeString(rawBlueprint.supportRegion, 240),
        ctaRegion: safeString(rawBlueprint.ctaRegion, 240),
        brandRegion: safeString(rawBlueprint.brandRegion, 240),
        proofRegion: safeString(rawBlueprint.proofRegion, 240),
        typographyScale: safeString(rawBlueprint.typographyScale, 320),
        negativeSpacePlan: safeString(rawBlueprint.negativeSpacePlan, 360),
        cropInstruction: safeString(rawBlueprint.cropInstruction, 360),
        primaryGraphicDevice: safeString(rawBlueprint.primaryGraphicDevice, 360),
        mobileReadSequence: compactList(rawBlueprint.mobileReadSequence, 6, 220),
        footerExclusion: safeString(rawBlueprint.footerExclusion, 300),
        mustPreserve: compactList(rawBlueprint.mustPreserve, 8, 240),
        mustAvoid: compactList(rawBlueprint.mustAvoid, 10, 240),
      },
    };
  });
  const deviceKeys = new Set(selected.map((item) => item.blueprint.primaryGraphicDevice.toLowerCase()).filter(Boolean));
  const compositionKeys = new Set(selected.map((item) => item.composition.toLowerCase()).filter(Boolean));
  if (deviceKeys.size < 3 || compositionKeys.size < 3) {
    throw new Error('V4 Diversity Gate rejected the shortlist because the selected blueprints are not materially different enough.');
  }
  return { portfolioRationale: safeString(parsed.portfolioRationale, 1100), selected };
}

function buildRenderDirection({ brief, candidate, exact, footerReservedPx = 156, outputSize = 1080 }) {
  const blueprint = candidate.blueprint || {};
  const footerPercent = Math.ceil((footerReservedPx / outputSize) * 100);
  return [
    `CREATIVE MODE: ${brief.creativeMode}`,
    `CREATIVE NORTH STAR: ${brief.creativeNorthStar}`,
    `CONVERSION GOAL: ${brief.conversionGoal}`,
    `PRIMARY PROMISE: ${brief.primaryPromise}`,
    `SUPPORTING PROOF: ${JSON.stringify(brief.supportingProof)}`,
    `PERSUASION: ${candidate.persuasionMechanism}`,
    `TERRITORY: ${candidate.name}`,
    `HERO TREATMENT: ${candidate.heroTreatment}`,
    `COMPOSITION: ${candidate.composition}`,
    `TYPOGRAPHY BEHAVIOR: ${candidate.typographyBehavior}`,
    `GRAPHIC LANGUAGE: ${candidate.graphicLanguage}`,
    `CTA STRATEGY: ${candidate.ctaStrategy}`,
    `PROOF STRATEGY: ${candidate.proofStrategy}`,
    '',
    'LAYOUT BLUEPRINT:',
    `- Hero region: ${blueprint.heroRegion}; target hero authority: ${blueprint.heroSharePercent}% of perceived composition.`,
    `- Crop: ${blueprint.cropInstruction}`,
    `- Headline region: ${blueprint.headlineRegion}; maximum ${blueprint.headlineMaxLines} lines.`,
    `- Supporting copy region: ${blueprint.supportRegion}.`,
    `- CTA region: ${blueprint.ctaRegion}.`,
    `- Brand region: ${blueprint.brandRegion}.`,
    `- Proof region: ${blueprint.proofRegion}.`,
    `- Typography scale: ${blueprint.typographyScale}.`,
    `- Negative space: ${blueprint.negativeSpacePlan}.`,
    `- ONE primary graphic device: ${blueprint.primaryGraphicDevice}.`,
    `- Mobile read sequence: ${blueprint.mobileReadSequence.join(' → ')}.`,
    `- Must preserve: ${blueprint.mustPreserve.join('; ')}.`,
    `- Must avoid: ${blueprint.mustAvoid.join('; ')}.`,
    `- Bottom ${footerPercent}%: ${blueprint.footerExclusion || 'completely clear for the original DEMAC footer'}.`,
    '',
    'EXACT CUSTOMER-FACING COPY:',
    `HEADLINE: ${JSON.stringify(exact.headline)}`,
    exact.subheadline ? `SUPPORTING LINE: ${JSON.stringify(exact.subheadline)}` : 'NO SUPPORTING LINE.',
    `CTA: ${JSON.stringify(exact.cta)}`,
    `WHATSAPP: ${JSON.stringify(exact.whatsapp)}`,
    exact.offer ? `OFFER: ${JSON.stringify(exact.offer)}` : 'NO OFFER TEXT.',
    exact.products?.length ? `APPROVED PRODUCT FACTS: ${JSON.stringify(exact.products)}` : 'NO PRICE/SPEC PRODUCT MODULES.',
  ].filter(Boolean).join('\n');
}

module.exports = {
  EXPLORATION_COUNT,
  SHORTLIST_COUNT,
  TERRITORY_IDS,
  CAMPAIGN_INTELLIGENCE_SCHEMA,
  TERRITORY_SCHEMA,
  DIVERSITY_BLUEPRINT_SCHEMA,
  deterministicModeHint,
  compileCampaignIntelligence,
  exploreTerritories,
  selectDiverseBlueprints,
  buildRenderDirection,
};