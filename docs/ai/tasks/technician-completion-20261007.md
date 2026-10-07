# Task: finish PR 526 from its verified recovery checkpoint

## Context

Owner request, 7 October: continue the outstanding checklist and check off each
item only after it is saved and verified. Starting head: 4c76b371. The previous
native-audio gate passed 19 controller + 12 Chromium + 12 WebKit scenarios.
The owner excludes hosted preview from the critical path. No merge/deploy or
production activation is authorized. The current main must be reconciled.

## Scope

Complete private photo thumbnails/enlargement, protect authored form drafts,
verify the existing add-on, two-person execution, closure, customer acknowledgement
and Office review flows, integrate current main, and record final gates/rollout.
Physical-phone acceptance remains distinct from automated browser evidence.

## Governance

Deep Review / Solo Maintainer Adversarial Review, not independent review.
Field Operations Authority remains the only execution/review source of truth.
The existing account/context-scoped IndexedDB forms store contains authored text
only. Saving or restoring a draft never sends a command, changes a safety phase,
approves work or creates another business record. No permission/rules change.
Existing media read authorization and hash verification remain mandatory.
No new database schema, migration, prices, inventory, billing or communications.

## Acceptance criteria

- [ ] Private photos load only when visible, show compact thumbnails, and enlarge
      the same verified bytes in an accessible dialog with keyboard focus return.
- [ ] Media URLs are revoked on close, backgrounding, session invalidation and unmount.
- [ ] Authored coordination, exception and recovery text survives reload/offline;
      physical safety confirmations always require fresh interaction.
- [ ] Quota/read failure retains originals; stale tabs cannot overwrite silently;
      an explicit comparison is required to resolve a draft conflict.
- [ ] Complete existing 14/9 flow and account/authority/recovery tests still pass.
- [ ] Final checklist evidence names the exact source head and remaining limits.

## Plan and risk

Use the existing viewer, capture store and draft hook. Add private thumbnail/dialog
presentation and connect previously in-memory procedure forms. Keep permission and
command validation on the server. Freeze authored inputs during a command; clear
them only after a confirmed response. Risk-resolution text records the risk ID and
cannot confirm another risk without review. Safety revision changes clear local
physical attestations. Draft comparison retains both texts until the user chooses.

Rollback: revert UI entry points while retaining original capture/draft/revision
readers and canonical closure/authority controls. No data deletion is involved.

## Verification

Required: app typecheck, Chromium/WebKit visible workflow and draft recovery,
private original transport tests, current native audio gate, final app build and
Field backend/auth/emulator gates after integration. Existing gates are retained.
Local browser installation failed to download a valid archive; use the existing
authorized GitHub CI, never treat that local limitation as a browser pass.
Results and the separate adversarial review will be appended after verification.
