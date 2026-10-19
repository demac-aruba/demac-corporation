# Review: Appointment message formatting and controlled source publication

## Review mode
Solo Maintainer Adversarial Review. Builder and reviewer: Codex. This is a separate post-implementation review, not independent review.

## Scope
Approved customer copy and two-line address presentation; saved-location validation and fallback; customer recipient/language preparation; technician daily/same-day/support callers; exact patch scope; source transport, private recovery, runtime identity, operation provenance and deployment concurrency. Authority: Booking snapshots and existing Communication Authority. No financial, scheduling-capacity, contact-selection or send-eligibility rule changes.

## Findings and corrections
| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Default deployment workflows can publish unrelated source and configuration. | Merge-only commit and five-function source-only release using existing proven transport/update helpers. |
| Medium | Later branch edits could silently change approved application files. | Freeze all six source files to the reviewed application commit and require exact main/release checkout identity. |
| Medium | Earlier functions could change while later functions finish publishing. | Final sweep verifies all five revisions, source hashes, runtime configuration, IAM, schedules and traffic. |
| Low | Primary support alert repeated the selected location. | Preserve legacy property location only when no saved dwelling label exists. |
| Low | Local checks used a dependency symlink into another worktree. | Replace it with an isolated install; rerun the same mandatory checks. |

## Verification and decision
The original 136 message tests and 19 release/transport/operation tests passed. Focused review inspected complete source changes and transitive render callers. Negative tests retain recipient exclusions, property/dwelling mismatch denial, unknown/legacy identity handling, privacy allowlists and exact retries. Release tests reject additional files/functions, missing private/archive proof, dependency drift and invalid transport; reused operation tests cover lost responses, active/unrelated operations, failed publication and provenance.

The isolated local recheck passed: 136 message tests and 19 release tests, with zero failures or skips. Maintainer review passes; exact-head CI remains the merge gate. Production checks then validate the actual bundles with their deployed locks before the first source PATCH. No real customer-message test is authorized or required for this presentation-only change.

Residual risk: a platform failure can leave a partial five-function rollout; the workflow stops with private baseline/candidate archives and precise operation evidence for investigated recovery. No automatic replay or rollback. Owner: maintainer during this release. Christian's explicit publication/merge/deployment approval is already recorded; no additional approval is required for this defined scope.
