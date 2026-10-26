# Review: continuous overnight attendance and dated planned shift

## Mode and scope

Deep Review, independent reviewer /root/attendance_review; implementation /root.
Canonical employeeTimesheets only; no role expansion, recurring schedule mutation or backfill.
Final code, CI/audit results and deployment references will be recorded before completion.

## Findings and fixes

- Initial domain/UI review found no material calculation, snapshot or manual 200% issue.
- Require planned break snapshot equality as well as start/end/day offset in Rules.
- Added daytime override, legacy conversion and lost-response retry of revision 2 tests.
- Rules initially dereferenced missing resource during a conditional-update deletion race.
  Guard the missing resource explicitly; existing Rules and update preconditions still reject
  the stale commit. All existing concurrency cases remain enabled and pass.
- Release safety job needs full git history for immutable baseline source comparison; fixed.
- Rules publication requires a sourceGate immediately before PATCH and propagation hold before dependent UI.
  Exact updateTime plus 10min is emitted as frontendNotBefore. Never test using real employees.

## Verification so far

- 83 shared calculation/WorkOrder/after-hours tests PASS.
- Attendance/domain/transaction acceptance PASS; 840 worked/480 regular/360 OT at 200%, break 0.
- Auth/Firestore emulator PASS: existing roles, revocation, races, missing neighbors,
  no-op/lost-response creates and updates, revision reuse/removal/reset, snapshot mismatch,
  accounting updates and legacy conversion. Zero production requests.
- Typecheck and production build PASS locally. Generated Next configuration changes reverted.
- 23 source-only transport/release/rules tests PASS before the final propagation metadata addition.
- Read-only audit40367753970 PASS; immutable artifact recorded in releases/employee-overnight-audit-20261026.json. Exact live baseline has68 tests; exact candidate81 plus runtime entrypoint smoke; declarations and lock hash preserved.
- First Auth browser CI passed desktop split/overnight but timed out awaiting the mobile third
  split-rate save. Local realChromium143/Auth/Firestore completed all four cases successfully.
  Browser synchronization now waits for the client history and draft reset after committed writes,
  with failure screenshots/JSON retained. No save or totals assertion was removed. Final CI required.
- Independent reviewer repeated domain, acceptance, transport and emulator gates; no code blocker.
- Direct guarded-create revision missing/revision2 and deleted guarded target tests PASS locally.

## Recovery and limits

Release backend compatibility, then Rules guard, propagation hold, then frontend. Existing
records are never rewritten by release. Preserve the new model/guard in any forward fix.
Production acceptance is source/served-asset inspection; authenticated saving is tested with
synthetic emulator data only. No production employee data is inspected or modified for tests.
