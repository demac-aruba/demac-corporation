# Review: restore manual bonuses and accountant exports

## Mode

Solo Maintainer Adversarial Review by Codex, separate from implementation; not an
independent review. Inspected the complete diff and owning callers for employee settings,
legacy adjustments, Employees and Finance exports, and Firestore authenticated transport.

## Findings and resolutions

- Root cause is migration parity: Legacy bonus UI/persistence/PDF were not connected to
  ERP Next. No production data inspection or claim of deleted records is made.
- Reuses the existing adjustment array, preserves deductions and schedule fields, uses
  canonical staff linkage and the existing unique-name Legacy bridge. Ambiguity blocks
  monetary export. No new employee source, collection, payroll engine or rate policy.
- Domain rejects invalid amounts, missing reasons, out-of-period dates, inactive/unauthorized
  principals, different payload replays and changed employee linkage. Server authorization
  remains the unchanged payrollRole rule (active admin/accounting) on employeePayrollSettings.
- Version-checked partial patches prevent the new editor from dropping concurrent entries
  or schedule updates. Requests use one stable draft ID; an uncertain successful commit is
  recovered without appending again. Permission/read/write errors retain the form and show failure.
- Cancellation originally needed a stale-target check: added comparison of original amount,
  concept, date and period before cancelling a live record, with a regression test. Voided
  entries retain creator, amount, concept, cancellation reason/actor/time. No physical deletion.
- Empty encoded mutation masks now reject before PATCH, preventing accidental whole-document
  replacement by an invalid caller of the new helper.
- React review: no new bulk reads, no secondary client store, event-driven mutations,
  accessible labels/status/errors, mobile form layout, disabled duplicate submission and
  disabled period navigation during save. Permission hiding is not treated as authorization.
- Both PDF/summary CSV entry points use the same active-bonus projection. Former employees
  with a period bonus remain in the export. CSV carries concepts; detailed bonus CSV retains
  voided entries and audit. Amounts are never added to hours or subtracted from advances.

## Evidence

- Focused acceptance passed: Legacy compatibility, unique/ambiguous identity, 27–26 bounds,
  all five categories, invalid amounts/dates/reasons, unauthorized/inactive callers,
  simulated server permission denial, write conflicts, uncertain-commit replay, cancellation,
  CSV/PDF totals and unchanged attendance/payroll hours.
- ERP typecheck and complete production build/prebuild gates passed locally. Focused tests
  and typecheck were repeated for the final review guards.
- Generated a synthetic 12-employee PDF through the production report generator, rendered
  it with Poppler and inspected it: bonus column, totals, headers/footer and one-page fit pass.
- Real Employees/Finance browser fixture bundles successfully. It exercises save, reload,
  cancellation, failed/retried save and five downloads in desktop/mobile, with an unauthorized
  role check. All fixtures are synthetic; external requests are blocked. Local Chromium is
  unavailable; the added ERP Next CI browser gate must pass on the final PR head.

## Decision and residual limits

Code review passes subject to the required exact-head CI/browser gate; no gate is waived.
No production entries, tax rules or commission rates were changed. No security-rule change,
Firebase emulator or live signed-in persistence verification is claimed. Transport denial
tests simulate the server response; unchanged Firestore rules are the actual authorization.

The historical Legacy editor still uses its old unconditional array update if separately
run; this change does not rewrite that retired UI. Existing document-size and manual-export
snapshot limits remain. Concurrent new-ERP edits use version preconditions. No bulk repair.
Release follows the owner's existing merge/deploy authorization for this payroll session.

## Release verification follow-up

- The first CI browser run failed because a text locator matched the reason textarea
  before the second save completed. The test now waits for the saved ledger row, both
  before checking the unchanged expected total and after reload; no assertion is removed.
- Recovered local Chromium and ran the complete synthetic browser test: desktop and mobile
  each passed three saves, one cancellation and five exports; restricted-role check passed
  with zero payroll reads. No external or production requests were made.
- Integrated current `main` (including PR #548) before release verification. The owner
  explicitly confirmed merge and deploy again in this conversation. Final CI remains required.
