# Review: continuous overnight attendance and dated planned shift

## Mode and scope

Deep Review, independent reviewer /root/attendance_review; implementation /root.
Canonical employeeTimesheets only; no role expansion, recurring schedule mutation or backfill.
Final code, CI/audit results and deployment references will be recorded before completion.

## Findings and fixes

- Initial domain/UI review found no material calculation, snapshot or manual200% issue.
- Require planned break snapshot equality as well as start/end/day offset in Rules.
- Added daytime override, legacy conversion and lost-response retry of revision2 tests.
- Rules initially dereferenced missing resource during a conditional-update deletion race.
  Guard the missing resource explicitly; existing Rules and update preconditions still reject
  the stale commit. All existing concurrency cases remain enabled and pass.
- Release safety job needs full git history for immutable baseline source comparison; fixed.
- Rules publication requires a sourceGate at PATCH and propagation hold before dependent UI.
  Exact updateTime plus10min is emitted as frontendNotBefore. Never test using real employees.

## Verification so far

-83 shared calculation/WorkOrder/after-hours tests PASS.
- Attendance/domain/transaction acceptance PASS; 840worked/480regular/360OT at200%, break0.
- Auth/Firestore emulator PASS: existing roles, revocation, races, missing neighbors,
  no-op/lost-response creates and updates, revision reuse/removal/reset, snapshot mismatch,
  accounting updates and legacy conversion. Zero production requests.
- Typecheck and production build PASS locally. Generated Next configuration changes reverted.
-23 source-only transport/release/rules tests PASS before the final propagation metadata addition.
- Desktop/mobile browser and immutable production source audit remain required CI gates.

## Recovery and limits

Release backend compatibility, then Rules guard, propagation hold, then frontend. Existing
records are never rewritten by release. Preserve the new model/guard in any forward fix.
Production acceptance is source/served-asset inspection; authenticated saving is tested with
synthetic emulator data only. No production employee data is inspected or modified for tests.
