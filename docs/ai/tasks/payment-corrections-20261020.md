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


## Verified before release
- Local authority/lease/booking/after-hours: 90 tests passed; final focused appointment suite passed after adversarial corrections.
- Drawer: 80 scenarios passed, including retained tab/session/catalog behavior. Real UI→HTTP Office facade→isolated database: 9 flows passed, including 1366px/390px correction, required reason/reference, version conflicts and exact retry after lost response+reload. Browser timezone Tokyo verifies Aruba date default.
- TypeScript, Firebase syntax validation, charge display/PDF (13), draft recovery (8), release helper tests (19) and final production build passed.
- Read-only live-source audit run 39466690105 (source 6129e3347373dcf37d00bb2dd6ff1b12c74086ce): live Office revision officebookingauthority-00090-ruq; unchanged published lock installed cleanly, baseline 127 and candidate 133 tests plus real bootstrap smoke passed. Candidate changes only appointmentCharges.js. Report under releases/payment-corrections-audit-20261020.json.
- Independent review exercises additional same-day legacy precision/no-op and malformed linkage cases. No production customer mutations performed.
- Merge/publication require final head CI, preview verification, exact source-only Office publication, then isolated frontend activation. Public checks cannot replace authenticated real-customer end-to-end verification; none will be simulated with real writes.
