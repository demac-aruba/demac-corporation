# DEMAC Creative Engine V4 — Performance Design Architecture

## Purpose

V4 exists to stop incremental flyer/template iteration and make the Marketing Agent behave more like a performance-marketing creative team: diagnose the ad job, compile a structured brief, explore materially different territories, define layout intent, produce complete designs, and judge both visual craft and conversion effectiveness.

## Production flow

1. **Campaign Intelligence** — classify the campaign into one creative mode: proof, offer, product, problem/solution, brand authority, or educational.
2. **Structured Creative Brief** — conversion goal, primary promise, proof, hero role, brand role, mandatory information, forbidden claims, authenticity constraints, mobile requirements, and Creative North Star.
3. **Reference Intelligence / Design DNA** — apply DEMAC-approved principles and explicit lessons from previously rejected work.
4. **12 Creative Territories** — text-only exploration; no image-generation spend yet.
5. **Diversity Gate** — choose four candidates that are materially different at thumbnail level.
6. **Layout Blueprints** — define hero authority, crop, headline/support/CTA/proof regions, typography behavior, negative space, one primary graphic device, mobile read sequence, preserve/avoid rules, and footer exclusion.
7. **Full-design generation** — the image model authors the complete advertisement. Code does not draw the design with UI-like SVG components.
8. **Paired benchmark QA** — one visual-design review and one performance-marketing review. Both must reach agency level.
9. **Hard failure gate** — corrupted text, invented facts, weak conversion path, generic template/UI aesthetics, damaged authenticity, wrong contact data, poster-without-conversion behavior, or footer intrusion cannot be averaged away by a high score.
10. **Directed refinement** — top two candidates are edited from concrete QA feedback, then an executive jury selects the winner.

## Creative modes

### Proof Ad
Real completed work is the credibility anchor. The source installation should normally retain roughly 60–75% of perceived visual authority. Do not turn the asset into a typography poster or synthetic product render.

### Offer Ad
Price/promotion/value is primary only when facts are approved. Commercial information must look like campaign graphics, not ecommerce or SaaS cards.

### Product Ad
Approved product and differentiators lead. Avoid spec-sheet aesthetics.

### Problem / Solution Ad
Make a recognizable problem relevant, then make DEMAC's solution and CTA clearer than the decorative treatment.

### Brand Authority Ad
Authority must be evidenced through approved work, people, process, scale, projects, or other real signals.

### Educational Ad
Teach one idea without losing the business action or turning the feed ad into an information wall.

## Non-regression rules

Do **not** solve creative quality by:

- adding more rounded cards, pills, checklist modules, or dashboard-like components;
- placing one large translucent rectangle over a photo and calling it a campaign;
- allowing typography to dominate so heavily that real proof/product becomes secondary;
- inventing price, warranty, specs, urgency, scarcity, or technical claims;
- optimizing only for a numeric QA rubric;
- selecting four minor variations of one layout;
- making external providers mandatory before a controlled benchmark demonstrates value;
- building a proprietary visual editor when established design platforms already solve editing/production.

## Quality threshold

A creative is not successful merely because it improves a prior score. Approval requires:

- visual benchmark: **agency** or **top-tier paid social**;
- performance benchmark: **agency** or **top-tier paid social**;
- explicit `adSpendReady=true`;
- exact required text;
- no invented facts;
- no hard failure;
- no amateur signals;
- factual, language, WhatsApp, and footer hard checks passed.

The practical criterion remains: **Would a senior marketer confidently spend real DEMAC media budget on this asset today?**

## Provider strategy

The V4 intelligence layer is provider-neutral. OpenAI full-design remains active because production credentials and resilience already exist. Ideogram structured generation and Canva layered production remain benchmark candidates, not required dependencies. If V4 still cannot produce paid-media-quality work, run a controlled same-photo/same-copy provider benchmark before changing the orchestration again.
