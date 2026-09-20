# Adversarial self-review: history references and issued materials

Mode: Deep Review / Solo Maintainer Adversarial Review by the implementation author, not
independent review. Read root protocol, authority matrix, domain contracts and affected callers.
Local source was independently hash-checked against fd69123 before edits. Review covers the
complete increment, not the entirety of all earlier PR #514 code.

## Boundaries checked
The finalizer is Owner-only in both registry routing and service preparation. It revalidates
the original archive hash, customer/property identity, current links and source document
versions inside the same existing transaction as Project version/audit/receipt. Only Project
migration metadata is changed. No operational write, global flag, arbitrary target mapping,
customer alias merge, phase remapping or replacement appointment is accepted. Cancellation
status remains cancellation after history review; reopening still uses the explicit lifecycle.

Unknown source rows may be retained as unverified with one reason each, but a KNOWN missing or
conflicting reference cannot be excluded. Explicit limitations prevent conflating scheduling
reference review with certified Field time, cost, completed scope, or a backup/restore test.
This lifts only the pending reference-review marker; normal Field source validation still
applies. Original baseline and sourceDeclaredStatus are retained.

Inventory read validates Project -> link -> appointment -> Work Order before querying issue
records. It reads only inventoryMovements, with one ordered bounded query and cursor; no scan
of all warehouse balances, no per-item catalog lookup and no monetary pricing fallback.
Malformed or unsupported movement types remain issues, not empty success. Data is per selected
Work Order/page, never a whole-project total. Changes to a linked job's status do not fabricate
stock reversals. Shared transport/authentication and existing UI font tokens are reused.

## Adversarial cases and refinements
- Missing support orders, foreign customer aliases, source phase conflicts and changed source
  nanoseconds are rejected. The whole review is retried from new evidence after conflicts.
- Empty source rows require individually indexed notes; duplicate note indexes cannot satisfy
  the acknowledgement count. Percentages/hours/amounts are not copied into the Project.
- Owner role is checked on each retry, and exact successful receipt replay precedes writesPaused.
- Mid-transaction audit failure rolls back both metadata and receipt. New links/source changes
  invalidate the preview signature. Finalization is not silently repeated under a new request.
- UI abort/unmount guards discard late reads. Changing selected material Work Order clears prior
  results immediately. Failed reads do not render a clean zero/empty result.
- Source quantities retain Inventory precision; fractional Products, negative/unknown quantities
  and absent source locations/times are not normalized into valid material use.

## Verification evidence
197 local dependency-free Project cases passed (16 new reference-review and 7 Inventory cases).
JS syntax and JSX syntax transpilation passed; that is not a full ERP typecheck.
The new real Auth/Firestore and Chromium/WebKit tests have been authored; exact-head CI results
must be recorded in the PR after execution, not inferred from these local results.

## Remaining risk / decision
A bounded review rejects >100 appointment references or >250 Work Orders rather than certifying
partial history. Unreferenced legacy activity remains unverified, and other operator profiles
are outside the captured-source scope. QBO valuation and per-person allocation remain absent;
no preview expense/cost values are promoted. Real backups, isolated restore, staging and original
Project reconciliation have not occurred. Keep DRAFT and do not activate production on code-only
proof. A selective forward correction is preferable to blindly restoring over newer bookings.
