# Task: Integrate the Projects validation module into ERP Next operations

## Context

- Request/source: DEMAC owner feedback from the interactive Projects and Scheduling preview, followed by explicit approval to merge.
- Product surface and users: ERP Next Projects, Scheduling, and the technician handoff for owner, Operations, Project Manager, and Finance roles.
- Current behavior/evidence: the previous `/projects` route was a static management mockup and Scheduling had no Project-aware booking path.

## Scope

- In scope: replace the static Projects page with an integrated validation workspace; place Projects directly below Scheduling in Operations; search canonical CRM customers and properties; create a canonical customer only when explicitly selected; derive six one-hour slots per work day; keep AWG implicit; make material budget optional and absent for Service Projects; persist default technician instructions; link confirmed appointments and Temporary Holds to Project preview assignments; keep canonical Scheduling and Field lifecycles authoritative; rename the non-Project path to Regular Booking.
- Out of scope: a canonical server-side Project system of record, accounting or inventory posting, production-data migration, and full cancel/reschedule/hold reconciliation into Projects.
- Files/boundaries expected: `apps/erp-next` Projects UI/domain preview, Scheduling appointment drawer, browser preview storage, focused acceptance tests, navigation, and architecture/parity evidence.

## Governance

- Authority owner(s): CRM owns Customer and Property identity; Booking Authority owns Appointment, Work Order, Temporary Hold, and capacity locks; Field Operations owns actual execution; Projects remains an explicitly labeled browser-only validation projection.
- Business-rule IDs: existing canonical Scheduling/CRM rules and the one-customer/one-property identity contract; no new production authority is introduced.
- Security/privacy impact: `projects.view` gates Project reads; `projects.manage` gates preview mutations and Project-linked Scheduling actions; canonical writes retain their backend authorization. Officially provisioned Supervisor/Operations profiles are supported. Raw `project_manager`/`projects` profiles remain a known backend-role contract gap and are not provisionable through current User Management.
- Legacy parity impact: Projects remains PARTIAL because no governed canonical Project lifecycle exists.
- ADR/debt impact: AD-014 records browser persistence and post-commit reconciliation debt. No durable canonical architecture decision is accepted by this preview, so a new ADR is not applicable.

## Acceptance criteria

- [x] Given an authorized user, when Projects opens, then it is the existing ERP Next module under Operations immediately below Scheduling.
- [x] Given Create Project, when a customer name is entered, then canonical CRM matches are selectable and an unmatched customer is created only through an explicit create action.
- [x] Given 10 estimated work days, when capacity is calculated, then the plan contains 60 one-hour slots and 60 labor-budget hours.
- [x] Given a Service Project, when it is created or edited, then no material budget is required and currency is not requested.
- [x] Given a Project booking, when it is planned, then Scheduling uses whole one-hour slots, Project-recorded customer-facing context and technician instructions, and offers both Confirm and Temporary Hold.
- [x] Given a Temporary Hold, when it is committed, then canonical capacity is reserved without sending customer confirmation or reminders.
- [x] Given a canonical Scheduling assignment, when opened from Projects, then its lifecycle is read-only and directs execution to Scheduling/Field rather than manufacturing local actuals.
- [x] Failure/denial behavior: unauthorized Project reads and writes fail closed; stale capacity is revalidated; preview persistence failures are surfaced; duplicate posting/link retries are idempotent.
- [x] Audit/observability behavior: source IDs remain attached to preview assignments and cost entries; preview and canonical boundaries are visible in the UI and documented as debt.

## Plan and risk

- Implementation outline: extend the existing route and navigation; reuse canonical CRM and Booking Authority clients; isolate Project planning rules in `browser-projects.ts`; serialize shared browser-preview mutations; add negative and integration-focused acceptance tests.
- Migration/rollback or recovery: normalize the known legacy draft-clone signature in memory without changing operational activity; the feature can be rolled back as one commit; canonical appointments remain valid if a post-commit preview link fails and the UI reports the pending link.
- Key risks and mitigations: stale availability is rechecked by Booking Authority; duplicate links use stable Work Order IDs; shared Project writes use one Web Lock and re-read the latest snapshot; canonical-linked assignments cannot post local actuals; remaining browser/source-of-truth risk is tracked in AD-014.

## Verification

- Automated gates: ERP Next typecheck; Projects preview acceptance; live Scheduling acceptance; Appointment lifecycle acceptance; CRM guard/acceptance; production Next.js build including its employee, attendance, Work Order, Van, and Projects prebuild suites.
- Manual scenarios: owner exercised Create Project and Project selection inside New Appointment during preview review.
- Evidence/results: all automated gates listed above passed before the final merge commit; final exact results are recorded in the paired review.
- Not run and why: automated in-app-browser interaction against `localhost` was blocked by the browser-control URL policy. No production write, deployment, or authenticated production smoke test was performed.
