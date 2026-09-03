# Task: Field portal limited to today with safe admin simulator

## Context

- Request/source: Owner requested that technicians see only the current Aruba workday and that a temporary selector allow previewing each technician or Van with the real Scheduling data.
- Product surface and users: ERP Next `/field/`; technicians, helpers, Operations readers, and Super Admin preview users.
- Current behavior/evidence: The UI offers Today/Tomorrow/Week and calls the undeployed `fieldOperationsAuthority` Function, which currently returns HTTP 404. Scheduling itself already reads the canonical `workOrders` agenda successfully.

## Scope

- In scope: Remove future-range UI, request only today's schedule, add a preview-only Super Admin selector for Vans/technicians, project today's real agenda read-only, and provide an isolated browser-only workflow simulator.
- Out of scope: Deploying Cloud Functions or Firestore Rules, mutating a real Work Order as another technician, production impersonation, and changing canonical Scheduling assignments.
- Files/boundaries expected: Field client UI, a read-only Firestore projection helper, Field HTTP date guard, acceptance tests, task/review evidence.

## Governance

- Authority owner(s): Scheduling owns appointment/Work Order timing and Van assignment; Field Operations owns technician execution; Firebase Authentication and `users/{uid}` own the real actor identity.
- Business-rule IDs: Existing Field assignment and execution invariants in `BUSINESS_RULES.md`; `FIELD-DAY-001` owns current-day reads and technician mutations, while `FIELD-PREVIEW-001` owns the temporary simulation boundary.
- Security/privacy impact: Deep Review required. The selector is Super Admin-only and preview/development-only. It reads data the real admin is already allowed to read. Simulated actions never call a Field mutation, Firestore write, offline cache, draft, upload, or outbox path.
- Legacy parity impact: No Legacy behavior is revived. The current-day constraint and mobile-style flow match the approved technician portal specification.
- ADR/debt impact: The admin read projection is explicitly temporary and must be removed after `fieldOperationsAuthority` is deployed and test technician accounts are available.

## Acceptance criteria

- [x] Given any Field user, when `/field/` opens, then the UI contains only the current Aruba day and no Tomorrow/Week controls.
- [x] Given a technician API principal, when requesting a schedule outside today or opening a non-today Work Order, then the server fails closed.
- [x] Given a known Work Order or existing Work Visit ID from another date, when a technician attempts any Field mutation, then the shared transactional resolver denies it before crew reads and no canonical write or audit occurs.
- [x] Given a Super Admin on a preview/development deployment, when selecting a Van or technician, then today's real `workOrders` are filtered using canonical Van and dated crew membership.
- [x] Given any other role or a production deployment, when `/field/` renders, then the temporary selector is absent.
- [x] Given the simulator, when the user advances, resets, or closes a job, then no canonical write/upload/outbox call occurs and the UI states that the activity is local simulation.
- [x] Failure/denial behavior: Firestore read failures show a retryable Spanish error and do not fall back to broad technician reads or fabricated data.
- [x] Audit/observability behavior: No canonical audit event is created for simulation; the UI makes that absence explicit.

## Plan and risk

- Implementation outline: Build pure projection/filter functions, wire the guarded selector and local simulation detail, enforce current-day server reads, and cover permissions/date/crew overrides with tests.
- Migration/rollback or recovery: Revert the isolated simulator component/helper and page prop. No data migration or canonical state change is involved.
- Key risks and mitigations: Accidental impersonation is prevented by a separate simulation component with no mutation callbacks; stale cross-profile data is prevented by scoping rendered jobs to the active selection; future work is prevented in client/server reads and in the shared transactional mutation resolver. The strict midnight boundary is recorded explicitly so a grace period cannot be invented client-side.

## Verification

- Automated gates: Field simulator acceptance, Field security/domain suites, TypeScript, Next build, and relevant Function tests.
- Manual scenarios: Preview as all Vans, Van 1-4, and individual technicians; verify Agenda counts for today; walk and reset a simulated job; verify selector absence for non-admin/production paths.
- Evidence/results: simulator acceptance, Field domain/security/offline suites, 352 Function Field tests, TypeScript and production build pass. Independent simulator and data-parity reviews pass after correcting role, state, race, current-day mutation and canonical Van/fallback findings.
- Not run and why: Production Function/Rules deployment and real technician mutation UAT require a separately approved release boundary. The preview selector is intentionally the safe UAT path while that Function is absent.
