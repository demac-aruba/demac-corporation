# Task: audited salary advance and bonus corrections

## Context and scope

Owner request (2026-11-10): edit/delete an advance or bonus with operator name and a required explanation in history. Deep Review: monetary inputs and logical deletion. Implement in ERP Next on `feature/payroll-input-corrections`; no production record changes or release in this task.

## Authority and rules

Reuse `employeePayrollSettings`: salaryAdvance documents and the existing payrollAdjustments array. OPS-STAFF-BONUS-MANUAL and 27–26 periods apply. Existing Firestore payrollRole (active admin/accounting) remains the server permission boundary. No new source, security rules, employee identity, attendance calculation or automatic deduction. Employee identity stays fixed during corrections; date, amount, method/reference/notes or category/concept can change.

## Acceptance

- Edit and Delete actions for active inputs; History for active and deleted inputs.
- Required reason; preserve creator and append operator UID/name, time, before/after values atomically with each correction. Delete is a retained void, excluded from all new-ERP totals/exports.
- Reject stale target, invalid amount/date/reason, inactive/unauthorized caller, altered retry and malformed history. Preserve unrelated settings and other adjustments.
- Exact uncertain-commit retry writes once; failure retains the editor. Existing records work without migration.
- Cross-period date changes update canonical period. History survives reload. No financial amount alters attendance hours.

## Verification and recovery

Focused domain/REST tests, Employees/Finance browser flows on desktop/mobile, authorization denial evidence, ERP typecheck and build, then separate Solo Maintainer Adversarial Review. No production data used. Roll back code by reverting the feature; retain additive history and void metadata. Never roll back to a reader that counts voided advances. Existing payroll writers are trusted: history is application audit, not a new tamper-proof server ledger.

## Completed evidence

Implementation and separate review are recorded in `../reviews/payroll-input-corrections-20261110.md`.
Domain/REST, existing bonus regressions, desktop/mobile browser, actual Auth/Rules emulator,
ERP typecheck and Next build passed. No real employee records changed. Release approval pending.
