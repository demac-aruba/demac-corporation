# Technician checklist continuation — 7 October 2026

Owner requests continuing PR 526 and checking off completed items as they are
verified. The latest user-approved checklist explicitly includes in-app audio
recording; the September 30 scope exclusion is not used to omit that item now.
No merge, public preview, deployment or production activation is authorized here.

Baseline read from GitHub: 2f1ecfb647b8b679473f63fe46bd9296ada87931. All 20
workflow runs for that baseline succeeded. The earlier recover_part type error
is already repaired; no earlier work is replaced. Current main is
c45d51d03840019cbfe68a2ca9ae5e067532077f, not the stale main SHA in the PR body.
GitHub currently reports the PR non-mergeable. Reconciliation with current main
and the complete exact-head regression gates remain required before readiness.

## Bounded implementation: native audio capture

Deep Review / Solo Maintainer Adversarial Review. Not independent review.
Existing authority: Field Operations Authority. Existing local recovery storage:
field-procedure-capture-store; originals carry original account, visit,
intervention, asset, part, step, capture timestamp, safety revision and hash.
This increment adds no backend write action, permissions, catalog setting, rules,
prices, invoices, stock movements, telemetry or new source of truth.

Microphone access occurs only after a user click. Supported recorder MIME types
are negotiated at runtime; an unavailable/denied microphone leaves the existing
file attachment path available. Native final data events precede original storage.
A cancelled or obsolete permission result stops its tracks and is not captured.
Backgrounding, stream interruption and time/size thresholds stop the microphone.
The 5-minute device-recording cap does not change backend or file-attachment policy.
The server-projected maximum size remains binding. No original is silently cut.

Local save failure holds the same Blob for retry or explicit discard and blocks
in-app exit. A local-copy button preserves oversized originals without a public
URL. Recordings use source=recorder; attached audio remains source=attachment.
The already-existing authenticated evidence viewer supplies playback after linking.
No new upload endpoint or generic offline command is introduced.

## Verification

Local: standalone controller TypeScript strict check, TSX transpilation/syntax,
and 18 deterministic lifecycle cases. This does not claim full local app types
or local browser acceptance; container DNS prevented repository cloning.

Additional gate: Technician procedure audio. It retains all existing gates and
runs app typecheck plus Chromium AND WebKit tests. Synthetic Web Audio sources
feed the real MediaRecorder encoder, then native audio decoding and actual
IndexedDB. Cases include denied/delayed permissions, final bytes, reload,
quota/retry with identical originals, navigation, pinned safety revision,
background stop and account changes. This is not physical-phone microphone proof.
Exact-head remote outcomes must be recorded in the PR before checking audio done.

## Separate adversarial review

Inspect old-stream/late-permission callbacks, double start/stop, scope lifetime,
original-before-navigation ordering, no cross-account transmission, and same-Blob
retry. Confirm that existing photo/file inputs cannot replace an active recording
and that controller state cannot authorize or close work. Keep native playback and
all original baseline assertions. No test is removed or weakened.

## Checklist status at publication

- [x] Earlier compilation blocker: repaired and verified on the baseline.
- [ ] Photo thumbnails/opening: private viewing exists; complete checklist review pending.
- [ ] Audio/video: native recorder implemented in this increment; exact-head gate pending.
- [ ] Original protection: baseline photo protection plus new audio failure paths need final combined check.
- [ ] All authored form drafts: procedure draft exists; coordination/exception/recovery text still needs full persistence review.
- [ ] Findings/add-ons: existing canonical handoff retained; checklist end-to-end review pending.
- [ ] Two-person execution: baseline browser acceptance exists; revalidate final head.
- [ ] Service completion: baseline acceptance exists; revalidate final head.
- [ ] Customer signature/acknowledgement: verify against agreed scope.
- [ ] Office send/return/resubmit/approve: baseline acceptance exists; revalidate final head.
- [ ] Final head regression and current-main reconciliation.
- [ ] Approved mobile/desktop visual comparison and physical-device acceptance.
- [ ] Final rollout/rollback documentation updated for the completed checklist.

Rollback of this increment: remove the native recorder entry only; keep attachment,
private reading, stored originals and canonical audit/recovery/closure protections.
