# Independent review: date-only payments and audited corrections

## Mode and scope

- **Independent Review** — reviewer `/root/projection_review`; Builder `/root`.
- Reviewed the complete feature diff against production baseline
  `12df2bc44111bb6bed5b9620d16ee6215e4c938e`, including commit `489aa354`,
  the final payment-action spacing/date-hint changes, backend/frontend tests,
  task/business rules/ADR, and the new audit/release scripts and workflows.
- Runtime owners: `functions/appointmentCharges.js`; Next appointment payment
  workspace and CSS; payment types/date helpers; recovery decoder; operational PDF.
  Checked the existing Office facade, transaction/editing boundary and QBO appointment
  preview as direct consumers. No authority, accounting integration or data migration
  is introduced. Office Booking Authority remains responsible for operational receipts
  under OPS-SCHED-CHARGES-001/002; QBO remains official accounting.
- Runtime snapshot SHA-256: `178676673f80341a9f64c08f443fbe9345fc0c69f76f85c3a245e60a770c0edc`.
  Computed over the six runtime files above, sorted by full repository path,
  concatenating each path + NUL + file bytes + NUL. Further runtime changes require
  review; generated Next environment/tsconfig differences are not approved changes.

## Findings resolved

| Severity | Location | Evidence and consequence | Resolution verified |
| --- | --- | --- | --- |
| Medium | `functions/appointmentCharges.js`, correction date normalization (around line 414) | An independent probe showed a historical timestamp-only receipt changing from 12:51Z to 04:00Z when the operator selected its existing Aruba day. Identical values could also generate a false correction. | Same-day normalization retains the previous timestamp and precision before comparison. Backend regressions and an independent real-browser date round trip now reject a no-op and preserve the historical timestamp when only the amount changes. |
| Medium | `functions/appointmentCharges.js`, external-evidence guard (around line 411) | Independent probes showed non-array `invoiceIds` and `allocationIds` values bypassing the original array-only check. The endpoint should not reinterpret malformed external evidence as unallocated. | Nonempty arrays and malformed nonempty values now block correction. Focused denial tests pass, including invalid relationship/currency/amount evidence. |

No unresolved correctness, authorization or recovery blocker remains in this snapshot.
The temporary restriction on voiding while entering a separate new payment was removed;
correction mode still blocks voiding and captures its own financial version.

## Independent verification

All test data was synthetic. No production customer reads/writes or deployment were
performed by the reviewer. No implementation or repository test files were edited.

- **7/7 focused backend tests:** date-only validation and legacy timestamp compatibility;
  same-ID delta and before/after audit; unchanged creator/time; required reason and
  no-op/duplicate/foreign/stale/unauthorized denial; external links and allocations;
  void after correction; simultaneous corrections and exact replay.
- **3/3 real component → HTTP → Office facade browser cases:** the Builder's two new
  correction scenarios at 1366 and 390 pixels, plus a reviewer-added legacy receipt
  scenario. Context timezone was Asia/Tokyo; network access was restricted to loopback.
  Verified the Aruba default and native date-only field, required reason/reference,
  double-click yielding one correction, displayed before/after history, conflict
  preserving entered values and blocking resubmission, and lost acknowledgement followed
  by reload/exact retry without duplicate receipts or duplicate audit deltas.
- The added historical case changes the date away and back, confirms `payment_unchanged`
  with no correction event, then changes the amount. The same receipt and original
  `createdAt`/`receivedAt` remain, no `receivedDate` is backfilled, and the received total
  changes only by the amount delta. No browser errors or external requests occurred.
- Inspected the 390-pixel correction screenshot. The date, method/reference, mandatory
  reason and save control are reachable without horizontal overflow.
- **19/19 release safety/transport/source-update tests:** strict source-only payload,
  one-file delta, private retained archives, exact byte provenance, lost PATCH response,
  bounded operation recovery and refusal of unrelated source/configuration drift.
- `git diff --check` passed.

Evidence: `/workspace/scratch/2d530acc3b67/payment-corrections-evidence/independent/`.
`backend-probes-before.json` records the original failures;
`backend-tests-after.log` records the seven corrected backend cases;
`browser-run.cjs`, `browser.log` and `browser/results.json` record the three browser cases.
The external runner reused the existing isolated fixture and filtered only the reviewer
execution, without changing repository coverage or required gates.

## Contract, concurrency and compatibility assessment

The existing authority authenticates both before and within the transaction. Exact
request replay is checked before lease/version validation, while new corrections still
require the fresh actor, current lease and expected financial version. Payment, received
amount delta, appointment version and append-only audit commit together. Original ID,
creation metadata, status and payment count are retained; both amount representations
are updated. Querying `payment_allocations` in the same transaction prevents correction
of a receipt already allocated through that relation. POS/SUAVE method selection alone
is not treated as evidence that an external charge was performed.

New inputs carry an explicit Aruba day and a compatible ISO timestamp. Existing
ISO-only registration clients remain supported; historical receipts are not migrated.
Before/after payment snapshots use additive keys rather than changing the quote history
contract. The QBO appointment preview remains read-only (`canSend: false`) and receives
consistent receipt IDs, totals and ISO business dates. No invoicing, tariff, booking
projection, external processor or ledger write was added.

Opening correction captures its version immediately. The existing dirty/close/unload
protections apply, an uncertain operation is persisted before sending, and replay retains
its original request ID/payload. Correction entry is gated by the backend capability.
The pending decoder explicitly recognizes the new action. An unsent correction form is
not a durable cross-tab draft; close/reload warns, while an already-sent uncertain request
has exact recovery. This is consistent with the existing payment form contract.

## Publication and recovery

Reviewed the read-only audit manifest from run `39466690105`, reported by the Builder,
with Office revision `officebookingauthority-00090-ruq`:

- Baseline runtime hash: `66788b20c2052f39c2184935f54350bb52555beaf58f8396b59007deb6af19d8`.
- Candidate runtime hash: `6c04ef58e3ef2de5a581d4624fd5dea71e977e9cd061cb4396771cf91a5ea1d4`.
- Only `appointmentCharges.js` changes. Independently recomputed the candidate hash
  from the audited live manifest and current local module; it matches.
- Manifest reports 127 baseline / 133 candidate tests, clean installation using the same
  published dependency lock and successful bootstrap smoke for both. This is recorded
  remote audit evidence, not an independent production execution by this reviewer.

The release reconstructs the audited live archive, replaces only that module, and verifies
all other files. It uses only `buildConfig.source` in the API update mask. Private baseline
and candidate archives, source generation/provenance, configuration/IAM/traffic checks,
shared production serialization and main/release SHA gates remain in place. No rule,
identity, tariff, customer record or unrelated producer is deployed by this script.
Unreviewed live drift must stop publication and trigger a new audit. The audit workflow
is read-only; the release workflow mutates only on its explicit release branch.

Deploy and verify this compatible Office source before activating the reviewed frontend.
Preserve the active production frontend baseline and any intervening unrelated release;
this review does not approve deploying all of advanced main. A rollback must retain the
correction-aware backend and pending decoder, or use a correction-aware UI with new entry
disabled. Directly restoring an old UI can strand an uncertain correction envelope.
Never delete that envelope or rewrite receipts/audit history as rollback.

## Decision

**GO, conditional on all required gates and preview passing for the exact final head,
followed by the verified backend-first release sequence.** No gate is waived. The Builder
reports 90 focused backend regressions, nine real-authority browser scenarios and
successful type checks and the completed final build; the final drawer result and
exact-head CI, including the real Firestore emulator correction test, must be recorded
before publication. The reviewer
did not independently run the emulator or repeat the full drawer/build suites.

Residual limits: UI audit history displays the latest 100 events while older events remain
stored; external reconciliation is guarded by the existing known markers and allocation
relation, not a new accounting synchronization; no production customer operation was used
as a smoke test. Production source, runtime configuration, IAM and traffic must be verified
again by the controlled release, followed by frontend smoke without financial test writes.
Activation remains subject to the owner's existing explicit authorization and repository
Human Approval Boundary.
