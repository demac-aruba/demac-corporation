# ADR: Shared visual content editor, isolated from operational rollout

- Status: Proposed, functional preview on PR #513. No production activation.
- Updated: 2026-09-18
- Owner intent: issue #512 and Christian's explicit frontend-only clarification.

## Content and interface

One canonical VRF content representation, one actual responsive renderer, one editor.
Reuse Website Manager document identities and published Storage JSON. Exact text/image
field allowlists exclude actions, links, forms, arbitrary HTML/CSS and layout mutation.
Future approved commercial pages add adapters/bindings, not another backend form UI.
Careers remains excluded and managed by its recruitment module.

Settings grants one-use, source-window-bound launch into a separate tab. The iframe
uses actual public routes; message checks bind origin, source and channel. Normal
signed-in top-level visits do not activate editing or load overlays. The launch nonce
is a UX capability, not a substitute for authenticated service authorization.

## Persistence boundary

The website-only service validates the owner and activation, applies optimistic draft
revisions and preserves noneditorial fields. Storage published JSON is public authority;
Firestore publication records are manager/audit projections. Frozen release receipts
support history and request-bound recovery, not another CMS. Conditional generation
writes and exact readback protect concurrent publication and lost responses.

The Firebase adapter is separate from service rules and UI. It initializes nothing by
itself and only accepts the canonical website documents/bucket path. The same adapter
runs against actual local demo Firestore/Storage emulators for persistence verification.
No operational service is imported. Browser review mode remains explicitly tab-local.

## Releasing without operational side effects

An earlier implementation put proposed access rules in the deployed root paths and
narrowed Legacy/ERP calendar reads to accommodate private editorial documents. Review
found that merging those paths would automatically deploy Firebase rules. That coupling
was rejected for this frontend delivery.

Production rules and operational readers/patcher are restored exactly to the PR base.
Candidate rules are emulator-only fixtures under functions/website-editor-review.
Existing security tests still exercise every candidate allow/deny boundary. The removed
calendar refactor's acceptance tests now validate the actual retained reader behavior,
plus a Git scope gate proves no operational-source/deployed-rule changes in this PR.
This changes task scope, not permission expectations or pass/fail thresholds.

The website API is deliberately not exported by operational bootstrap. Live UI defaults
to disabled. A separate explicitly reviewed activation must reconcile current content,
isolate the function deployment and resolve rule compatibility before enabling writes.
Do not claim the full production feature is finished merely because review-mode UI works.

## Interaction invariants

Overlays check the actual clicked descendant for links/buttons/disclosures before
selecting a parent image. Actual hero/final CTA native navigation is tested separately
from background selection. Menus, system tabs and accordions retain their behavior.
Forms and operational/external routes are protected within an editing frame only.

## Known limits

VRF is the first connected page. Header/footer shared editing is not in this pilot.
Review-only uploads/drafts disappear on tab closure. Images use public website media
storage, not confidential document storage. Static HTML remains build-time while
hydrated public content refreshes from the same published JSON. These are explicit
review/rollout limits, not evidence of production cloud publishing.
