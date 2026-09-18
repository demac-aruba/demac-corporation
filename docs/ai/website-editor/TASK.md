# Task: Settings-activated visual editorial workspace

Issue #512 defines the owner-approved text/image-only scope. PR #513 is Deep Review
because the eventual feature includes authentication, editorial writes and publication
recovery. Christian authorized continued implementation and asks for no disruption of
existing ERP modules. Current work remains in the feature branch; no merge or production
activation is executed by this task record.

## Acceptance

- Explicit Settings activation only, separate editing tab; ordinary authenticated and
  anonymous visits remain ordinary. No token in URLs or postMessage payloads.
- Same actual responsive VRF renderer; title/paragraph/image selection, draft review,
  image decoding, undo, history and page navigation. Preserve approved public layout.
- Careers, links/actions, forms, styles/layout and operations are outside editable fields.
- Owner checks and truthful save states. Review mode is tab-local and clearly labelled;
  live service denial cannot silently turn into apparent cloud success.
- Exact field validation, optimistic revisions, idempotent publication and recovery,
  no overwrite of newer public content and draft-only reset/restore.
- New/redesigned commercial pages connect to the shared editor after content/design approval.

## Corrected isolation scope, 2026-09-18

No deployed Firebase rule paths, operational function entrypoints, Legacy services,
calendar readers or patcher changes belong to this frontend review. They now equal the
PR base. Proposed editor rules are kept as emulator-only fixtures; their security
assertions remain mandatory. No production deploy workflow is disabled or modified.
The website API stays unexported and production editor activation remains off.

Live activation still requires a separately reviewed website-specific publication and
permission rollout, including compatibility for collection-wide settings readers.
Do not confuse a safe UI-code merge with a working production editor.

## Current verification plan

Run existing TypeScript/web and ERP gates, existing VRF desktop/mobile catalogue tests,
editor Chromium/WebKit interaction and negative activation tests, candidate rule tests,
client recovery tests and service concurrency/failure tests. Add native CTA navigation
regressions, exact operational-source preservation and real Firestore/Storage adapter
persistence tests in a guarded local demo project. No test calls live mutation endpoints.

The UI remains a private functional preview. Results and remaining rollout blockers are
recorded in REVIEW.md only after inspecting completed runs. No independent review is
claimed; use a separately documented adversarial self-review.
