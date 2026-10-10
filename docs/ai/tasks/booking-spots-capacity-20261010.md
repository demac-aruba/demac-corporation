# Task: Spots and explicit support decisions in Booking

## Context and authorized scope

Owner requested Spots terminology, automatic workload/remaining capacity, removal of the redundant line-count summary, and reuse of existing support/overtime workflows. Owner explicitly authorized merge and production deployment after a deep audit. No customer/appointment data mutations are part of this release.

Base includes merged #564 modal/navigation and #565 appointment-detail changes. Work branch: `fix/booking-spots-capacity`.

## Authority and rules

- Booking Authority remains the only allocation/Appointment/Work Order/lock writer.
- Existing offer, confirm, hold, lifecycle, selected support slots and overtime-consent commands are reused. No new endpoint or collection.
- `OPS-SCHED-SPOTS-001` extends existing canonical service-duration and capacity rules. No pricing, payroll, permissions or Project capacity policy changes.
- Field receives a narrow projection guard so an operational helper does not inherit the principal's entire service list. Only new marked helpers are affected.
- Deep Review follows AGENTS.md; independent review: `../reviews/booking-spots-capacity-20261010.md`.

## Acceptance criteria

- Catalog/manual duration remains canonical minutes; operator sees Spots and immediate estimated workload.
- Remaining uses actual dated Van capacity, refreshed by the same availability response; a current selected allocation subtracts primary owned slots.
- Remove regular Work lines summary while preserving Project task and all work selectors, notes, attachments, contacts, messages and charges.
- Existing Standard 7-unit full-day exception stays intact. Projects, after-hours, weekly-rest, historical and partial-completion boundaries remain separate.
- Mixed/manual overload uses the existing helper selector with deliberate selection. Primary owns all billable work exactly once; helpers use existing nonbillable operational-support projection.
- Overtime requires existing explicit fresh consent, protects lunch, exact retries and overlapping Van/crew reservations. It never writes worked/payroll time.
- Generic helper confirmation/hold rechecks crew, dated calendar and capacity atomically; invalid or stale choices create no partial records.

## Risks and release

Risk: helper projection could duplicate planned Field services or billable work. Mitigation: primary-only scope; helper discriminator preserved through holds/lifecycle; Field guard deployed and verified before Office emits marked helpers.
Risk: stale availability or shared workers. Mitigation: signature-bound UI, canonical offer revalidation, transaction reads and locks, duplicate-crew rejection.
Risk: unrelated deployed Field dependencies differ from current Office. Mitigation: source-only four-line backport onto verified Field baseline `b10ae55898b86fd3e446384c67e57350e32a4d87` (successful run37855951032), retain exact deployed dependency lock/config, reject unknown drift.

Release: merge with `[merge-only] [deploy-booking-spots]`; CI runs full applicable Booking/Field, independent cases, financial real-Firestore and browser gates. Bounded Field guard first, then Office, then ERP production using the tested PR source with a tree equal to merged main. Other function auto-deploys remain suppressed.

No migration, existing document rewrite or real booking test. Rollback frontend/Office must retain the harmless Field guard while marked helpers may exist; removing it would reintroduce fallback duplication. Prefer forward correction for already created marked appointments.

## Verification

Local initial evidence: 98 focused backend cases; full Booking/Field suites; independent regression suite; browser interaction/visual suite; release drift/config/source tests; previous-generation Field compatibility; Next build and typecheck. Final counts and CI/deployment identifiers recorded in PR and release follow-up. Local complete suites: 239 Booking cases and 425 Field cases, all pass; 34 real-modal cases pass; 7 release/compatibility cases pass. Next build and typecheck pass. Production frontend observed before this release: `dpl_BmX1Q8WMugiXc5dcTWFAJZamquN7`, source `f7dff6ba5e744da643a3e2ba20b3f787faacc530` (#565).
