# Task: date-only payment entry and audited corrections

## Context and scope
Owner requests 2026-10-20: remove manual time entry, default to current Aruba day; edit an existing payment amount/date/method/reference with mandatory reason, previous/new values, operator and real registration/correction timestamps. Applies to Next appointment payments and booking deposits (date-only). Standing audited merge/deploy authorization in this chat. Deep Review: financial mutation.

## Governance
Existing Office Booking Authority owns operational receipts under OPS-SCHED-CHARGES-001/002. QBO remains official accounting. No customer messages, real test writes, migrations, external payment processing, permission or infrastructure changes. Same receipt identity and original creator/time preserved. Append-only chargeEvents, optimistic financial version, edit lease and exact request replay required.

## Acceptance
- Date-only visible; day interpreted in Aruba independent of browser timezone; server validates actual calendar day and rejects future.
- Existing timestamp-only receipts/clients remain readable; unchanged historical dates preserve exact timestamp. New day-precision metadata is additive.
- Correction requires current authorized office actor, lease/version, recorded operational receipt, consistent customer/property/currency, no external reconciliation/allocation evidence, and nonempty reason.
- Atomic same-ID correction, amount representations and received total delta; payment count and original author/time unchanged. Audit before/after + current actor/time. No-op/duplicate references rejected.
- Form captures version on opening; dirty warning, single in-flight request, no optimistic success, uncertain exact replay survives reload.
- Existing invoices, booking forecasts, tab retention, voids and unrelated appointment/Work Order data preserved.

## Plan / risk / recovery
Frontend capability is advertised by compatible backend; deploy isolated source patch to existing Office runtime before reviewed UI. Never deploy full main backend over live source. No bulk data edits. Rollback retains compatible backend and pending-action decoding; do not discard uncertain correction envelopes. Source provenance and exact release evidence required before publication.

## Verification
Focused backend date/correction/denial/race/retry tests; real Firestore emulator; real component→HTTP facade→synthetic database correction/reload scenarios; existing drawer/booking/finance tests, types, Firebase validation and ERP build. Independent review recorded separately. Production checks read-only.
