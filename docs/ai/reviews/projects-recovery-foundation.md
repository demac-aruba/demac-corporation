# Review: Projects recovery and read-only reconciliation foundation

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Implementation author and reviewer: ChatGPT. This is a separate adversarial self-review,
not an independent technical review. Review scope is the first recovery increment only.

## Scope reviewed

All newly added recovery/reconciliation modules, tests, isolated recovery route, component,
CSS, declaration contract, dedicated CI and supporting task/ADR. Existing caller/source
contracts reviewed: browser Project persistence, planner, Booking Work Order fields, Work
Visit identity/lifecycle and the existing provisioned-user authentication pattern.

No existing domain writer, planner, Scheduling/Field/CRM file, deployment export, Firebase
rules, production setting, Legacy source or Performance & Health component is modified.

## Findings

| Severity | Evidence and impact | Correction / disposition |
| --- | --- | --- |
| Medium | Valid JSON `null` was initially indistinguishable from an absent raw key in inspection. | Track successfully parsed keys; flag unsupported null source. Regression test added. |
| Medium | An unknown visit status or malformed startedAt could be presented as valid execution evidence. | Known status and timestamp checks; block aggregates on unresolved Field evidence. Regression test added. |
| High / release blocker | Neither browser-origin data nor real canonical records have been obtained. | Do not claim the real Project is backed up, reconciled or corrected. Keep merge/migration blocked. |
| High / release blocker | Central persistence and the live Field actuals bridge are not part of this increment. | Actual hours/progress remain null in diagnostics. Registry and bridge are next scoped increments. |
| Medium / pending | UI/browser and real Firebase emulator authorization/snapshot tests have not run locally. | CI types/build plus dedicated browser/emulator acceptance are required before release. |

## Verification

- `node --check` on the three new runtime JS modules: PASS.
- `node --test functions/projects/*.test.js`: 42 PASS, 0 FAIL, 0 skipped (Node 22.16.0).
- Independent Node crypto checksum cross-check: PASS as part of the test suite.
- Storage double permits only exact Projects getItem calls and throws on writes/deletes.
- Database double requires readOnly transactions and bounded scoped queries; throws on writes.
- Tests cover token failure, forged token role, absent/inactive/unauthorized user, scope limits,
  truncated evidence, duplicate/conflicting source IDs, Customer/Property/Appointment mismatch,
  multiple vans, candidate support work, general work, cancelled history, return visits,
  rescheduled snapshots, malformed backups, invalid/null data and exact retry/no mutation.
- Error output and UI do not expose tokens or raw customer/project bodies.
- Unknown progress and measured time are never synthesized from local or scheduled hours.
- Existing repository checks are neither weakened nor disabled. Full ERP types/build and
  transitive suites are delegated to CI; no full local repository checkout was available
  because network name resolution failed. A passing test double is not emulator evidence.

## Decision

- [ ] Pass / ready for merge
- [ ] Pass with recorded follow-up / ready for merge
- [x] Block release; retain as draft implementation evidence

Residual risks: the real backup, real reconciliation, central persistence, Field actuals,
browser acceptance and emulator verification remain open. Owner: Projects workstream
maintainer. Required before release, not assigned an invented delivery date. A preview URL
must not be represented as containing the original production browser's storage.

Human approval is still required for merge, deployment, changes to security access and any
production-data migration. No production read or write was performed by these tests.
