# Review: Technician Portal integration with current main

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: repository-audit agent (`/root/repo_audit`)
Implementation author / agent: primary integration agent (`/root`)

## Scope reviewed

- Request/acceptance criteria: integrate PR #435 with current `main`, test it and preserve current Scheduling behavior.
- Diff/commit: merge of `origin/feature/technician-portal-canonical-foundation` into `137441e15db03985bdb3299bda982433113a347e`, before remote publication.
- Affected callers/integrations: ERP Next `/field`, Field Operations Authority, Booking/Scheduling crew resolution, Legacy Technician direct Firestore reads, Firestore Rules, Storage Rules and deployment workflows.
- Authorities and rule IDs: Booking/Scheduling Authority, Field Operations Authority, CRM Asset identity, `OPS-TEAM-*`, `OPS-VAN-PROFILE-*`, `OPS-SCHED-*`, `PRICE-*`.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Critical | `src/state/AppState.tsx:189-197`; `src/state/TechnicianPortalState.tsx:132-136`; `firestore.rules` | Legacy technicians list complete collections, while the hardened Rules authorize only assignment-scoped resources. Firestore rejects queries that cannot prove every returned document is authorized. Because the reads use `Promise.all`, one denied collection can block the fallback application's operational refresh. | Add and execute emulator coverage for the real Legacy list/query shapes, then move technicians to assignment-scoped queries/Field Authority or otherwise provide an approved secure compatibility path. Do not weaken the assignment Rules back to global reads. |
| Critical | `.github/workflows/erp-next-ci.yml`; `.github/workflows/firebase-rules-deploy.yml`; `functions/bootstrap.js` | A push to `main` deploys the new frontend through the connected Vercel project and deploys Rules, but there is no production workflow for `fieldOperationsAuthority`. This violates the documented server-before-client rollout and can expose a UI whose canonical API is unavailable while simultaneously changing Legacy access. | Establish an explicit function-first deployment and smoke-test step before activating client and Rules. |
| High | `firestore.rules:73-83`; `storage.rules:25-36` | Rules accept `users/{uid}.vanId == workOrder.vanId`, but do not resolve date-scoped `dailyVanAssignments`. A stale profile Van may grant broader direct-datastore access than the Field server authority. | Align direct Rules access with canonical dated membership, or remove technician direct access in favor of the server-authorized read boundary. Add stale/reassigned Van denial tests. |
| High | `firebase/technicianPortalRules.test.cjs` | Existing rule assertions use document reads and media paths, but do not exercise Legacy collection queries or the production client's exact query constraints. | Add query/list regression cases for responsible technician, helper, reassigned technician, stale Van and unauthorized known IDs. |
| Medium | `functions/fieldOperationsAuthority.js` | CORS reflects an arbitrary Origin. Bearer authentication remains required, so this is not authorization bypass by itself, but it is looser than the explicit production-origin posture elsewhere. | Restrict allowed origins before wider production rollout and test preview/production origins explicitly. |

## Verification

- Required checks run: Functions syntax; 348 Field tests; 152 Booking/Scheduling tests; ERP Next typecheck; focused client contract suites; production build.
- Results: all executed code gates PASS.
- Security and permission cases: server/client Field denial suites pass; direct Rules list/query compatibility remains unverified and is a blocking finding.
- Business-invariant cases: current Scheduling capacity ownership and blank daily crew-slot semantics pass after the combined merge resolution.
- Retry/concurrency/idempotency cases: Field command suites pass.
- Failure/recovery cases: no migration occurs; merge revert is available, but a rollback must preserve any canonical Field records created after activation.
- Unverified areas: authenticated visual UAT, production service templates, production Function deployment and exact deployed Rule state.

## Decision

- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Block / changes required

Residual risk, owner, and due date: production/main merge remains blocked until DEMAC Engineering closes the two Critical findings and records authenticated UAT. The owner has approved merge/deployment in principle, but approval does not convert a failing mandatory gate into PASS.

Human approval still required before any action covered by the repository Human Approval Boundary: received for the requested merge/deployment on 2026-09-02; any materially different migration, secret change or destructive recovery still requires separate approval.
