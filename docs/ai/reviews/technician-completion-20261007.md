# Review: PR 526 completion and current-main reconciliation

## Review mode

- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Reviewer and implementation author: Codex, in separate implementation and
adversarial passes. This is not an independent review.

## Scope

October completion from `4c76b371`: photo viewer, procedure/visit authored drafts,
all changed form callers, browser fixtures, persistence identity and conflict
handling. Current-main merge `5f7c6fbb` incorporates `c45d51d0`, including saved
visit references and all booking checks. Existing PR authority/media/revision
boundaries were rechecked as direct consumers; historical implementation records
remain in the dated task documents.

Authorities: Field Operations remains execution/report/review truth. Catalog and
price snapshots remain canonical. Inventory, billing and communications remain
separate governed handoffs. IndexedDB is an account-scoped recovery cache, never
business authorization or another source of truth. No new production permissions
are applied by this review.

## Findings and corrections

| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Authored fields on several forms existed only in component memory. | Existing IndexedDB forms store now protects proposal, approval, execution, report, acknowledgement, Office and visit/equipment text under real identities. |
| Medium | Stale-tab retries could not safely reconcile local and durable text. | Preserve both; compare-and-swap plus explicit comparison/resolution. Subsequent intervening writes still reject. |
| Medium | Legacy free-text debounce discarded pending saves on unmount and hid storage errors. | Immediate serialized saves, visible errors/exit protection, old draft import without deleting the original, explicit canonical-version comparison. |
| Medium | Write-time field size could exceed the read parser's supported bound. | Reject oversized durable replacement while preserving on-screen text and previous durable original; focused recovery test added. |
| Medium | Requiring a Visit ID disabled the existing no-access/cancel forms before visit preparation. | Allow local drafts scoped to the real Work Order until the Visit exists; add both pre-visit browser scenarios. No fabricated Visit or new command authority. |
| Medium | Main detail back/open-job callbacks did not consult the shared original/draft exit guard. | Both user navigation callbacks now consult it; forced auth invalidation still clears the protected view. |
| Low | Synthetic context switches could be asserted before React committed them. | Fixture switches use `flushSync`; assertions remain unchanged. No application permission or test expectation was relaxed. |
| Low | Tests proved private photo decoding and audio recording but not combined video playback. | Added generated WAV/MP4 sample playback through the actual private upload/read adapter in the same procedure. Result must be green before claiming the check complete. |

## Adversarial checks

- Keyed owner/Work Order/Visit/intervention/step/revision lifetimes; no fabricated
  procedure IDs to save visit-only text. Capture/command stores still require full
  procedure targets. Session checks bracket asynchronous IndexedDB transactions.
- Existing mutation locks, version checks, stable request IDs and server eligibility
  remain. Draft restore has no command effect. Prices and permission flags are not
  taken from a restored draft. Physical attestations remain transient and reset on
  safety revision changes. Risk-resolution notes are bound to the reviewed risk.
- Private media retains authenticated reads, exact size/MIME/hash checks and local
  URL revocation on close, hiding, account invalidation and unmount. Enlargement
  uses the same verified bytes and native dialog keyboard behavior.
- Original backend and browser assertions remain; conflict resolution preserves
  the union of validation/test scripts from both merge parents.
- Failure states retain originals and block unsafe navigation; only confirmed
  callbacks clear authored values. Unknown command outcomes keep their receipt.

## Evidence recorded so far

- `f1cba8ad`: UI run 37701800242 green, including 11 draft cases per engine,
  19 original recovery cases per engine, six shared-part viewport scenarios and
  complete visible 14/9 workflow in Chromium and WebKit.
- Integrated backend `5f7c6fbb`: run 37703247520 green, 425 tests and real
  Auth/Firestore/Storage/HTTP emulator flow. Includes contention, outsiders denied,
  exact original replay and responsible submission/Office return/resubmit/approval.
- Local integrated checks: 425 Field tests, 235 booking tests, Firebase syntax,
  Field security/contracts, offline and technician experience all pass.
- ERP production build passed on the integrated code after replacing the local
  external dependency symlink with a local dependency copy. No source build gate
  was disabled. Generated TypeScript config edits were restored afterward.
- Final expanded browser run and remaining CI results: pending; append exact
  source/run evidence before changing this review's decision.

## Decision

- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Block / changes required until final browser and CI verification completes

Residual limitations: physical phone recording/playback and owner workflow
acceptance remain manual. Legacy non-procedure file selectors do not gain binary
reload recovery; their authored text is protected and selected-file navigation is
blocked. Browser eviction/forced process termination before durable save cannot be
represented as successful storage. Owner approval remains required for merge,
deployment and catalog activation. See the activation runbook.
