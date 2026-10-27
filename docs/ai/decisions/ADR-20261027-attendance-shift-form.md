# ADR: derive the planned shift end in the daily attendance form

- Status: Accepted
- Date: 2026-10-27
- Related: attendance-shift-form-20261027; OPS-STAFF-ATTENDANCE-DAILY-SHIFT.
- Additive to ADR-20261026-overnight-attendance; no data/model policy superseded.

## Decision

The existing regular-minute entitlement is fixed when adjusting a dated shift. Let
operators choose the planned start and unpaid break, and derive the planned end/day
offset. On explicit opt-in, propose clock-in as the planned start with the scheduled
unpaid break. The operator may edit it before saving; subsequent actual-time edits
and record loads never rebase a plan. Persist the same validated override shape.

Free editing of both planned and actual end led operators to duplicate a 14-hour
actual span into an 8-hour regular schedule. Validation remains fail-closed. UI errors
must not substitute zero for an unavailable calculation; valid actual duration is
calculated independently using the shared interval/evidence union. Rate controls are
disabled during invalid calculation while retaining their prior manual selection.

## Consequences and verification

No inferred pay rate, silent schedule correction, historical rewrite, new collection,
backend/Rules change or migration. Half-day budgets and day-off limits remain canonical.
Regression tests cover overnight rollover,0/60 planned breaks, invalid inputs, fixed
planned shift on actual edits, manual200 retention, and save/reload in both viewports.
Release only after review and required checks, using the existing owner approval.
