# Task: publish scoped Projects editor and historical Regular slot correction

## Context

- Request/source: DEMAC owner requested merge and deployment for live testing on 2026-09-27.
- Product surface and users: ERP Next Projects editor and Scheduling appointment details for authorized Office operators.
- Current behavior/evidence: PR #530 and PR #534 are independently green but Draft; #530 needs `projectAuthority` backend and #534 needs `officeBookingAuthority`. Main is `db28207522a5fb5b4e4a77822ef70570fe947513` at integration start. PR #514 conflicts with main and PR #526 has failing CI; neither belongs to this scoped candidate.

## Scope

- In scope: integrate the exact #530 and #534 heads with current main; extend the existing guarded Office/Project release source allowlist to the last successful release `d029ee4b9c5d9ffdc395f51ae9edb48f783d4ea2`; verify deployed-source fingerprints include the new Regular correction module and its direct safety dependencies.
- Out of scope: central Projects #514 activation/import or Firestore restore, Technician App #526, real customer data tests, financial actuals, payroll, billing, permissions and security rules.
- Files/boundaries expected: existing Projects/Scheduling UI, Office and Project Functions, and `scripts/project-history-approved-deploy{,.test}.cjs`; no new authority or database.

## Governance

- Authority owner(s): Booking Authority owns Appointment, Work Order and capacity locks; `projectAuthority` owns shared Project planning and links.
- Business-rule IDs: OPS-SVC, OPS-SCHED and existing Project historical-capacity rules.
- Security/privacy impact: no new role grant or public data route. Production backend source must be checked against an immutable approved generation before replacement.
- Legacy parity impact: none; Legacy code is unchanged.
- ADR/debt impact: no new architecture decision; release uses the existing guarded workflow.

## Acceptance criteria

- [x] Both PRs combine with current main without source conflicts and focused Projects/Scheduling tests and ERP production build pass locally.
- [x] Guard tests accept the last successful Office/Project generation and reject an independently changed direct dependency before either Function is deployed.
- [ ] Exact combined-head GitHub CI and independent adversarial review pass.
- [ ] Owner confirms the scoped release; no production record is mutated as a test fixture.
- [ ] Guarded backend release finishes ACTIVE with anonymous denial and expected CORS, followed by both ERP Vercel production deployments READY and an authenticated owner smoke test.

## Plan and risk

- Implementation outline: merge a reviewed integration PR to main with `[merge-only]` so automatic production jobs and Vercel do not race; advance the governed release branch to the exact main source tree; let its required acceptance precede the guarded Office/Project deployment; then use a docs-only unmarked main commit to publish the already validated frontend.
- Migration/rollback or recovery: no data migration. Before real use, the prior Vercel deployment can be restored. After historical corrections or property-free Drafts exist, do not restore an older database or blindly downgrade backend code; retain audit and use a reviewed forward fix if needed.
- Key risks and mitigations: deployed source drift is fail-closed by exact ZIP comparison; mixed frontend/backend versions are avoided by backend-first release; main drift requires a fresh comparison before each ref move; Project #514 and Technician #526 remain excluded.

## Verification

- Automated gates: 19 focused Functions tests, Firebase validation, ERP typecheck, Projects prebuild acceptance, slot-progress acceptance, Scheduling acceptance and ERP production build passed on the combined local tree; guarded release tests 8/8 passed after the allowlist/fingerprint update.
- Manual scenarios: owner authenticated Projects edit and historical Regular slot correction after release, without creating synthetic customer records in production.
- Evidence/results: local integration branch `chore/projects-scheduling-integration-20260927` from main with #530 and #534 merged; no production change made by this task as of this document.
- Not run and why: exact combined-head remote CI, current live Function ZIP comparison and owner smoke are release gates, not simulated local success.
