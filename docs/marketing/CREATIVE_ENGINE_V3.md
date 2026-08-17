# DEMAC Creative Engine V3 — Design Intelligence Architecture

## Purpose

Creative Engine V3 exists to produce advertising that is worthy of real paid-media spend, not merely technically valid imagery. V2/V2.1 proved the pipeline, photo enhancement, exact-fact controls, Firebase persistence, and QA plumbing, but also exposed a core architectural mistake: deterministic UI-like SVG composition was making the final ads look templated and amateur even when the source photograph was excellent.

V3 moves visual authorship back to the image/design model and keeps deterministic code focused on governance, facts, footer safety, persistence, and evaluation.

## External patterns deliberately adopted

V3 does not try to reinvent mature creative-production practices.

### Structured concept planning

Inspired by modern structured image prompting workflows such as Ideogram V4, V3 separates visual intent into explicit fields: archetype, persuasion mechanism, thumbnail idea, composition, typography direction, graphic language, photo treatment, and text strategy. The goal is to reduce vague prompts such as “premium and modern” and force concrete art direction before generation.

### Broad exploration before expensive rendering

Professional creative teams explore many directions before polishing finals. V3 creates 12 text-level creative territories, shortlists 4 materially different concepts, renders those four, then refines the top two. This prevents the previous pattern of generating three near-neighbor layouts and mistaking variation for exploration.

### Layered-design thinking

Canva's design-model direction demonstrates an important principle: a design is a hierarchy of purposeful visual objects, not a flat background with generic interface components added afterward. V3 therefore asks the image model to author the full visual composition. Future Canva integration is reserved for editable layered production/export rather than as a source of style data for external models.

### Brand governance and benchmark scoring

Adobe GenStudio-style governance patterns are adopted: approved facts are locked, invented claims are forbidden, brand rules are explicit, and candidates are evaluated against an external quality bar. V3 does not allow a high average score to override obvious amateur signals.

### Procedural skills

Anthropic-style Agent Skills influenced the split between reusable marketing/design procedures and rendering code. `marketingCreativeSkillsV3.js` contains design DNA, paid-social procedure, HVAC-specific rules, anti-patterns, and QA procedure. The builder consumes those skills rather than carrying one monolithic prompt.

## V3 production funnel

1. **Facts gate** — Brand Center live, Aruba Papiamento passed, exact WhatsApp confirmed, approved product facts only.
2. **12-concept exploration** — GPT-5.6 Sol develops distinct visual territories from the real DEMAC photo and campaign strategy.
3. **Executive shortlist of 4** — concepts must differ at thumbnail level in composition, persuasion, typography, crop, and graphic language.
4. **Four full AI designs** — GPT Image 2 edits the real installation photograph into complete advertising, not just backgrounds.
5. **Paid-media benchmark QA** — GPT-5.6 Sol evaluates each candidate against professional agency standards and explicitly detects amateur patterns.
6. **Top-two refinement** — the best two receive a targeted visual revision pass using their actual QA feedback.
7. **Executive jury** — the two refined candidates are compared directly and a final winner is selected.
8. **Approval gate** — approval is blocked unless the selected candidate is `adSpendReady`, text is exact, no facts are invented, and agency-level benchmark QA passes.
9. **Performance loop (future)** — Meta performance signals should feed future creative prioritization once campaign telemetry is connected.

## Non-negotiable visual anti-patterns

The following are not acceptable final design systems:

- dashboard/SaaS UI over photography;
- generic white checklist cards;
- pill-heavy layouts;
- a single large translucent rectangle carrying most copy;
- a web landing-page hero translated directly into a square ad;
- symmetrical template layouts with no focal tension or scale contrast;
- extra modules added only to make a design look more complete;
- generic CTA buttons that look like application controls;
- decorative gradients disconnected from the physical installation.

## Quality gate

A final image is not approved because its arithmetic average is high. It must satisfy all of the following:

- `benchmarkLevel` is `agency` or `top_tier`;
- `adSpendReady` is true;
- `visibleTextExact` is true;
- `inventedFacts` is false;
- no `amateurSignals` are present;
- authenticity and footer safety pass hard thresholds;
- typography, composition, creative direction, professional finish, conversion clarity, and thumbnail impact pass V3 thresholds.

The practical question is: **Would a senior marketer confidently put meaningful paid-media budget behind this exact image today?**

## Provider architecture

V3 is provider-neutral at the orchestration layer.

### Active now

- `openai_full_design` — GPT Image 2 for high-fidelity full-design editing using DEMAC's existing production credential.

### Prepared for benchmark / later activation

- `ideogram_v4_structured` — target provider for controlled structured layout/text experiments when an Ideogram API credential is configured.
- `canva_layered_production` — target provider for editable layered production, brand-template workflows, resizing, and export when an authenticated Canva integration is configured.

External providers must earn production use through a controlled benchmark on the same campaign/photo/copy. They are not added merely because they exist.

## Change-review checklist

Before implementing a future creative-engine change, answer these questions:

1. Does this solve an observed failure or just add complexity?
2. Is there a mature industry pattern we should adopt instead of inventing a custom mechanism?
3. Does the change improve creative authorship, or merely add another deterministic component?
4. Can the effect be measured on the same benchmark campaign?
5. Does it preserve factual governance, Papiamento validation, real-photo authenticity, and footer rules?
6. Could it accidentally optimize for the QA rubric instead of actual professional taste?
7. Would the architecture remain understandable to another engineer six months from now?
8. If the change fails, can we compare it cleanly against the prior version?

If the answers are weak, do not ship the change.
