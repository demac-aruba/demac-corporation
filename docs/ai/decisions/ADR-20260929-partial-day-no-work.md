# ADR-20260929: Partial days do not earn unused lunch credit

- Status: Accepted business intent; release approval remains separate
- Date: 2026-09-29
- Owner: DEMAC business owner
- Rule: `OPS-STAFF-ATTENDANCE-PARTIAL-NO-WORK`
- Partially supersedes: `ADR-20260929-attendance-break-at-end.md`

## Context and decision

The owner clarified that an employee attending only part of the regular working day
does not earn a lunch allowance to move to the end or convert to overtime. The earlier
rule incorrectly described a three-hour afternoon attendance as moving lunch to departure.

Use the shared attendance calculation. Separate outside-shift overtime from actual regular
worked minutes; if regular work is below the configured scheduled worked minutes and
actual break is below the scheduled allowance, report the net shortfall as `partial_day`
no-work time. Do not credit unused break or invent a contiguous absence interval. Keep
raw clock-deviation diagnostics separate from the authoritative payroll shortfall.

Require an explicit `paid` or `no_work_no_pay` classification and reason. Existing
`employeeTimesheets.attendanceExceptions` stores this additive kind; existing paid-free
and NWNP fields remain the payment authority. Actual work never increases when permission
is paid. Older classifications do not silently approve a newly aggregated partial day.

## Alternatives and consequences

- Merely hiding the break explanation would leave phantom overtime for 13:00–17:00:
  rejected. New regression verifies zero overtime and four no-work hours for that case.
- Splitting net missing time at an assumed lunch clock would invent schedule information;
  aggregate the known worked-hour deficit instead. No separate absence collection is needed.
- Preserve completed regular-day cases 08:00–16:00 / 16:30 / 17:00 with break 0 and
  genuine outside-shift overtime. A configured partial-day schedule without a lunch allowance
  retains its current treatment.
- No migration. Operators explicitly re-save affected historical records if correction is
  intended. Existing Work Order recomputation may update overtime but preserves approved
  regular/pay treatment; historical reconciliation still requires a full attendance save.

## Verification and rollout

Verify both payment treatments, multiple synthetic employees, configurable schedules,
minute boundaries, shortened actual breaks, retry/edit, outside work and full-day regressions.
Production activation requires the owner's approval. Rollback is a code revert; persisted
`partial_day` records remain readable as paid-free/NWNP amounts, without deleting history.
