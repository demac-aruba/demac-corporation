# Reviewed partial progress, shared templates and lifecycle — adversarial review

## Mode and delivery scope

Deep Review / Solo Maintainer Adversarial Review by the implementation author. This is
not independent review. The owner authorized continued development of the existing module,
not production activation, migrations, deletion or security-policy changes. This pass checks
the exact incremental diff against c2ef461. Current required CI results belong in the PR
checkpoint after publication; local unit success is not browser/emulator evidence.

## One source and write boundary

Project scope decisions reuse the established registry actor, expectedVersion, exact request
receipt and atomic Project event. They never write a Field visit, Office Review, payroll,
appointment, stock quantity, invoice or payment. Partial progress is a cumulative reviewed
scope checkpoint, not a report or additive worker ledger. Only current approved Field sources
can support it. An unapproved outstanding support visit may coexist with partial work, but
cannot be hidden when accepting final scope. Completion retains its stricter full-evidence
check. Percentages apply to units or required checklist items only; hours/approval methods
produce no invented physical percentage and there is no unweighted Project-wide average.

Project status changes do not cancel the real agenda. Outstanding work blocks terminal
closure/cancellation; completion requires current accepted phases and explicit scope approval.
Reopening is explicit, audited and restores Active, never removes the earlier closure event.
A closed plan rejects further changes until reopened, other than optional template management.
Already committed booking replays remain recoverable even if status or activation later changes.

Templates live in the established businessSettings configuration boundary, limited to 30
entries and 256 KiB. Commands include the exact library version; template creation/replacement,
Project version, audit and receipt commit together. Copies contain planning only and replace
phase/checklist identities deterministically while remapping dependencies. Applying a template
appends phases; replacing or archiving a library entry cannot rewrite previously applied work.
The immutable Project event contains the template before/after evidence. No seeds are inserted.

## Findings addressed in this pass

1. A correction must not act as an increment or overwrite prior evidence. Units/checklist
   values are absolute, prior and correction event IDs are retained, and decreases require
   explicit acknowledgement of the current checkpoint. The audit failure test rejects the
   complete transaction rather than leave an unlogged checkpoint.
2. A scope checkpoint must not unlock prerequisites merely by reaching 100 percent. The
   distinct progress_recorded pointer is not accepted by completionReader; final approval
   remains separately governed. Phase deletion with any review history is still rejected.
3. A source/phase-definition change must not leave a stale reviewed percentage marked fresh.
   The preview recomputes source versions and signature; old quantities remain labeled historical.
4. A rollback switch must not lose the central read path or create replacement appointments.
   Optional writesPaused blocks NEW registry mutations and NEW Project booking transactions;
   authenticated exact receipt replays precede the pause check and still return the original
   result. Ordinary non-Project bookings never read this setting. Malformed pause values fail
   closed. No production settings have been changed.
5. A template snapshot cannot retain actuals, customer identity, fixed dates, or past manager
   assignment. Strict domain phase normalization and a portable-detail allowlist exclude them.
   Preview/application versions prevent applying a replaced or archived template unnoticed.
6. The previous Project domain allowed fewer statuses than its historical UI. Eligibility now
   reuses the common supported/open sets: Active and Near Completion are open, On Hold and
   terminal statuses are not. The budget rule and real capacity validation remain unchanged.

## Explicit limits and open dependencies

Source versions conservatively invalidate a checkpoint on unrelated administrative edits to
referenced documents. Historical records can still be inspected. A terminal management status
is a historical decision, not an assurance that reports can never be corrected; reopening
preserves that distinction. A valid restored source record is not proof of a real backup.

The current Inventory issue event has a Work Order/quantity but no frozen unit-cost valuation.
The Expenses/Finance screen in this source is preview-only. Therefore this increment does not
invent Project actual costs from current catalog prices, transfers or sample expense rows.
The Field timeline is Van/visit evidence, not person-hours. Real cost/person-time input contracts
must be verified before claiming those integrations complete. Original browser/cloud backup,
restore exercise and historical reconciliation have not been performed.

## Verification requirements

Local syntax and dependency-free Project unit tests; exact client typecheck; synthetic-dialog
Chromium and WebKit tests; real Auth/Firestore emulator concurrency, correction, rollback and
protected-record comparisons; then the normal combined Booking/Field/PR #515 regression.
The new tests add positive and negative cases; existing assertions remain intact. The test
transport is not production and the emulator data is synthetic. Full workflow evidence must
be reviewed before any release-readiness claim.

Decision: publish the implementation for required validation, KEEP DRAFT. No main merge,
production configuration, security settings or data are changed by this review.
