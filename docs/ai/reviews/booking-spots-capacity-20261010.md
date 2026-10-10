# Review: Booking spots, shared workload support and morning capacity overtime

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: `/root/booking_followup_review` (test and review artifacts only).
Implementation author / agent: `/root`.

## Scope reviewed

- Owner-authorized follow-up: express Regular Booking workload and remaining capacity in spots; remove the Work lines count; reuse existing support selection or explicit possible-overtime acceptance for overloaded work. Preserve Project, pricing, references, customer communications, history, holds and exact retry.
- Final integration baseline: `359b9b30a575208c8c390c41a2919561c33cbf37`, including appointment-detail PR #565, booking modal follow-up PR #564 and pricing/payments PR #563. Branch: `fix/booking-spots-capacity`.
- Review status: final local implementation reviewed; no unresolved blocking finding. Production release still requires the exact published tree to pass the existing CI and deployment gates.
- Authority: Booking Authority owns availability, assignments, Work Orders and atomic locks. Catalog duration stays authoritative. Pricing/charges, Project links, Field execution and payroll retain their existing authorities. No migration or real customer/appointment writes are part of verification.
- Relevant rules: `OPS-SVC-*`, `OPS-TEAM-*`, `OPS-ROUTE-*`, `OPS-SCHED-SUPPORT-001`, `OPS-SCHED-CREATE-OT-001`, `OPS-SCHED-PLANNED-OT-002`, `OPS-SCHED-PLANNED-OT-PROJECT`, `OPS-SCHED-REFERENCES-001`, `OPS-SCHED-CHARGES-001`.
- Direct/transitive owners inspected: scheduling provider/engine/primitives/capacity; Work Order projection; core normalization and Appointment draft; create/hold/lifecycle transactions; ad-hoc support projection; bounded overtime authority; Field planned-work projection; scheduling read projection; technician communications; Project link wrapper; partial completion and historical capacity guards.

## Findings and implementation constraints

| Severity | Location | Evidence and impact | Required correction / status |
| --- | --- | --- | --- |
| High | `bookingAuthorityWorkOrders.workItemsForAssignment` | The existing mixed-work branch copies every selected line onto every assignment. Extending mixed jobs to support without a projection change duplicates planned customer work. | Resolved: primary keeps exact canonical quantities/durations; new marked helpers use the existing linked, nonbillable support projection. Independent mixed/manual tests pass. |
| High | `fieldOperationsAuthorityCore.plannedWorkItems` and Field review | Empty helper workItems falls back to the Appointment's complete workLines. A synthetic positive generic support item instead becomes planned work that Office Review requires reconciling, while interventions require a real catalog Service. | Resolved: four-line guard suppresses fallback only for newly marked nonbillable workload-resource helpers. Existing ad-hoc and primary projections remain unchanged. Actual Field baseline compatibility tests pass. |
| High | Core normalization, draft, hold reconstruction, lifecycle patches | New support semantics must survive stored offer normalization, Appointment persistence and all later Work Order rebuilds. Lifecycle writes merge old documents, so stale helper markers can incorrectly exclude later ordinary service quantities. | Resolved: marker persists through the chain; obsolete scheduling markers clear when changing allocation kind. Independent hold and lifecycle test preserves amount, paid, invoice, creation and communication receipt. |
| High | `bookingRestDayOvertime` | The afternoon planner's contiguous arithmetic cannot represent a morning lunch gap. First implementation also extended the half-day 11:30 spot into 12:30 lunch. | Resolved: actual worked anchors and final partial spot determine end; half-day extension begins at 13:30. Independent failing regression now passes; midnight, future reservations, absence and consent guards remain. |
| High | New workload-support crew capacity | Existing Van-only candidate checks do not establish distinct personnel across all Vans. | Resolved for the new path: duplicated crew denied, dated membership/readiness/calendar read again atomically, overlapping staff reservations checked. Transaction-time maintenance and crew changes leave no partial writes. |
| High | Canonical workload changes between offer and commit | An old selected allocation must not be committed after Scheduling Work Type or explicit catalog Service duration changes. Reusing stored assignment minutes alone under-reserves the new workload. | Resolved: revalidation and transaction resolve the canonical scope again, compare line identity/quantity/minutes, and require exact assignment-minute conservation. Four independent negative cases cover both sources before preflight and after successful preflight; all deny with no Appointment, Work Order or lock writes. |
| Medium | Standard Service exception and fallback | Ordinary seven-unit/six-spot fit must not become an overtime booking; the old 7+N selector cannot fit an eight-unit afternoon request. | Resolved: default seven-unit full-day route retained and overtime denied; afternoon overload can choose sufficient support. Governed 90-minute Standard duration must physically fit before the exception applies; independent regression accepts its 630-minute overtime proposal, with 11 spots and the protected lunch gap. |
| Medium | Support projection and Temporary Holds | The reused ad-hoc snapshot hardcodes confirmed status and new creation metadata. Holds and existing lifecycle rebuilds have different invariants. | Resolved: hold status/silence and existing audit/domain state preserved; confirmation and cancellation cover every allocation and lock. |
| Medium | Project and special booking boundaries | Project work uses manual workload but has separate slot/budget and weekly-rest permissions. Generic overflow must not silently extend its allowed paths. | Resolved: provider explicitly excludes Project from the new workload support policy; existing Project overtime authority restriction remains. |
| Medium | Remaining primary capacity after help | Subtracting total workload from primary Van capacity hides remaining spots after selecting additional help. | Resolved: use the current validated primary assignment's spots. Real-modal regression verifies deliberate selection, additional support revealing remaining primary capacity, and deselecting all helpers disabling confirmation again. |

## Verification

- Reviewer ran `node --test functions/bookingSpotsIndependentReview.test.js scripts/booking-spots-field-deploy.test.cjs scripts/booking-spots-field-compat.test.cjs`: **22 PASS, 0 skipped**. This includes **15 independent booking regressions** using the existing synthetic MVCC store with atomic rollback and read-before-write enforcement, plus real provider/create/lifecycle/overtime/projection code. No Firebase initialization or production network is used.
- The remaining **7 release/compatibility cases** verify wrong branch/main identity, deployed dependency drift, redirected/dynamic imports, lock preservation, candidate retry, unchanged configuration, denied anonymous access and downloaded published source identity. Compatibility runs the previous deployed generation's Field core, Work Visit, disposition and Professional Report tests with only the new guard overlaid. Evidence: local `booking-spots-review-final.log`.
- Reviewer independently traversed the actual prior Field runtime graph using the release script's dependency parser: **151 files, zero unresolved dependencies**.
- Reviewer ran `git diff --check`: PASS.
- Inspected Builder logs: existing Booking Authority suite **239 PASS**; Field suite **425 PASS**, no skipped cases. Parent owns final release/frontend gates and exact-head CI.
- Inspected all **34 PASS** results from the real-modal browser suite, retaining the existing 31 cases including pricing/deposits and round-trip recovery. Added coverage checks immediate spots, actual dated free-capacity snapshots, and deliberate mixed-work helper selection/deselection with remaining primary capacity. Browser fixtures block every external request. Independently inspected the final workload and overflow screenshots; the requested column layout and compact footer remain intact.
- Test adaptations are intentional visible-contract updates: hours → spots, hidden Work lines count, renamed explicit overtime action, provider version v16 and generalized overtime explanation. Existing failure/no-write/idempotency assertions remain.

## Field release isolation

- Read-only GitHub Actions verification identified actual Field production source `b10ae55898b86fd3e446384c67e57350e32a4d87`, reviewed main `fc09e0be77f22ec67b87af66f546a0464fc7a11a`, run `37855951032`, successful deployment job `113580098814` on 2026-10-08. Logs report revision `fieldoperationsauthority-00007-hiz`, configuration preserved and 355 source files verified.
- All 36 successful push runs after that release were checked. Newer Field run `38088318842` at `20a9747` validated successfully but its deployment job was skipped. This is workflow evidence; the release script must still verify the actual running source immediately before deployment.
- `booking-spots-field-deploy.cjs` requires the explicit main release marker and exact current main SHA, compares the deployed runtime dependency graph against the approved baseline/candidate, preserves the running dependency lock, and stages only the four-line guard on the previous Field generation. It refuses unrelated transitive source drift or changed imports. No newer Office dependency tree is copied into Field.
- Workflow runs the reviewed Field guard before Office begins emitting the new helper records; all three validation jobs gate production and Field deployment shares the existing Field production concurrency group. Auth denial, unchanged runtime configuration and downloaded published runtime graph identity are checked after the source update. Reviewer performed no deployment, credential operation or production data write.

## Residual limits and release conditions

- Verification uses synthetic records and browser backends. It proves the covered code paths and invariants; no real customer Appointment was created, edited or cancelled to test this change.
- Exact-head CI, production source/configuration checks, and final frontend/backend source verification belong to the release owner. A failed required gate or unexpected deployed Field drift remains blocking; this review does not waive it.
- The Field guard must remain after an Office/frontend rollback because new marked helpers may already exist. Existing unmarked records are unchanged; there is no migration or backfill.

## Decision

- [x] Pass
- [ ] Pass with recorded follow-up
- [ ] Block / changes required

Production merge/deployment belongs to the parent agent under the owner's authorization, after the final reviewed tree passes all applicable gates. This reviewer performs no production writes, deployments or data migration.
