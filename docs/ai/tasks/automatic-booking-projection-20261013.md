# Task: Automatic booking projection and actual work entry

## Context
- Owner request 2026-10-12: booking services automatically produce a sales forecast at their configured entry/minimum tariff when BTU is unknown. Actual services, products, quantities and BTU are entered after work, with receipts alongside.
- Surface: ERP Next Scheduling; existing Appointment financial authority.
- Mode: Deep Review (financial state). Base: 6689c6f2.

## Scope and governance
- Reuse Company Rules, services, appointments.jobCharges and payments. No new financial authority.
- Automatic initial projection on Booking Authority commits, including bookings that never open the financial tab. Minimum prices are explicitly projection-only; final governed service prices still require exact BTU.
- Visible search adds actual services/products; no manual projection button. Existing receipts, originals and legacy agreements remain intact.
- No production migration, QBO posting, inventory movement, invoice generation, Field completion or change to access rules.
- Rules: OPS-SCHED-CHARGES-001/002 and OPS-CATALOG-001. Legacy callers keep their existing explicit financial payload compatibility.

## Acceptance criteria
- [x] New bookings save a projection without opening financial controls; configured unknown-BTU minimum is quantity weighted, unknown tariff stays unknown.
- [x] A minimum estimate cannot be confirmed as a final BTU price or inherited as an agreed historical price.
- [x] Actual work has an immediately visible search for services/products; add/remove, quantities, BTU and final review work.
- [x] Deposits/partial payments retain existing methods, idempotency, lease and version controls; own receipt saves do not discard an actual-work draft.
- [x] Old appointment reads do not manufacture/backfill an original estimate or modify financial records.
- [x] Focused backend/frontend checks and visual desktop/mobile evidence pass; separate adversarial review recorded.

## Risk and recovery
- Preserve canonical identity, appointment/Work Order/capacity atomicity and receipt audit.
- Existing clients may still use the legacy explicit estimate command; only the new UI removes manual projection entry. No financial migration.
- Roll back frontend while retaining the compatible backend and every financial snapshot/receipt. Never roll backend back to pre-projectionOnly code after marked snapshots exist; forward-fix while preserving that guard.
- Production deployment is outside this implementation turn; present a concrete reviewed change first.
