# Task: Register appointment receipts in one step

## Context and scope

Owner approved the faithful visual proposal on 2026-10-19. Appointment payments currently ask for the method twice. Show amount/reference, one method selector, editable current Aruba date/time, an optional collapsed note and one explicit registration action directly in the existing payments panel.

Scope: appointment receipt presentation and first-edit state, focused browser acceptance. Booking-creation deposits retain their existing workflow. No backend, schema, migrations, catalog, QBO posting, customer communication or production data changes.

## Governance

Deep Review because receipt entry is a financial write surface. Authorities: existing Office facade, appointment jobCharges and append-only operational payments/history; OPS-SCHED-CHARGES-001/002. No new authority or permissions. Existing frozen expected version, editing lease, exact uncertain-write recovery, audit and backend validation remain in effect. No ADR change required; this is presentation over the existing contract.

## Acceptance

- [x] Fields visible immediately; exactly one method selector and one submit action.
- [x] Empty form is not dirty and does not suspend reading or block close/QBO preview.
- [x] First edit captures the current version. Conflict, expired lease, read failure, pending operation, read-only and temporary-hold restrictions remain.
- [x] Date defaults to current Aruba time and may be backdated; method changes retain amount/reference/date/note.
- [x] Save remains explicit, pending state blocks duplicate sends, success follows authority confirmation; uncertain requests replay identically.
- [x] Successful save/explicit clear resets to an empty visible form, retaining confirmed receipts and work drafts.
- [x] Layout works on desktop/laptop/mobile. Old booking-deposit and client compatibility tests preserved.

## Verification and release

Typecheck; actual drawer/browser scenarios; real HTTP-to-Office facade synthetic financial flows; old/new-client cutover; balance/PDF/recovery checks; relevant backend tests and required CI/build for exact head. No live payment creation or customer messages.

Rollback: redeploy the prior production frontend only. No database rollback or receipt deletion; payments recorded during operation remain valid in either frontend. Verify current main/project/domains and production predecessor immediately before release. Standing audited merge/deploy authority and current visual approval satisfy the human boundary.

## Recorded evidence

- TypeScript: PASS.
- Balance/PDF: 13 PASS; draft/uncertain-write recovery: 8 PASS.
- Backend charge/edit-session regression: 45 PASS.
- Previous/current client cutover: 18 PASS.
- Independent focused browser review: 7 PASS, including first-edit version after pristine refresh and double-click idempotency.
- Full drawer and real HTTP financial suite plus exact-head CI/build results are recorded in the release PR.
- All fixture requests were local/synthetic; no real customer record or notification was used.
