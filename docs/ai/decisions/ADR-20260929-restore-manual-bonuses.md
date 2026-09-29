# Restore manual employee bonus inputs without a new payroll authority

- Date: 2026-09-29. Owner: Christian. Status: accepted business intent.
- Rule: `OPS-STAFF-BONUS-MANUAL`.

## Evidence and decision

Legacy introduced the bonus/deduction manager on July 28 in `c2966b6`, with compact
history cards in `f398ff2`. It persists `PayrollAdjustment` entries inside the existing
employee settings document. ERP Next Employees consolidation (`9d13069`, August 20)
and its later PDF restoration did not wire this ledger into the new form/report.
This is missing migration parity; it is not evidence that stored entries were deleted.

Restore manual bonus entry in Employees, and the same active totals in Employees and
Finance accountant exports. Reuse the array contract, actor/time fields and active/voided
states. Add an optional descriptive category; older entries without it remain readable.
Preserve historical deductions without recreating deductions or automating commission policy.
The operator supplies the approved amount; Accounting still produces statutory payroll.

## Consistency and recovery

The new write path reads current settings and patches only changed fields with a Firestore
update-time (or missing-document) precondition. Version conflicts re-read before bounded
retry. Stable request IDs recognize an exact replay, including a response lost after commit;
changed payloads with the same ID are rejected. Cancelling retains original amount/reason
and audit. Unrelated schedules, historical deductions and advances are preserved.

Resolve canonical staff linkage first; a unique name bridge is Legacy compatibility only.
Ambiguous identity or invalid monetary history must be reviewed before accountant export.
No new collection, identity, security permission, production migration or data backfill.
Existing payroll-only Firestore authorization remains the server boundary.

## Validation and rollout

Domain/transport tests cover existing records, periods, categories, amounts, permissions,
concurrent updates, retry after an uncertain commit, cancellation and monetary exports.
Browser tests use real Employees/Finance components and the real REST write helper with
isolated synthetic transport, including refresh and PDF/CSV download on desktop/mobile.
Render the generated 12-employee A4 PDF to verify the added column remains readable.
Rollback is a code revert; saved compatible entries remain in the existing source.
