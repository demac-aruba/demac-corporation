# Review: Continuous-work shifts with early departure

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review
- Builder and reviewer: Codex, in separate implementation and adversarial passes.
- This is a technical self-review, not independent approval or release authorization.

## Scope reviewed

- Complete task diff against `53b47592bfcd8993c987514bd755a92ee5e95850`.
- Shared calculation, declarations, Employee Calendar preview/Save guard,
  `saveAttendanceDay`, payroll projection, Work Order recomputation, regression tests
  and business-rule/task/decision documentation.
- Authority: canonical employee schedule and existing employee/date timesheet.
- Rule: `OPS-STAFF-ATTENDANCE-BREAK-END`.

## Findings and boundary checks

- No unresolved blocking finding in the requested new/edited attendance paths.
- Compensation is bounded by actual unused break and raw departure, before the
  remaining scheduled-time cap. This avoids granting excess regular credit on short days.
- Lateness remains separately classified. No-break partial schedules cannot acquire an
  invented allowance. Wholly outside-shift intervals cannot receive compensation.
- The original zero-overtime Save suppression is corrected through a clock/break comparison.
  Actual timestamps and break 0 are persisted; no artificial notes, break or absence needed.
- Permissions are unchanged: UI/payroll capability guard and existing Firestore `payrollRole()`
  write boundary remain. No Firebase rules, credentials or production configuration changed.
- Same employee/date ID is used on repeat save; overtime does not accumulate. Work Order
  transactional replay/deduplication remains covered. Existing last-writer-wins manual save
  concurrency is unchanged; this task adds no extra write, transaction or collection.

## Verification

All checks below passed locally on Node 24.19.0:

- `node --test functions/employeeAttendanceCalculation.test.js functions/workOrderApplicationService.test.js`
  — 32/32 tests, including wrong-crew denial, shifted-break overtime plus after-hours replay,
  minute boundaries, outside-shift intervals, partial break and residual departure.
- `npm run test:employee-attendance --prefix apps/erp-next`
  — existing acceptance and new save/payroll/retry regression passed. Persistence is stubbed
  with synthetic records; invalid and unclassified inputs produce no write. A denied write
  propagates an error. This is not a Firestore emulator authorization test.
- `npm run typecheck --prefix apps/erp-next` — passed before build-generated config changes.
- `npm run build --prefix apps/erp-next` — passed, including required prebuild attendance,
  schedule/payroll, Work Order, Van, project, task and slot-progress acceptance commands;
  static export completed. Reverted generated next-env/tsconfig changes from build tooling.
- `npm run validate:firebase --prefix functions` — passed.
- `git diff --check` — passed; no unrelated production implementation changed.

## Decision and residual risk

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

- No production data was read/changed and no live authenticated browser save was attempted.
  Save eligibility was checked through the production helper and inspection of its button
  wiring; actual save/payroll behavior was tested with stubbed persistence.
- Existing saved amounts are not bulk recalculated. Operators must explicitly re-save any
  historical day they want corrected. The existing Work Order recomputation path recalculates
  overtime on its affected timesheet but preserves previously stored regular/absence amounts;
  historical entries classified under the old rule therefore need full attendance re-save
  to reconcile all fields. Owner: workforce/payroll operator, before using an affected old
  record in payroll. No automatic historical repair is authorized by this change.
- Production activation requires explicit merge/deploy approval. The Work Order Application
  main-branch workflow deploys its shared backend automatically, so merging is a release action.
- Rollback: revert this code change. Any post-release attendance correction is a separate,
  explicitly scoped data operation; no destructive rollback migration is included.
