// DEMAC Creative Engine V3 procedural knowledge.
// These are compact, composable skills inspired by mature creative-production
// patterns: broad concept exploration, structured art direction, brand
// governance, benchmark-based critique, and performance-ready variation.
// They are intentionally provider-neutral so the same process can later drive
// GPT Image, Ideogram, Canva, or another production engine.

const AMATEUR_ANTI_PATTERNS = [
  'A dashboard or SaaS interface pasted over a photograph.',
  'A large translucent rounded rectangle carrying most of the copy.',
  'Several identical white checklist cards with blue check icons.',
  'Generic pill badges, UI chips, progress-card aesthetics, or app-component styling.',
  'Headline, body copy, and CTA stacked like a web landing-page hero instead of an advertisement.',
  'Template symmetry with no deliberate focal tension, crop, scale contrast, depth, or visual surprise.',
  'Decorative blue gradients that do not integrate with the photographed installation.',
  'A CTA that looks like a web button instead of a deliberate advertising device.',
  'Tiny copy used to fill space rather than strengthen persuasion.',
  'More modules added merely to make the design look busy.',
];

const DESIGN_DNA = [
  'Real completed DEMAC work must remain the credibility anchor; preserve installation authenticity.',
  'Treat typography as a visual object with deliberate scale, rhythm, alignment, and negative space.',
  'Use strong crop and focal hierarchy so the air-conditioning equipment remains visually important.',
  'Prefer one memorable graphic idea over many generic components.',
  'Royal blue may shape light, depth, framing, typography, or motion, but should feel integrated rather than pasted on.',
  'Use contrast of scale: one dominant message, one supporting idea, one clear action.',
  'Commercial information should be designed as advertising graphics, not application UI.',
  'For price-led sales campaigns, price tags should feel custom, premium, and campaign-specific rather than generic cards.',
  'For installation/service/social-proof campaigns, create visual persuasion through authenticity, craft, proof, atmosphere, and composition instead of inventing offers.',
  'The result must be understandable on a phone in roughly three seconds and still reward a closer look.',
  'Reserve the bottom footer zone completely; the original DEMAC footer is added later and must never be recreated.',
];

const PAID_SOCIAL_SKILL = [
  'Start from the conversion job: what should stop the scroll, what should be understood immediately, and what should be remembered after the scroll.',
  'Explore multiple distinct visual territories before producing polished finals.',
  'A concept is distinct only when its composition, persuasion mechanism, typography behavior, and visual grammar materially differ.',
  'Design for 1:1 Meta feed at mobile size first, not desktop poster viewing.',
  'Avoid visual clutter; complexity must come from art direction, not from adding boxes.',
  'Make the CTA unmistakable without allowing it to overpower the promise or proof.',
];

const HVAC_MARKETING_SKILL = [
  'Show cooling, comfort, efficiency, workmanship, or proof through the real physical installation and environment.',
  'Do not fabricate equipment, duplicate condensers, replace real labels, or create impossible HVAC geometry.',
  'A clean installation, correct mounting, neat lines, and professional finish are persuasive proof and should remain visible.',
  'Do not invent BTU, SEER, voltage, warranty, price, discount, installation terms, or technical claims not present in approved brand/campaign facts.',
  'If product facts are approved, make them visually easy to compare; if not, do not create fake specification modules.',
];

const CREATIVE_DIRECTOR_SKILL = [
  'Think in visual territories before layouts: editorial, product-hero, architectural, cinematic, typographic, social-proof, offer-led, lifestyle, kinetic, minimal-luxury, documentary, and unexpected conceptual treatments.',
  'Do not pick four versions of the same blue overlay. Shortlisted concepts must be visibly different at thumbnail size.',
  'Reject a technically correct concept if it feels generic, templated, amateur, or indistinguishable from a low-cost flyer.',
  'Use references as quality bars and structural lessons, never as instructions to copy another brand or artwork.',
  'The final question is not “does it satisfy the rubric?” but “would a senior marketer confidently spend real media budget on this creative?”',
];

const QA_SKILL = [
  'Benchmark against professional paid-social agency work, not against the other candidates in the batch.',
  'A high numeric score cannot override obvious amateur signals.',
  'Fail any candidate that looks like UI components over a photo, even if legible.',
  'Fail any candidate with invented facts, wrong phone number, text corruption, footer intrusion, fake equipment, or damaged installation credibility.',
  'Evaluate thumbnail impact first, then hierarchy, typography, craft, authenticity, persuasion, brand distinctiveness, and exact-text fidelity.',
  'Revision instructions must be specific visual actions, not vague requests such as “make it better” or “more professional”.',
];

const PROVIDER_STRATEGY = {
  defaultProvider: 'openai_full_design',
  available: {
    openai_full_design: true,
    ideogram_v4_structured: false,
    canva_layered_production: false,
  },
  notes: [
    'OpenAI is active now because DEMAC already has production credentials and GPT Image 2 supports high-fidelity image editing.',
    'Ideogram V4 is an intended benchmark/provider because its native structured JSON prompting supports layout, text, palette, and bounding-box control.',
    'Canva is an intended production/export provider for layered editable designs and brand-template workflows once an authenticated Canva integration is configured.',
  ],
};

function buildSkillContext({ campaign = {}, brand = {}, previousIssues = [] } = {}) {
  const campaignType = String(campaign.campaignType || 'general');
  const objective = String(campaign.objective || '');
  const angle = String(campaign.angle || '');
  const brandStyle = String(brand.style || 'modern, premium, professional');
  const prior = Array.isArray(previousIssues) ? previousIssues.filter(Boolean).slice(0, 8) : [];
  return [
    'DEMAC DESIGN DNA:',
    ...DESIGN_DNA.map((item) => `- ${item}`),
    '',
    'PAID SOCIAL SKILL:',
    ...PAID_SOCIAL_SKILL.map((item) => `- ${item}`),
    '',
    'HVAC MARKETING SKILL:',
    ...HVAC_MARKETING_SKILL.map((item) => `- ${item}`),
    '',
    'CREATIVE DIRECTOR SKILL:',
    ...CREATIVE_DIRECTOR_SKILL.map((item) => `- ${item}`),
    '',
    'AMATEUR ANTI-PATTERNS — actively avoid:',
    ...AMATEUR_ANTI_PATTERNS.map((item) => `- ${item}`),
    '',
    `CAMPAIGN TYPE: ${campaignType}`,
    `OBJECTIVE: ${objective}`,
    `ANGLE: ${angle}`,
    `BRAND STYLE: ${brandStyle}`,
    prior.length ? `PREVIOUS REJECTION FEEDBACK:\n${prior.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  AMATEUR_ANTI_PATTERNS,
  DESIGN_DNA,
  PAID_SOCIAL_SKILL,
  HVAC_MARKETING_SKILL,
  CREATIVE_DIRECTOR_SKILL,
  QA_SKILL,
  PROVIDER_STRATEGY,
  buildSkillContext,
};
