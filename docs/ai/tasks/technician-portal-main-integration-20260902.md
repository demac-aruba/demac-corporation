# Task: Integrate the canonical Technician Portal into current main

## Context

- Request/source: On 2026-09-02, after reviewing the audit and deployment distinction, the business owner explicitly authorized merging and testing the canonical Technician Portal.
- Product surface and users: ERP Next `/field`; responsible technicians, helpers, Operations and Office Review.
- Current behavior/evidence: `origin/main` renders the browser/localStorage Field preview. PR #435 contains the canonical Field Operations implementation but remains draft, unmerged and based on an older main.

## Scope

- In scope:
  - integrate `origin/feature/technician-portal-canonical-foundation` into the current `origin/main`;
  - preserve newer Scheduling behavior while resolving the known merge conflict;
  - run the applicable ERP Next, Functions, Firebase Rules and Legacy regression gates;
  - publish and verify a preview when the connected deployment workflow permits it;
  - merge to `main` only after all mandatory gates pass.
- Out of scope:
  - redesigning the portal to match the 2026-09-02 visual specification;
  - production-data migration or backfill;
  - inventing new service templates, prices, stock movements or invoices;
  - deleting Legacy/browser compatibility code;
  - changing secrets or credentials.
- Files/boundaries expected: ERP Next Field UI/contracts, Firebase Field authority, Firestore/Storage rules, Booking/Scheduling crew helper, Field documentation and CI gates.

## Governance

- Authority owner(s): Scheduling/Booking Authority owns planned work and crew readiness; Field Operations Authority owns actual visits and interventions; `staffProfiles` owns staff identity; CRM owns Property/Asset identity; Inventory and Billing remain downstream authorities.
- Business-rule IDs: existing `OPS-TEAM-*`, `OPS-VAN-PROFILE-*`, `OPS-SCHED-*`, `PRICE-*`; no rule intent is changed by this integration.
- Security/privacy impact: high. The integration changes authenticated Field endpoints and Firestore/Storage access rules. Explicit owner approval for merge/deployment was received in the task conversation on 2026-09-02.
- Legacy parity impact: Legacy remains the operational fallback. No Legacy records or compatibility code may be removed.
- ADR/debt impact: adopt the already documented Technician Portal canonical architecture; reconcile documentation if validation changes its evidence.

## Acceptance criteria

- [ ] Given current `origin/main`, when the canonical Technician Portal branch is integrated, the resulting tree contains the server-authorized `/field` flow and preserves the newer Booking/Scheduling behavior.
- [ ] Given a responsible technician or helper, Field reads/actions remain assignment-scoped and server-authorized; direct access, stale versions and duplicate retries fail according to the canonical contracts.
- [ ] Given an unauthorized employee or unrelated technician, Firestore, Storage and Field API deny access to another assignment.
- [ ] Required ERP Next typecheck/build, Field/Functions tests, Booking/Scheduling regressions, Firebase Rules tests and release-relevant Legacy gates pass without weakening or skipping checks.
- [ ] The resulting visual portal is inspected in a non-production preview before completion when deployment access is available.
- [ ] No production data is migrated, deleted or silently backfilled.
- [ ] The merge/deployment outcome and rollback commit are recorded.

## Plan and risk

- Implementation outline:
  1. create a clean integration branch from current `origin/main`;
  2. merge the canonical branch without rewriting its history;
  3. resolve the Booking/Scheduling conflict by preserving current main semantics and adding only the Field membership helper needed by the canonical implementation;
  4. run mandatory automated gates;
  5. perform a separate adversarial review;
  6. publish/inspect preview and, if green, update `main`.
- Migration/rollback or recovery: no data migration. Rollback is a revert of the resulting merge commit and UI removal/hide while preserving any canonical Field records that may have been created after release.
- Key risks and mitigations:
  - stale branch versus current main: inspect merge-base and affected callers, then run transitive Booking/Field suites;
  - security-rule regression: run emulator allow/deny suites before push;
  - automatic production deployment from `main`: owner authorization is recorded; verify workflows and deployment after merge;
  - visual mismatch with the new screenshots: explicitly treat this merge as evaluation of the previous canonical portal, not acceptance of the new visual design;
  - production service definitions may lack Field templates: do not claim full operational readiness until configuration is verified separately.

## Verification

- Automated gates:
  - `npm run validate:firebase --prefix functions` — PASS.
  - `npm run test:field-authority --prefix functions` — PASS, 348/348.
  - `npm run test:booking-authority --prefix functions` — PASS, 152/152.
  - `npm run typecheck --prefix apps/erp-next` — PASS.
  - ERP Next dispatch, lifecycle, Booking Intelligence, Booking Copilot, live Scheduling, employee schedule, employee-attendance Work Order, Van profile, Field domain, Field security and Field offline contract scripts — PASS.
  - `npm run build --prefix apps/erp-next` — PASS; 54 static/SSG routes generated, including `/field`.
- Manual scenarios: login/role route, assigned schedule, open job, visit action, equipment/intervention view, report readiness, helper restrictions, Office Review, mobile viewport.
- Evidence/results: the integrated tree compiles and all applicable local code suites above pass. A separate review found a production-blocking Rules/Legacy query incompatibility and missing function-first deployment sequence; therefore these results authorize an integration preview only, not `main`.
- Not run and why:
  - Firebase emulator Rules suite was not rerun locally because this host has no Java runtime. The merged Rules are byte-identical to the previously recorded feature-branch Rules evidence, but that evidence does not cover Legacy collection-list queries.
  - Authenticated visual UAT remains pending. Browser-control setup failed on this host before page inspection; the dev server and production build both start successfully.
  - Production smoke tests are not run because no production deployment has occurred.
