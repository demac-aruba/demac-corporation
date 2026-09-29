# Coworker support on future dates — 2026-09-29

Mode: Fast Product Validation. This is a contained restoration/extension of an existing UI and command. Transaction ordering, capacity locks, roles, data model and communication authority are unchanged.

## Cause and evidence

Owner screenshot: New appointment for Van 3, Wednesday Sep 30, 08:30–09:30. The operator wants to help Van 1 with its existing installations.

The feature was not deleted. PR #463 (`9ecfb7dc65303d15bb2d5c4a29e9a4934b84e333`) explicitly delivered same-day coworker support. Original history includes `a3c7f713ae08f8a8f8b23cc09f8caf8617a582cd` (keep ad hoc support same-day and active-only). Current main `6f4a10729350f793af0757298cfb00bf11ef40b2` retains the drawer, Office command and authority, but hides SUPPORT for non-today dates, blocks its handler, and rejects those dates on the server. The New appointment source selector also had no entry to that existing drawer.

## Implementation

- Show the existing SUPPORT action for today/future operating slots, with unchanged management permission and capacity guards.
- Add Send van support in normal New appointment; transition to the existing support drawer using the selected Van/date/slot. It does not appear for special overtime/emergency bookings. Historical support was subsequently authorized and added below.
- Initially accept valid current/future dates in Booking Authority, preserving confirmed primary appointment/date validation, dated crew resolution, calendar, route, occupancy, atomic lock and replay behavior.
- Preserve one non-billable SUPPORT Work Order on the original appointment, no primary movement, no duplicate customer communication. Existing immediate alerts remain same-day; future support enters the normal dated schedule.
- Record OPS-SCHED-SUPPORT-001 and add the owning backend files to the existing Office CI/deployment path filters and tests. Deployment authorization/gates are unchanged.

## Verification

- `npm run typecheck` in apps/erp-next: PASS.
- `npm run test:live-scheduling`: PASS, including date eligibility, existing duration/capacity, Saturday, attribution, card and Project label suites.
- `node --test functions/bookingAdhocSupport.test.js functions/technicianScheduleChangeService.test.js functions/technicianDailyScheduleService.test.js functions/officeBookingAuthority.test.js`: 66/66 PASS.
- `apps/erp-next/scripts/coworker-support-browser.cjs`: PASS at 1500×1060 and 390×844, using real React components, browser transport, Office facade and an isolated Firestore emulator. Authentication/host routing only are synthetic. Zero external browser requests.
- Browser flow covers direct SUPPORT, cancel with no write, New appointment → Send van support, selected primary job/reason, one committed support request, authoritative replay, and persisted agenda refresh. Van 3 08:30–09:30, dated crew, unchanged Van 1 primary, unchanged Van 3 09:30 job, one appointment, non-billable support and disabled customer notifications verified in the emulator.
- Future rejection tests cover occupied work, concurrent capacity lock, absent crew, calendar closure, mismatched appointment date, invalid date and historical date, with no writes on rejection.
- Final diff self-check and React checklist: no new effects/data loads, callback remains inside the disabled/inert booking form during saves, existing permissions and authoritative commit controls preserved.

## Release boundary

No production appointments or notifications were created, and no deployment or merge was performed. The authorized request is investigation and reintegration; AGENTS.md requires explicit owner approval for production release. Publish the existing Office Booking Authority deployment and ERP Next frontend together after approval. An ordinary frontend preview still points to the current backend and cannot commit future support until that backend is deployed. No migration/backfill or security-rule change is required.

## Publishing blocked by automatic approval review

The automatic approval reviewer rejected `git push -u origin fix/restore-adhoc-van-support` because it considered explicit permission to export organizational code to `https://github.com/demac-aruba/demac-corporation.git` missing. No alternative publishing path was attempted. Implementation and verification remain complete locally; push and PR creation await that specific authorization. Production merge/deployment remain a separate approval boundary.

## Historical extension requested by owner — 2026-09-29

The owner explicitly requested backdated support to correct the live schedule after work happened. This supersedes the original past-date exclusion in this task.

- SUPPORT and New appointment → Send van support are now available on valid past dates as well. The support drawer clearly labels historical corrections and requires a checkbox acknowledging actual support plus a reason.
- The Office command forwards the established `bookingMode=backdated` / `backdatingAcknowledged=true` contract; the server independently derives whether the selected Aruba date is historical and requires those fields.
- Historical support can reference a completed/invoiced/paid primary job without changing its status or financial/Field/attendance records. Cancelled/rescheduled/held appointments and cancelled primary work remain rejected.
- The support order and assignment preserve the existing historical audit fields; the appointment lifecycle event records the work date, actor and entry timestamp. The primary appointment itself is not marked backdated or reopened.
- Confirmations/reminders remain disabled; explicit backdated markers also suppress internal same-day alerts. Dates, dated crew, closures, route and historical occupied capacity are still validated transactionally.
- Production release and remote push remain unperformed; the earlier automatic-review push block is unchanged.

Historical extension verification: typecheck and live Scheduling suites PASS; 71/71 focused backend tests PASS; four browser/emulator runs PASS (future desktop/mobile on Sep 30 and historical desktop/mobile on Sep 28). Historical browser runs started with a completed primary appointment, verified the acknowledgement gate, saved through the actual Office facade, inspected historical audit markers, replayed the request and reloaded the persisted support card. Each run made one support request and zero external browser requests. Screenshots inspected for desktop/mobile layout. Historical unit cases additionally verify completed/invoiced/paid originals, cancelled/rescheduled/held rejection, completed capacity conflict, dated absence, closure, incomplete acknowledgement, missing reason, customer and technician notification suppression, and unchanged primary, invoice and timesheet fixtures.

## Release authorization — 2026-09-29

The owner explicitly authorized “puedes hacer merge y deploy” after reviewing future and historical support behavior. This authorizes publishing the task branch to demac-aruba/demac-corporation, creating the PR, merging after validations and deploying the Office backend plus ERP Next frontend. It resolves the previous automatic-review publishing block. Integrated main 9db2af1 (Project booking production fix #546) before publishing.
