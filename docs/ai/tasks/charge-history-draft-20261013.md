# Task: keep fresh work drafts confirmable after History

## Context and scope

The owner again reports missing final/balance after PR594. His new screenshot shows
one saved 250 AWG receipt, no work editor and no final. Production serves reviewed
source e9bda95. This is compatible with the previously lost draft; the screenshot
alone does not prove a new loss or establish the full stored history.

Independent synthetic reproduction found a separate general defect: a fresh draft
becomes stale after History releases and reacquires its edit lease, even though no
financial evidence changed. Scope: fix this rebase, preserve all financial review
and retry guards, and verify booking isolation. Deep Review applies to recovery of
financial state. No production data repair, backend runtime changes, migration,
accounting writes, auth changes or communications.

## Governance and implementation

Office Booking Authority owns operational finals/receipts; QBO remains accounting
authority. OPS-SCHED-CHARGES-001/002 and the draft-recovery ADR remain in force.
Extend the existing exact-baseline rebase to fresh editing drafts after a version
increase. Compare all financial state, receipt details, Field fingerprint, blocker
and appointment status; only lease version is excluded. Require a fresh successful
read, no busy/pending operation or blocker. Reset scope/Field review. Do not rebase
an open payment form or a changed financial baseline. Existing server enforcement
and legacy consumers are unchanged.

## Acceptance and verification

- Fresh 3 × 125 work, saved 250 transfer, History/back: retain lines and 125 preview,
  require new review, allow final confirmation; refresh and PDF retain 375/250/125.
- Another actor changing the baseline, even with equal amounts, must stay blocked.
- Two bookings with identical request IDs remain isolated; exact retries do not
  duplicate receipts and cross-booking void is rejected without writes.
- Run focused browser flow, drawer/concurrency suite, backend charge suite, ERP
  typecheck/prebuild/build, final CI and independent diff/authority review.
- All browser/database writes use synthetic isolated fixtures. Read-only production
  verification checks exact source/deployment/assets, not customer financial CRUD.

Local results: 37/37 charge authority tests and 7/7 real component/HTTP/Office
browser flows passed, including the new History and foreign-baseline cases. The
56-case drawer/concurrency suite, ERP typecheck and full prebuild/production build
passed. Independent review reproduced the defect before correction, then directly
confirmed 375/250/125 after History without refresh and verified two-booking and
fresh-browser persistence. Local synthetic 1000-item search retained 40 rendered
results, median 49 ms/p95 111 ms to two animation frames, with zero network requests
while typing. These timings are not production latency claims. CI and deployed
source verification remain release gates recorded with the PR/deployment.

## Recovery and release

Same-tab recovery is not server persistence. Another tab, origin, browser or explicit
sign-out has no ordinary local draft. A confirmed final is server-persisted. Earlier
lost inputs cannot be reconstructed from a receipt or projection. Re-entering actual
work must not recreate the existing receipt. Do not silently infer or repair a real
appointment without its exact stored identity/history and reviewed work scope.

Publish the reviewed branch to demac-aruba/demac-corporation main, then the verified
source to Vercel project prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7, team
team_DMKv1yhhUjnR4Pu141k3iwuX, https://www.demac-aruba.com/ and its apex alias.
Standing owner authorization covers audited merge/deploy. Rollback frontend to
dpl_49Uj2yWeocJVJa3qKdbjL5EqMV5L (e9bda95), retaining every payment, confirmed
final and recovery copy. No backend/rules/configuration deployment is needed.
