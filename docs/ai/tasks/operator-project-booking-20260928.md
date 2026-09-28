# Task: Office operators can book existing shared Projects

## Context

- Request/source: owner report on 2026-09-28 with owner and operator Scheduling screenshots.
- Product surface and users: ERP Next Scheduling & Dispatch, Office Operator and existing Project managers.
- Current behavior/evidence: `office_operator` can manage Scheduling but lacks both Project capabilities; the drawer omits the Project source. `projectAuthority` and the atomic Booking Authority Project link independently deny the same role. The operator screenshot is consistent with that policy; the user's exact profile has not been inspected.

## Scope

- In scope: allow an active, provisioned Office Operator to find an existing published Project and confirm or hold a Project-linked Appointment through canonical Booking Authority. Show the Project name on operator Scheduling cards. Preserve Project managers' existing behavior.
- Out of scope: create/edit/complete Projects; historical Project corrections; backdated Project booking; browser-local unpublished Projects; technician execution; invoices/billing; production data edits.
- Files/boundaries expected: ERP capability and Scheduling components, Project Authority read projection, Project booking authorization, focused tests and authority documentation.

## Governance

- Authority owners: Firebase user role/profile; `projectAuthority` for shared Project reads; Booking Authority for capacity/Appointment/Work Order/atomic Project link.
- Business-rule ID: `OPS-PROJ-SCHED-001`.
- Security/privacy impact: new narrow `projects.schedule` capability and server-side role check. Operator receives a scheduling-specific Project projection, not Project planning/finance write authority. Project planning saves and historical corrections remain manager-only.
- Legacy parity impact: none; ERP Next flow only.
- ADR/debt impact: document the scheduling-specific authorization boundary; no new source of truth.

## Acceptance criteria

- [x] Given an active Office Operator and a published schedulable Project, New Appointment renders the Project source and searches by name, number, customer or location (code and focused tests; authenticated operator visual check pending).
- [x] A valid Project/customer/property/phase and open Van capacity allow confirm or Temporary Hold; Booking Authority atomically links Appointment and Work Order to the Project and updates slots (synthetic backend tests).
- [x] Project appointments resolve `Project: <name>` in operator Scheduling cards through verified server links (focused card tests; visual check pending).
- [x] The Office Operator cannot create/edit Project planning, perform historical Project corrections or use unpublished browser-local Projects. Finance and unrelated roles cannot book Projects (negative tests).
- [x] Stale versions, invalid canonical identity, unavailable capacity and revoked role fail closed without a partial Project booking (backend regression tests).
- [x] Existing Regular Booking and manager Project booking code paths remain unchanged; full Booking Authority regression passes.

## Plan and risk

- Implementation outline: separate schedule permission from Project management; expose only Scheduling's needed shared Project fields; authorize Project link inside Booking Authority transaction; gate UI and labels on scheduling permission.
- Migration/rollback or recovery: no migration or data rewrite. Revert the role/API/UI change if required; existing Project and Appointment records stay authoritative. Do not deploy frontend ahead of backend.
- Key risks and mitigations: privilege widening (server-side role checks and negative tests), missing linkage (atomic Booking Authority path and regression tests), stale Project state (version check), browser-local preview leakage (shared-only operator list), backend profile aliases (`office`, `operator`, `office_operator`) matching the frontend Office Operator role.

## Verification

- Automated gates: ERP typecheck, focused Projects/Scheduling tests, Functions validation and focused Project/Booking Authority tests, production build for integration release.
- Manual scenarios: preview with Office Operator test profile, existing shared Project and fake customer; do not create a production booking just to test.
- Evidence/results: ERP typecheck, Projects/Scheduling focused tests, Functions validation and ERP build passed; 46 focused backend tests and 181 Booking Authority regressions passed with Node test isolation disabled only to accommodate sandbox child-process restrictions (no test case skipped). Independent Deep Review found no blocking finding; see `docs/ai/reviews/operator-project-booking-20260928.md`.
- Not run and why: authenticated Office Operator visual check and real availability check require coordinated backend/frontend preview or approved deployment. No live booking was created.
- Follow-up outside this scope: literal manager role aliases have a pre-existing mismatch between Project access and Office Booking Authority; do not widen the whole office gateway as part of the operator permission fix.
