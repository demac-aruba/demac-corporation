# Review: Past Regular Booking slot correction

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: independent review subagent (2026-09-26)
Implementation author / agent: backend and UI implementation subagents; root handled review corrections and release evidence.

## Scope reviewed

- Request/acceptance criteria: `docs/ai/tasks/regular-historical-slot-correction-20260926.md`.
- Diff/commit: `fix/regular-historical-slot-adjustment-20260924` against `d82350f9` (commit and CI SHA to be recorded after publication).
- Affected callers/integrations: Office Booking Authority, canonical Appointment/Work Order/lock transaction, Scheduling details drawer, Project historical correction and Field/commercial guards.
- Authorities and rule IDs: Booking Authority, OPS-SVC-001 and OPS-SCHED-BACKDATE-001.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| High, fixed | Scheduling retry panel | An exact retry of old request A after later correction B could display A's old slots as current and close. | Response now exposes observed current slots separately; panel shows the later state and remains open through agenda refresh. Typecheck and Scheduling acceptance passed. |
| Medium, bounded scope | Backend hourly work-item guard and UI | Two- or three-hour-per-unit Regular services cannot safely shrink below original work duration without contradicting sellable capacity. | Keep this change restricted to one-hour-per-unit bookings. UI now states the limit and rejects known multi-hour cases before offering/entering the form; other services require separate reconciliation, not a silent rewrite. |
| Medium, pending CI evidence | Synthetic transaction tests | The in-memory fake cannot prove Firestore concurrent transaction retry/lock ownership. | Added isolated loopback Firestore Emulator tests for competing edits and lock reservation; run on the published PR head before merge. |

## Verification

- Required checks run locally: Functions syntax and `validate:firebase` PASS; focused backend 9/9 PASS; Office API 14/14 PASS; Booking Authority 181/181 PASS; ERP typecheck PASS; Scheduling acceptance PASS; ERP production build and prebuild acceptance PASS; `git diff --check` PASS.
- Security and permission cases: unauthorized Office actor, Project link, Field execution and invoice/payment evidence denied by focused tests.
- Business-invariant cases: lunch-crossing 3→4, standard 6-slot, special seven-unit denial, non-hourly scope denial and 4→2 tail release covered.
- Retry/concurrency/idempotency cases: exact A→B→A replay and stale expected slots covered locally; real Firestore concurrency is authored but awaiting CI execution.
- Failure/recovery cases: uncertain network outcome retains request ID in the UI; no customer notification is queued by this action.
- Unverified areas: live customer records are intentionally not used; visual authenticated Scheduling UAT has not been certified; CI emulator result remains pending.

## Decision

- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Block / changes required

Block means do not merge until the new Firestore Emulator CI test passes on the exact published head and the visual release owner review is recorded. The one-hour-per-unit limit is an explicit safe scope, not a claim that all Regular service durations are editable. No production write, permission change or deployment is authorized by this review document.
