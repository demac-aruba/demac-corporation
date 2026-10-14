# Task: read-only appointment preparation and safe report diagnostics

## Context and scope

Owner authorized continuation of the design in PR #597 on 2026-10-13. Implement a
usable preview of confirmed appointment work/receipts and classify report validation
failures. No accounting POST, mappings, new authority, production-data edits or permission
expansion. Base design commit: 4212f49; current main reviewed: f4369f3.

## Governance

Deep Review because this is a financial display and report boundary. Sources remain
Booking/Pricing/Field and QBO per AUTHORITY_MATRIX and OPS-SCHED-CHARGES-001/002,
FIN-QBO-PRODUCTION-READ-001. Preview uses the existing authenticated read; it does not
prepare provider-ready payloads or bypass historical reconciliation. No Legacy changes.

## Acceptance

- Fresh authorized read on explicit preview request; no automatic provider calls or writes.
- Reject stale versions/sessions and hide results on editing, source changes, failed reads,
  pending mutations, tab/cita/principal changes and close.
- Exact confirmed lines, active receipts, totals and Aruba receipt dates; distinguish
  operational balance from unverified QBO balance; no inferred mapping or tax configuration.
- No send button. Show required configuration and reconciliation blockers.
- Report diagnostics use a fixed allowlist, never provider values, paths, payloads or secrets.
- Preserve strict report checks and compatibility with the existing deployed backend.
- Prove numeric, privacy, async and browser behavior using synthetic isolated fixtures.

## Release and verification

Frontend may be previewed independently. Report backend remains pending a separately
reviewed update path: the initial installer still refuses an existing function. Source
pins must follow the reviewed source; do not weaken installation/revision checks.
Focused frontend/model/browser tests, types, production build/prebuild, relevant report
tests and source guards are applicable. Final results and adversarial pass are recorded
in the corresponding review before publishing the candidate.
