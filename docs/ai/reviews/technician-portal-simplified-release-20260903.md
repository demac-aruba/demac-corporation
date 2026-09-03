# Review: Simplified Technician Portal production release

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / agent: primary release agent (`/root`), with separate read-only checks by `field_shell_flag`, `field_test_inventory`, and `simulator_flow`
Implementation author / agent: primary integration agent (`/root`) with bounded UI subtasks

## Scope reviewed

- Request/acceptance criteria: release the owner-approved, mobile-first Technician Portal; show only today's Aruba work; provide a temporary Super Admin selector for one Van or technician; preserve canonical Field authority; verify concurrent work before merging.
- Diff/commit: complete release tree through UI/mobile commit `6c7a329f`, based on production predeploy commit `1adfdd61`; canonical backend predeployed from reviewed SHA `628d32c6e300f111414ffbbafa11b52dd7c06e41`.
- Affected callers/integrations: ERP Next `/field`, authentication/role routing, canonical Scheduling reads, Field Operations HTTP authority, Work Visit/intervention/report mutations, Office Review, Firestore Rules, Storage Rules, Vercel production, and Firebase Functions deployment.
- Authorities and rule IDs: Scheduling owns planned date/Van/crew; Field Operations owns actual visits, work and reports; CRM owns Property/Asset identity; Firebase Authentication owns actor identity; `FIELD-DAY-001` and `FIELD-PREVIEW-001` govern today-only access and temporary simulation.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Critical — resolved | Production `fieldOperationsAuthority` endpoint and deployment workflows | The endpoint previously returned HTTP 404, so a frontend-only release would repeat the empty portal. | Deployed the reviewed authority before the client; run `33796220465` passed; direct CORS/auth probes passed; added a permanent main-only deployment workflow. |
| Medium — resolved | Mobile technician header/logout CSS | The fixed logout pill could overlap the header on narrow phones and did not reserve the top safe area. | Added safe-area-aware positioning and right-side header space; TypeScript, focused experience test and production build pass. |
| Medium — resolved | `.github/workflows/erp-next-ci.yml` | The new simplified-experience acceptance test existed but was not a permanent CI gate. | Added `npm run test:field-experience` to ERP Next CI immediately after the Field simulator gate. |
| Medium — follow-up | `functions/fieldOperationsAuthority.js` | CORS reflects the supplied Origin. Firebase bearer authentication and server authorization still fail closed, so this is not an authorization bypass, but an explicit production/preview allowlist would reduce browser-origin exposure. | DEMAC Engineering should harden the allowlist after phone UAT without delaying the approved functional-validation release. |

## Verification

- Required checks run: Functions syntax validation; complete Field authority suite; ERP Field experience, simulator, domain, security and offline suites; ERP TypeScript; transitive employee schedule/attendance/Work Order, Van profile and Projects preview tests; production Next build; diff hygiene; remote main/PR overlap audit; production function smoke.
- Results: all executed gates PASS. Field Functions report 352/352 tests. Next produced 56 static/SSG routes including `/field`.
- Security and permission cases: current-Aruba-day enforcement, assignment scoping, inactive/unassigned denial, stale-version failure, helper restrictions, Super Admin-only selector, and unauthenticated production API rejection pass.
- Business-invariant cases: next work is not duplicated in today's route; no Tomorrow/Week surface exists; selector has individual Van/staff identities only; `Llegada / Servicio / Cierre` is presentation grouping over unchanged canonical states; Professional Report renders once at close.
- Retry/concurrency/idempotency cases: the 352-test authority suite covers deterministic retries, optimistic versions, transaction rollback, immutable evidence/reviews, and current-assignment revalidation.
- Failure/recovery cases: no migration or production-data rewrite occurred. The temporary selector can be disabled by environment flag; UI/rules can be reverted while preserving canonical Field history; function deployment is repeatable from main and smoke-tested.
- Unverified areas: authenticated production phone flow and real assigned technician data were not available to the agent. The owner explicitly requested production as the device-UAT environment, so this remains a visible follow-up rather than a claimed PASS.

## Concurrent-change audit

- The release branch was explicitly synchronized to remote `main` after the function-first staging commit; no unmerged remote-main commit remained at review time.
- Open PR #474 has no overlapping files. Open PR #435 is the canonical Field foundation contained by this release and is expected to close when its commits reach `main`. Older PRs #440 and #436 touch shared Function package/bootstrap files but have not advanced `main`; they will require normal rebase/review after this release and do not introduce a current merge conflict.
- The original dirty Legacy worktree change in `src/components/AppShell.tsx` was never read into, modified by, or included in this release.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Residual risk, owner, and due date: DEMAC Engineering owns CORS allowlist hardening and removal of the temporary selector after owner phone UAT. The owner owns the immediate authenticated phone walkthrough after production deployment. No Critical or High release blocker remains.

Human approval still required before any action covered by the repository Human Approval Boundary: explicit owner authorization for this merge, production deployment, and its reviewed Rules/access effect was received on 2026-09-03. Separate approval remains required for migrations, secrets, destructive recovery, production-data deletion, Inventory/Billing/Accounting/QBO effects, or customer communication.
