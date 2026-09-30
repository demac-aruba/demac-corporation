# Review: Partial-day attendance without unused lunch credit

## Mode and scope

- Solo Maintainer Adversarial Review, separate from implementation; not an independent review.
- Builder/reviewer: Codex. Baseline `246814113274bc50f4eda2d8795568ae82ae6b3b`.
- Complete diff and affected callers: shared calculation/declarations, Employee Calendar,
  existing save/payroll projection, Work Order timesheet recomputation and all added tests.
- Rule: `OPS-STAFF-ATTENDANCE-PARTIAL-NO-WORK`. Existing schedule/timesheet authorities.

## Findings

- No employee ID/name condition exists. Missing regular time is bounded by scheduled
  worked minutes. Outside-shift overtime is kept separate and cannot erase the deficit.
- The `partial_day` kind has no clock interval because the stored schedule does not provide
  enough information to allocate the net no-work amount to exact contiguous intervals.
- Zero/shorter actual break on a partial day generates no unused-lunch credit. The prior
  completed regular-day 16:00/16:30/17:00 cases retain their approved behavior.
- Paid no-work is stored in paid-free hours, not worked hours; NWNP remains independently
  auditable. Save still requires treatment and reason, without defaulting to either payment.
- Existing daily document identity, actor/schedule audit, payroll access rules and error
  propagation remain. No extra network write or authority is introduced. Existing manual
  save concurrency behavior is unchanged; repeats do not accumulate paid-free/NWNP amounts.
- Work Order replay preserves regular hours and approved paid/no-pay decisions while adding
  only actual external evidence. Wrong-crew denial remains in the transitive regression suite.

## Automated evidence

- 42/42 shared-calculation and Work Order tests passed locally (Node 24.19.0).
- ERP attendance/save/payroll tests passed for two synthetic employees, both payment
  treatments, stale classification rejection, edits, retries and denied write propagation.
- ERP typecheck and production static build, including all mandatory prebuild checks, passed.
- Functions syntax validation and `git diff --check` passed.
- Browser fixture bundles the real EmployeeWorkspace, calculator and save function; only
  data/auth adapters are synthetic, with all external requests blocked. Desktop/mobile
  assertions cover the no-work notice, absence of break credit, disabled Save until treatment
  and reason, paid/unpaid saves and transition back to a full worked day.
- Local browser execution was blocked by unavailable Chromium downloads. The same browser
  fixture is an added ERP Next CI gate using the existing pinned Playwright/Chromium tooling.
  Its result must be green on the exact PR head before merge; it is not waived or claimed
  as passing locally. CI logs/artifacts provide the final browser evidence.

## Decision and residual risk

- Code review passes; release readiness is conditional on the required CI/browser gate.
- No production data was read or changed and no live employee timesheet was used in tests.
- Historical records are not automatically reconciled. An operator explicitly edits/re-saves
  affected records and chooses the payment treatment. Existing Work Order recomputation can
  change overtime but preserves stored regular/pay decisions; full attendance re-save is
  required when historical totals need correction.
- No security-rule change/emulator authorization claim; the new denied-save test validates
  error propagation, and unchanged Firestore payroll-only access remains authoritative.
- Human approval is required for this release's merge/deploy. A rollback reverts code, not
  approved payroll history; existing additive exception records retain their stored amounts.
