# Task: make daily shift entry preserve the regular-hours budget

## Context and scope

Owner reports the production form for 15:00–05:00, no actual break, hiding rates and
reporting zero work after entering those actual times in the planned-shift fields.
Screenshot 20261027-164400 confirms a 14-hour net planned shift against an 8-hour
canonical budget. Shared validation correctly rejects this; UI fallback misrepresents
the invalid calculation as zero and hides the rate controls.

Deep Review requested by owner. Scope is the ERP Next draft editor and error display,
with focused domain/browser regression coverage. No backend, Rules, data model,
recurring schedule, production data or payroll formula changes. Existing merge/deploy
authorization applies to this corrective follow-up; no real employee test writes.

## Authority and acceptance

`employeeTimesheets` remains authoritative. OPS-STAFF-ATTENDANCE-DAILY-SHIFT keeps
canonical/saved regular minutes and paid-free entitlement. Explicitly enabling the
dated adjustment proposes actual clock-in as editable planned start, retaining the
planned unpaid break. End/day offset are derived from that start + regular minutes
+ planned unpaid break. Actual clock-out and actual break never become planned values.

- Eight regular hours, start15:00, planned break60 => end00:00+1.
- Actual15:00–05:00+1 / break0 =>840 worked,480 regular,360 OT; default150%, manual200%.
- Planned break0 => end23:00, still8 regular and6 OT for the same actual work.
- Blank/invalid plan shows pending payroll, not zero; valid actual duration remains visible.
- Invalid actual intervals show pending work. Rate controls remain visible but disabled,
  preserving any explicit selection. Work/schedule controls remain editable.
- Existing records are not normalized on mount, reload, or actual-time edits.
- Saved snapshot, reason, revision, guarded commit, retry, neighboring records and
  payroll/PDF/CSV behavior retain existing contracts.

## Verification / recovery

Focused attendance and transaction contracts, typecheck, production build, real component
desktop/mobile browser flows, and authenticated emulator CI. Independent reviewer
attendance_review inspects full diff. React best-practices pass focuses on explicit
event handlers, no synchronizing effects, stable authority, and labeled readonly/disabled controls.
Frontend-only release; recovery can restore the previous frontend without any data migration,
but must retain the PR628 model/revision guard. Production employee saves are not test fixtures.
