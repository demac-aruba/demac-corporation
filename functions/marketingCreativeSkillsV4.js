// DEMAC Creative Engine V4 — performance-design procedural knowledge.
// Keep strategy, design principles, and hard rejection criteria separate from
// rendering so the same intelligence can drive OpenAI, Ideogram, Canva, or a
// future provider without rewriting the marketing brain.

const CREATIVE_MODES = Object.freeze({
  PROOF: 'proof_ad',
  OFFER: 'offer_ad',
  PRODUCT: 'product_ad',
  PROBLEM_SOLUTION: 'problem_solution_ad',
  BRAND_AUTHORITY: 'brand_authority_ad',
  EDUCATIONAL: 'educational_ad',
});

const MODE_SKILLS = Object.freeze({
  proof_ad: [
    'The real completed job is the primary evidence. Preserve scene identity and visible workmanship.',
    'Let the photograph carry roughly 60–75% of perceived visual authority unless the source image makes that impossible.',
    'Design proof signals around authentic details: clean mounting, equipment condition, architectural context, neat workmanship, and credible real-world texture.',
    'Do not transform the real installation into a generic product render or replace the actual condenser with an invented unit.',
    'The message hierarchy should answer: what was done, why this proves trust, and what the viewer should do next.',
  ],
  offer_ad: [
    'The offer must be understood in under three seconds at mobile size.',
    'Price, promotion, product size, or included value may dominate only when those facts are explicitly approved.',
    'Commercial modules must look like advertising graphics, not ecommerce widgets or app cards.',
    'Use urgency or comparison only when supported by approved campaign facts; never manufacture scarcity.',
  ],
  product_ad: [
    'The actual approved product and its meaningful differentiators are the hero.',
    'Technical facts must come only from approved product data and remain easy to scan.',
    'Use product-photography hierarchy and premium retail art direction rather than a specification sheet.',
  ],
  problem_solution_ad: [
    'Open with a recognizable customer problem and resolve it visually with the service/product.',
    'The problem should create relevance, not fear-mongering or unsupported failure claims.',
    'The solution and CTA must remain clearer than decorative effects.',
  ],
  brand_authority_ad: [
    'Build trust through professionalism, scale, people, fleet, workmanship, commercial projects, process, or approved experience signals.',
    'Avoid empty prestige language; authority should be evidenced visually or through approved facts.',
  ],
  educational_ad: [
    'Teach one useful idea at a time and preserve a clear path to the business action.',
    'Information hierarchy must remain social-first, not become an infographic wall.',
  ],
});

const DESIGN_DNA = [
  'DEMAC is a professional cooling company in Aruba; the work should feel credible, modern, premium, commercial, and locally real.',
  'Real completed DEMAC work is a strategic asset, not merely a background texture.',
  'The air-conditioning equipment and installation workmanship must remain recognizable and physically plausible.',
  'Use one memorable visual idea with clear focal hierarchy instead of accumulating generic modules.',
  'Treat typography as art direction: intentional scale, rhythm, line breaks, spacing, alignment, contrast, and relationship to the photo.',
  'Royal blue and white are brand anchors, but blue should be integrated through type, framing, light, depth, or composition rather than pasted on as a web panel.',
  'A WhatsApp CTA must be unmistakable and deliberate but should still belong to the composition rather than look like a website button.',
  'Paid-social work must read at phone size in approximately three seconds.',
  'Negative space is a design tool; do not fill every empty region with copy or cards.',
  'The original DEMAC footer is added later. The reserved bottom zone must stay visually clean and must never be recreated by the image model.',
];

const REFERENCE_LESSONS = Object.freeze({
  approved: [
    'Sharper, cleaner, more vivid treatment of the real installation materially improves perceived professionalism.',
    'Strong product scale, bold typographic hierarchy, purposeful commercial information, and a dominant WhatsApp action can make HVAC ads feel campaign-ready.',
    'Price-led creative works best when price tags feel intentionally designed as part of the campaign rather than generic rectangles.',
  ],
  rejected: [
    'Photo plus one translucent rectangle plus headline/subheadline/CTA is too simple and reads as amateur.',
    'Checklist cards, dashboard modules, pills, SaaS UI, and web landing-page components are not a visual language for DEMAC advertising.',
    'More boxes do not equal more design; modular clutter is not a substitute for art direction.',
    'Oversized typography can become an editorial poster and still fail as a conversion ad if proof, CTA, brand, and commercial hierarchy are weak.',
    'An aesthetically bold concept still fails if the authentic installation becomes secondary or generic.',
    'A high numeric QA score is meaningless if a senior marketer would not spend money promoting the asset.',
  ],
});

const PAID_SOCIAL_PRINCIPLES = [
  'Start from the conversion job: stop the scroll, communicate one promise/proof quickly, and make the next action obvious.',
  'Choose an ad archetype from campaign evidence; do not force every campaign into the same visual template.',
  'Design the first impression at thumbnail/mobile size before considering desktop detail.',
  'The visual hierarchy should usually resolve in this order: hook/promise, proof or product, conversion action, supporting detail.',
  'Use contrast, crop, scale, color, type, framing, and image treatment to create richness before adding modules.',
  'A paid ad is not a poster for artistic self-expression; every major visual choice should support attention, understanding, trust, or action.',
  'Authenticity is especially valuable for local service businesses. Do not over-sanitize a real job until it feels synthetic.',
  'A concept is materially different only if its composition, persuasion mechanism, crop/hero behavior, type system, and visual grammar differ at thumbnail size.',
];

const LAYOUT_PRINCIPLES = [
  'Declare the hero region and protect the primary equipment from text collisions.',
  'Give the headline a bounded region, intentional line count, and explicit relationship to the hero.',
  'Treat supporting copy as secondary; it must not compete with the headline or CTA.',
  'Reserve a purposeful CTA region with high visual salience and enough breathing room.',
  'Choose one proof device appropriate to the mode: authentic detail callout, small trust label, result framing, product fact, or approved offer.',
  'Define a mobile read sequence before rendering.',
  'Specify one primary graphic device; avoid combining unrelated effects.',
  'Protect the bottom footer exclusion zone before any other layout decision.',
];

const HARD_FAILURES = [
  'The asset looks like a beginner template, generic flyer, dashboard, app UI, SaaS card system, or landing-page hero.',
  'The main HVAC installation loses authenticity, becomes physically implausible, is replaced, duplicated, or visually damaged.',
  'The CTA is unclear, visually lost, or uses a wrong phone/WhatsApp number.',
  'Required customer-facing text is corrupted, paraphrased, misspelled, or materially incomplete.',
  'The design invents warranty, price, BTU, SEER, voltage, discount, scarcity, technical claims, or offer terms.',
  'The design is visually artistic but fails to communicate what DEMAC is selling or what action to take.',
  'Typography overwhelms the proof/product and turns the ad into a poster with weak commercial hierarchy.',
  'The reserved footer zone contains important text, CTA, pricing, badges, or critical imagery.',
  'Brand identity is so weak that the asset could belong to any generic HVAC company.',
  'Mobile readability fails at feed thumbnail scale.',
];

const BENCHMARK_LEVELS = ['amateur', 'competent', 'professional', 'agency', 'top_tier_paid_social'];

function modeSkill(mode) {
  return MODE_SKILLS[mode] || MODE_SKILLS.proof_ad;
}

function buildV4SkillContext({ mode = CREATIVE_MODES.PROOF, campaign = {}, brand = {}, previousIssues = [] } = {}) {
  const prior = Array.isArray(previousIssues) ? previousIssues.filter(Boolean).slice(0, 10) : [];
  return [
    'DEMAC DESIGN DNA:',
    ...DESIGN_DNA.map((item) => `- ${item}`),
    '',
    `CREATIVE MODE: ${mode}`,
    'MODE-SPECIFIC RULES:',
    ...modeSkill(mode).map((item) => `- ${item}`),
    '',
    'PAID SOCIAL PRINCIPLES:',
    ...PAID_SOCIAL_PRINCIPLES.map((item) => `- ${item}`),
    '',
    'LAYOUT PRINCIPLES:',
    ...LAYOUT_PRINCIPLES.map((item) => `- ${item}`),
    '',
    'REFERENCE LESSONS — successful signals:',
    ...REFERENCE_LESSONS.approved.map((item) => `- ${item}`),
    '',
    'REFERENCE LESSONS — rejected patterns:',
    ...REFERENCE_LESSONS.rejected.map((item) => `- ${item}`),
    '',
    'HARD FAILURE SIGNALS:',
    ...HARD_FAILURES.map((item) => `- ${item}`),
    '',
    `CAMPAIGN TYPE: ${String(campaign.campaignType || 'general')}`,
    `OBJECTIVE: ${String(campaign.objective || '')}`,
    `ANGLE: ${String(campaign.angle || '')}`,
    `BRAND STYLE: ${String(brand.style || 'modern, premium, professional')}`,
    prior.length ? `PREVIOUS CREATIVE REJECTION FEEDBACK:\n${prior.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  CREATIVE_MODES,
  MODE_SKILLS,
  DESIGN_DNA,
  REFERENCE_LESSONS,
  PAID_SOCIAL_PRINCIPLES,
  LAYOUT_PRINCIPLES,
  HARD_FAILURES,
  BENCHMARK_LEVELS,
  modeSkill,
  buildV4SkillContext,
};