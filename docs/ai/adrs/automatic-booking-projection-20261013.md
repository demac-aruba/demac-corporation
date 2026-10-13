# ADR: Automatic forecast and explicit actual work

- Date: 2026-10-13 UTC (owner request 2026-10-12 Aruba)
- Status: Implemented; production publication pending owner approval
- Refines: appointment-operational-charges-20261010 and appointment-finance-governance-20261012
- Authority/rule: existing Booking/Pricing/Appointment financial authority; OPS-SCHED-CHARGES-001

## Decision

New Booking Authority commits derive a projection from their canonical workItems when no
financial payload was supplied. Initial snapshot and audit commit in the existing transaction
with the appointment and capacity. After-hours/overtime passes the same canonical workItems.
No scheduled worker, read-time write, new ledger or migration is introduced.

Unknown BTU uses the minimum approved Company Rules row or validated non-overlapping
catalog BTU tier, multiplied by quantity. Missing/invalid configuration remains unpriced;
zero must be configured explicitly. Fixed catalog prices retain their existing resolution.
`projectionOnly: true` is server-owned on minimum-price lines. Actual/final pricing cannot
retain that minimum as an agreed historical snapshot; it requires exact BTU through the
existing pricing authority. Field pricing is unchanged.

The new booking UI displays a read-only forecast and optional received deposit. Explicit
new financial payloads carry purpose=projection. Old explicit clients keep the previous
default purpose and quote/fingerprint behavior, preserving exact retries and open sessions;
they should reload for the new UX. New automatic forecasts add no receipt/payment capability
to a scheduling actor. Explicit deposits retain fresh office authorization.

Actual work starts from an empty list and a visible catalog search. The operator can explicitly
copy planned/agreed work for review, retaining historical identities and agreed prices, then
replace services, adjust BTU/quantities and add products. Confirmation still requires scope
review and Field reconciliation. No final confirmation is inferred from planned work.

Payments remain alongside actual work. A successful own write advances a surviving draft
only across its exact expected version + 1; an exact replay returning later state cannot
silently adopt intervening changes. Lost responses retain the original idempotency key.

## Boundaries and recovery

- Existing originals, payments, history and appointment/work-order identities are preserved.
- Old records without a projection stay without an original; reading does not backfill them.
- No daily/weekly/monthly reporting screen or official invoicing/QBO posting is added here.
  The persisted forecast is available for subsequent reporting; actuals remain operational
  financial evidence for the existing governed billing boundary.
- No inventory movement, technical completion, payroll, security-rule or catalog-price update.
- Release backend before frontend. All deployed consumers of Booking Authority must include
  the new helper and the final-pricing guard; review the deployment's actual runtime graph.
- Once any projectionOnly snapshot exists, do not roll backend back to code that ignores
  that marker: the old retained-price logic could accept a minimum as final. Retain the
  compatible backend and roll frontend back, or forward-fix backend. Never delete financial
  records to recover code. No production action is performed by this change.
