# Projects integration with the current main branch

Main advanced from cb01c469 to 6d501d80 through PR #516 while the owner verified
the production database export. Integrate that reviewed bounded manual-overtime
change into Projects without replacing either branch's scheduling guarantees.

## Conflict resolution and review

- Preserve both operational-cost and manual-overtime business-rule sections.
- Derive the capacity end from every reserved slot and the elapsed-work end, then
  persist it consistently on the Appointment, assignment and Work Order for both
  ordinary and overtime moves. Preserve explicit overtime consent, crew validation,
  reservation contention, audit and exact-retry receipts from main.
- Extend the existing overtime acceptance/retry regression to prove that a later
  ordinary move across lunch retains capacity through 14:30 although elapsed work
  ends at 12:30. Replaying the earlier overtime request performs zero further writes.
- Adapt main's new reschedule regression to the Projects stable-request-ID contract;
  retain its assertions that current overtime clears and historical acceptance survives.
- Review the automatically merged Office API, client call sites and lifecycle mutation:
  keep Projects token-bound rescheduling/recovery and main's prepare/confirm overtime
  boundary. Type checking and integrated contracts cover the combined signatures.
- Preserve main's existing conditional `[merge-only]` deployment guards and Vercel
  ignore commands without changing them. They do not disable every production workflow;
  do not treat that marker as universal deployment prevention.

This is a separate adversarial self-review of the integration, not an independent
review of PR #516 or a repetition of the completed Projects audit.

## Verification

Node 22: 75 Booking/manual-move/capacity/lifecycle/Office contracts passed, zero failed
or skipped. Eight real Firestore emulator tests passed on demo-demac-overtime,
including concurrent ordinary booking versus overtime, after-hours contention,
authorization, cancellation and exact retries. ERP typecheck and live Scheduling plus
Saturday drag acceptance passed. The combined PR workflow now also runs the eight
overtime emulator tests beside the existing Projects/#515 matrix; fresh remote CI is
required for the published integration commit. Historical 60ed5274 CI is not substituted.

## Recovery evidence

The owner's Cloud Shell screenshot confirms the full default Firestore export completed
at 2026-09-21T17:19:07.158122Z: done=true, SUCCESSFUL, 111827 documents and 118758455
bytes; the overall metadata object was listed. The private storage destination is
recorded in local release evidence, not copied into this repository. No record data
was downloaded or published. This evidence does not certify restoration, canonical
relationship reconciliation or recovery time.

The owner deferred photos/attachments and future scheduled full backups. The prepared
recovery rehearsal targets a newly created named database, never the live default
database. Original browser Projects/templates remain a separate requirement before
real central adoption/import. No production merge, restore, import, activation or
configuration change was performed as part of this integration.
