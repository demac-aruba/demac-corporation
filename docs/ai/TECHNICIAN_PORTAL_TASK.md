# Task: Canonical Technician Portal / Field Operations

Status: Objective contract established — implementation remains phased
Date: 2026-08-24
Branch: `feature/technician-portal-canonical-foundation`
Source: DEMAC Technician Portal / Field Operations master implementation request plus repository governance

## Context

### Business outcome

Build the ERP Next Technician Portal as DEMAC's canonical field-execution subsystem, not as a screen-level patch or browser-only prototype.

The technician workflow must support:

`login -> assigned field dashboard -> schedule -> open job -> en route -> arrive -> discover actual scope -> identify/register A/C assets -> execute one or more interventions -> add approved work/products -> capture evidence/measurements/findings -> complete or leave explicit pending work -> second-visit handling -> customer approvals -> Office Review -> governed inventory/billing/report/history handoffs`.

The invariant that governs the entire task is:

> Scheduling records what DEMAC expected before arrival. Field Operations records what actually happened on site.

An Appointment/Planned Work Line reserves capacity and preserves historical intent. A Work Visit records one physical visit. A canonical Equipment Asset represents one real A/C system. A Work Intervention represents one individual job. A Field Sale Line represents one commercial item sold or installed. Their counts may legitimately differ.

Example that must remain valid:

`1 Appointment -> 1 Work Visit -> 3 Equipment Assets -> 3 Work Interventions -> 2 Field Sale Lines`.

The original Appointment quantity must never be rewritten merely to match actual field work.

### Product surface and users

Primary surface: `apps/erp-next` Field Operations / Technician Portal.

Privileged/backend boundary: `functions` and governed Firebase data/rules.

Primary users:
- assigned technician;
- lead technician;
- helper/participating technician;
- supervisor/operations;
- office reviewer;
- admin where existing canonical policy allows it.

Legacy Expo remains the operational fallback during the transition. Legacy behavior is a parity source, not an architecture to copy.

### Current baseline

Verified on the feature branch as of the active-visit implementation checkpoint:

- Phase 0 architecture/current-state audit and the canonical architecture are recorded in `docs/ai/TECHNICIAN_PORTAL_ARCHITECTURE.md`.
- Phase 1 canonical domain foundation is present and validated at its foundation checkpoint.
- `lib/security.ts` is the canonical ERP capability vocabulary; the older capability vocabulary is compatibility-derived rather than a second authority.
- Firebase principal resolution carries canonical `staffId`/`vanId` linkage and technicians without a staff profile fail closed.
- Slice 1 read/security boundary is validated: Field Authority performs assignment-scoped schedule/job reads, reuses canonical Van identity and shared dated crew membership, projects `responsibility`/`assignmentSource`/`allowedActions`, and denies another-team known-ID access server-side.
- Field Function syntax/tests are included in the ERP feature CI together with Booking/Scheduling regression coverage. The CI trigger covers all `functions/fieldOperations*.js` modules.
- Phase 3 Technician Home is the canonical ERP Next `/field` surface. It preserves Today/Tomorrow/Week, assignment-scoped detail, known equipment and contact/navigation affordances.
- DEMAC approved the canonical persistent Field lifecycle/audit boundary. Append-only `fieldOperationEvents` is implemented through `functions/fieldOperationsAudit.js`; `userAuditLogs` is not repurposed.
- `prepare_visit` is HTTP-activated on this feature branch. It creates/adopts the initial Legacy-compatible `workVisits` record transactionally, re-resolves assignment inside the transaction, preserves planned scope, and appends the Field audit event atomically.
- Phase 4 active physical visit status is implemented on this feature branch for `scheduled -> en_route -> on_site -> in_progress` through `transition_visit`. WorkVisit, not WorkOrder, is the actual physical-state authority.
- The Field read model projects `fieldVisit`, `canPrepareVisit`, version, timestamps and server-derived `availableTransitions`; ERP Next does not reconstruct the transition graph or preparation policy.
- The Technician Home exposes only the activated physical controls: **En camino**, **Llegué**, and **Iniciar trabajo**. It does not directly mutate WorkOrder status and it does not optimistically invent successful Field state.
- Mutation commands use current transaction-scoped assignment, expected-version conflict detection, retry-safe same-target behavior, and append-only audit. A cancelled/unreleased WorkOrder blocks a later WorkVisit transition.
- Phase 2 remains **PARTIAL overall** because Firestore/Storage assignment perimeter and emulator allow/deny evidence remain incomplete; production access-policy changes are not authorized by this workstream.
- Production has not been deployed or migrated by this workstream; PR #435 remains a draft implementation branch until later review/approval.

At the active-visit checkpoint, ERP Next CI is green with **107/107 Field Authority tests** and **94/94 Booking/Scheduling regression tests**, plus ERP Next typecheck, Field security acceptance and production build. This is checkpoint evidence only; it does not satisfy the full Technician Portal Definition of Done.

## Scope

### In scope

1. Canonical Field Operations domain and persistence boundaries.
2. Assigned-only technician authentication/authorization.
3. Role-aware Technician Home with Today, Tomorrow, Week, next-job/progress and map/call/WhatsApp actions using canonical Scheduling/Work Order data.
4. Visit lifecycle: en route, arrived, start, pending, return visit, submission and auditable status history.
5. Explicit separation of planned scope and progressively discovered actual scope.
6. QR lookup, existing-asset selection and controlled on-site registration of canonical CRM Equipment Assets.
7. Multiple independent Work Interventions, including multiple interventions on one A/C.
8. Planned-work dispositions for work not performed.
9. Service-specific report templates, structured report sections, evidence, measurements and findings.
10. Safe lead/helper collaboration with section-level concurrency and no destructive whole-visit overwrite.
11. Catalog-backed Field Sale Lines, immutable presented/approved price snapshots, client approval and controlled non-catalog review workflow.
12. Governed handoffs to existing Inventory Authority and billing candidate workflow; no duplicate ledgers or invoice authority.
13. Office Review, returned-for-correction revisions, approval locking and non-destructive amendment behavior.
14. Customer and Equipment history as read projections from canonical field records.
15. Offline cache/draft/outbox/idempotency/conflict behavior without promoting browser storage to canonical truth.
16. Audit, observability, security, mobile/accessibility and production-hardening review through Phase 11.
17. Legacy parity classification and evidence updates as capabilities become verified.

### Out of scope unless separately approved

- merging this work to `main`;
- production deployment;
- destructive or irreversible production migration;
- production Firestore/security-rule deployment or any access-policy change;
- secret/credential rotation or live integration enablement;
- production customer messages;
- automatic production invoice creation;
- replacing QuickBooks as accounting authority;
- creating a second Customer, Property, Asset, service/product catalog, pricing engine, inventory ledger, permission system, scheduling authority, billing authority, writable service-history source, or another unapproved business source of truth;
- unrelated repository cleanup.

### Canonical authority boundaries

| Concept | Authority |
| --- | --- |
| Authentication identity | Firebase Auth + governed `users/{uid}` |
| Employee/technician identity | `staffProfiles` |
| Current crew override | `dailyVanAssignments` plus canonical van/staff configuration |
| Customer | CRM Customer |
| Property | CRM Property (`Site/siteId` only as compatibility terminology) |
| Permanent A/C identity | canonical CRM Equipment Asset |
| Appointment / planned scope | Booking Authority / Scheduling |
| Work Order release/lifecycle | Work Order application boundary / existing governed WorkOrder record semantics; Field does not invent a second WorkOrder state writer |
| Physical visit and actual field truth | Field Operations (`WorkVisit` and child records) |
| Product/Service definitions | canonical `services` catalog |
| Presented/approved field price | immutable snapshot derived from canonical approved price at action time |
| Inventory effect | existing Firebase Inventory Authority |
| Billing/accounting handoff | governed billing candidate / operational finance; QuickBooks remains official accounting record |
| Customer/asset service history | read projections from canonical field truth |
| Permissions | `apps/erp-next/lib/security.ts` plus server/data assignment enforcement |
| Field lifecycle audit persistence | approved append-only `fieldOperationEvents` written only through the governed Field server transaction boundary |

## Governance

### Business-rule impact

This task does not create a replacement company-rules registry.

Applicable existing rule families include:
- `PRICE-*`: no inferred prices; catalog/settings authority and immutable approval snapshot;
- `OPS-SVC-*`: scheduling/capacity remains governed by Booking Authority and approved capacity rules;
- `OPS-TEAM-*`: assignment, staff availability and crew constraints remain canonical;
- applicable communication rules for contact actions and later approved customer communication.

Task-level acceptance identifiers in this document (`TP-AC-*`) are acceptance references only. They are **not** new company business-rule IDs.

### Security/privacy impact

- Assigned-only access is mandatory at query/repository, domain/service, API/server and database/security-rule boundaries where applicable.
- Knowing a Work Order, Work Visit or child-record ID must not grant access.
- UI hiding is never sufficient authorization.
- Identity/role ambiguity must fail closed.
- Helpers may contribute to authorized technical sections but must not gain commercial/scope/close authority merely by participating in the visit.
- Customer/employee data and evidence must not be exposed in logs, fixtures or test artifacts.
- High-impact reads/writes require actor/time/outcome audit evidence.

### Legacy parity impact

Legacy concepts to preserve/refactor where supported by evidence include today/tomorrow agenda, assignment filtering, contact/location/access instructions, en-route/arrival/start/pending/completion timestamps, drafts, evidence, measurements, second visits, receiver information, WorkVisit, EquipmentSystem, WorkIntervention, scope changes, approvals, QR, report sections and technician/helper collaboration.

Legacy patch chains are not part of the target architecture. Parity becomes `VERIFIED` only through executed acceptance evidence against canonical authorities, not through visual similarity or similarly named files.

## Acceptance criteria

### Core business acceptance

- **TP-AC-01 Assigned access:** a technician can retrieve only jobs assigned directly, through the technician's current van/team, or another explicit canonical assignment; another team's known ID is denied.
- **TP-AC-02 Planned truth:** Scheduling/Appointment planned work remains immutable historical intent after field execution.
- **TP-AC-03 Progressive actual scope:** a released/authorized visit may begin without exact A/C count/BTU/model/serial when enough information exists to work safely.
- **TP-AC-04 Submission integrity:** before Office Review, every actual intervention resolves to an explicit Visit Asset/canonical Asset or controlled on-site registration, planned work is reconciled, approvals are valid, and pending/return work is explicit.
- **TP-AC-05 Individual interventions:** each performed service is an independent Work Intervention; one A/C can have multiple interventions.
- **TP-AC-06 Asset lifecycle:** technicians can safely scan a QR, select an existing current-customer/property asset, or register a minimally identified new asset; cross-customer QR never silently reassigns ownership.
- **TP-AC-07 Partial/not-performed:** completed interventions remain completed when other work is pending; planned-but-not-performed work remains explicitly dispositioned.
- **TP-AC-08 Field sales:** add-ons use the canonical catalog and approved price authority; declined lines remain historical and are not billed; non-catalog lines require controlled Office Review and create no shadow product.
- **TP-AC-09 Approval/audit:** additional billable work can be approved against exact lines and material field actions have actor/time/source/outcome audit evidence.
- **TP-AC-10 Templates/evidence:** service templates govern required sections/evidence; measurements and findings are structured and attached to the correct asset/intervention context.
- **TP-AC-11 Collaboration:** lead/helper and multi-device section editing cannot cause lost updates or escalate helper authority.
- **TP-AC-12 Second visit:** a return visit is a new physical Work Visit or governed follow-up, never an overwrite of the first visit.
- **TP-AC-13 Office Review:** submit -> review -> approve or return -> correct -> resubmit preserves revisions; approved revisions are not silently rewritten.
- **TP-AC-14 Downstream handoff:** inventory effects go only through Inventory Authority; billing candidate reflects approved actual work while planned scope remains unchanged.
- **TP-AC-15 History:** Customer and Equipment histories are projections from canonical field truth, not independently writable duplicate histories.
- **TP-AC-16 Offline/sync:** device cache/draft/outbox behavior does not become canonical truth, retries are idempotent and concurrent edits do not destructively overwrite one another.
- **TP-AC-17 Mobile field UX:** Technician Home and active visit are mobile-first, clear, fast and usable with large touch targets and minimal typing; Scheduling authority is not granted to technicians by the UI.

### Mandatory scenario suite

All 26 scenarios in the master implementation request are required. They include at minimum:

1. planned 1 / actual 1;
2. planned 1 / actual 2 assets;
3. two interventions on one asset;
4. planned 2 / actual 1 plus not-performed disposition;
5. unknown BTU does not block booking;
6. register A/C on site;
7. known QR attaches correct asset;
8. foreign-customer QR is controlled/denied;
9-11. catalog-backed Switch, Armaflex and arbitrary searchable catalog material;
12. non-catalog material requires Office Review without shadow catalog;
13. declined add-on retained and not billed;
14. partial completion;
15. second visit preserves first visit;
16. concurrent lead/helper report editing;
17. helper billable-work attempt denied server/domain-side;
18. unassigned-team visit access denied even with ID;
19. offline interruption without permanent data loss;
20. two-device section updates without destructive overwrite;
21. returned report preserves previous submission/reviewer note;
22. approved revision locked from ordinary technician modification;
23. individual interventions visible in Customer history;
24. interventions correctly attached in Equipment history;
25. billing candidate uses actual approved lines while preserving planned scope;
26. booked quantity remains immutable historical intent when actual job count differs.

The canonical end-to-end fixture must also cover: booked `1 Standard Service`, actual Sala Standard Service, Bedroom Standard Service + one Switch, Kitchen Check-up, while the Appointment still records exactly `1 Standard Service`.

## Phase boundaries

The master workstream remains:

- Phase 0 — architecture/current-state audit;
- Phase 1 — canonical domain foundation;
- Phase 2 — security & technician assignment;
- Phase 3 — Technician Home / schedule;
- Phase 4 — visit shell / status;
- Phase 5 — planned vs actual scope;
- Phase 6 — service/report templates;
- Phase 7 — field sales/add-ons;
- Phase 8 — visit completion / Office Review;
- Phase 9 — Customer/Equipment history;
- Phase 10 — offline/sync hardening;
- Phase 11 — production hardening review, **without deployment**.

A phase may be marked PASS only after its required diff inspection, focused/full applicable tests, typecheck/build as applicable, and four engineering reviews. A green intermediate build cannot promote later incomplete phases to PASS.

## Human-only boundaries

The following are `NEEDS_HUMAN` whenever reached:

1. merge to `main` and independent approval/review decision;
2. any production deployment;
3. deploying Firestore/Storage/security rules that change production access;
4. destructive or irreversible production data/schema migration;
5. secret/credential or production-access changes;
6. production customer communications;
7. live production integration activation;
8. production data deletion/overwrite;
9. automatic production invoice/accounting write when not separately approved;
10. architectural creation of any additional system of record/source of truth not already explicitly approved.

The canonical `fieldOperationEvents` lifecycle/audit persistence boundary has already received human approval for this Field Operations architecture and is therefore no longer an unresolved blocker. That approval does **not** authorize production deployment, Rules changes, destructive migration, or a different/new source of truth.

These boundaries do not block branch-local design, implementation, tests, emulator security tests, dry-run/reconciliation planning or other reversible safe work.

## Verification and evidence required for full completion

### Automated evidence

- ERP Next: `npm run typecheck --prefix apps/erp-next`.
- ERP Next: all relevant focused `test:*` suites, including field-domain, authorization and cross-domain integration/regression coverage.
- ERP Next: `npm run build --prefix apps/erp-next`.
- Functions: `npm run validate:firebase --prefix functions`, with all new Field Operations Function files actually included by the validation command.
- Functions: focused Field Operations Authority tests, including assigned and unassigned access/failure paths.
- Firebase/Storage rules: emulator-based allow/deny tests before any proposed production deployment.
- Mandatory 26-scenario acceptance suite plus the canonical booked-1/actual-3+sale integration scenario.
- Relevant regression suites for CRM, Scheduling, Work Orders, Inventory, Billing/Office Review, Authentication and Authorization.
- Concurrency/offline/multi-device tests where those phases change behavior.

### Manual/review evidence

- mobile-first Technician Home and active-visit flow review;
- assignment/access review with real role shapes but non-production test data;
- planned-vs-actual reconciliation review;
- Office Review/revision lifecycle review;
- accessibility/error-state review;
- diff review proving no unrelated work, secrets, debug output, duplicate catalogs/rules or new source of truth;
- Legacy parity register updated only when executed evidence justifies status changes;
- independent Reviewer evidence separate from Builder claims;
- four explicit reviews: correctness, architecture, integration/regression, production readiness.

### Full Definition of Done

The portal is complete only when all of the following are demonstrated:

1. authorized jobs only;
2. role-aware field dashboard;
3. Schedule remains planned-work authority;
4. planned and actual scope remain separate;
5. equipment can be added on site;
6. new canonical Equipment Assets can be registered;
7. QR works safely;
8. multiple Work Interventions are supported;
9. multiple interventions on one A/C are supported;
10. additional services do not rewrite booking history;
11. partial completion works;
12. planned-but-not-performed work is preserved;
13. add-ons use the canonical catalog;
14. pricing has one source of truth;
15. customer approvals are auditable;
16. inventory handoff is canonical;
17. billing handoff reflects approved actual work;
18. evidence is linked to the correct asset/intervention;
19. measurements are structured;
20. findings are structured;
21. templates govern service-specific requirements;
22. helper/lead collaboration is safe;
23. status transitions are centralized;
24. second visits are modeled correctly;
25. Office Review works;
26. returned reports preserve revisions;
27. approved reports cannot be silently rewritten;
28. Customer history is projected from canonical records;
29. Equipment history is projected from canonical records;
30. offline behavior creates no duplicate truth;
31. multi-device editing causes no lost updates;
32. material actions have an audit trail;
33. permissions are enforced beyond UI;
34. duplicate capability systems are consolidated/retired to one authority;
35. no technician-specific shadow catalog exists;
36. no browser-local database is treated as canonical production state;
37. all mandatory acceptance scenarios pass;
38. required tests pass;
39. typecheck passes;
40. build passes;
41. four engineering review passes succeed with independent Reviewer evidence where required;
42. no production deployment occurs without explicit human approval.

## Current known gaps carried into the next engineering phase

These are related blockers/status facts, not permission to broaden scope:

- Phase 2 remains incomplete because assignment enforcement across the Firestore/Storage data perimeter and emulator allow/deny evidence are still pending. API/server assigned-only reads and known-ID denial are implemented/tested, but that does not prove the database/storage perimeter.
- Existing repository Firestore/Storage policy previously observed for field/work-order/evidence access is broader than the target assigned-only model. Branch-local policy design/tests may be prepared, but any actual access-rule change/deployment is `NEEDS_HUMAN`.
- Phase 3 Technician Home now includes the first canonical active-visit controls, but only for the explicitly activated Phase 4 path. It is not yet the complete visit-execution application.
- Initial WorkVisit preparation is HTTP-activated on the feature branch. The active transition command is also HTTP-activated on the feature branch for `en_route`, `on_site`, and `in_progress`. Both re-resolve assignment on the server and use the approved audit boundary.
- The read model resolves the current physical WorkVisit and keeps `WorkOrder.status` separate from actual Field state. Existing Legacy in-flight WorkOrders that have no WorkVisit are not silently converted into canonical physical history; they remain compatibility/fallback cases rather than guessed truth.
- Phase 4 remains **PARTIAL overall**: pending/no-access/cancelled/return-visit/submission/completion paths are not activated by this slice.
- VisitAsset/on-site registration/QR mutation, WorkInterventions, templates/evidence/measurements/findings, Field sales, partial/return visits, Office Review, histories, offline sync and downstream Inventory/Billing handoffs remain future phases.
- `validateVisitForOfficeReview` and billing/planned-vs-actual helpers in ERP Next remain Phase 1 specification/read-projection utilities; they must not become production mutation authority. Office Review validation must move server-side before Phase 8 activation.
- Browser field/localStorage implementations remain compatibility/fallback until canonical persistence/UI reaches proven parity; they must not be deleted merely because they are old.
- Full Firestore/Storage emulator evidence, all 26 mandatory scenarios, all 42 Definition-of-Done items and formal four-pass production hardening are still required before engineering completion.
- No later phase may be marked complete based only on an earlier green checkpoint.

## Recovery / migration posture

Any persistence migration must be additive first, idempotent, dry-run capable, backward-compatible where needed, reconcilable and paired with rollback or forward-recovery planning. No destructive production migration is authorized by this task.

The initial WorkVisit command uses a deterministic Legacy-compatible first-visit identity only for idempotency/adoption. A second physical return must create a distinct WorkVisit and preserve the first visit; the initial compatibility helper must not be reused as a return-visit ID generator.

The feature-branch HTTP activation is code activation only. No production Function deployment has occurred. A later authorized rollout must deploy the server authority before the ERP Next consumer, verify authenticated allow/deny behavior, and preserve all canonical records on rollback.

## Completion decision

This task reaches engineering completion only when the 42-point Definition of Done, the mandatory scenario suite, applicable quality gates, security allow/deny evidence, parity evidence, documentation and independent review are all satisfied. Production rollout remains a separate human-approved action even after engineering completion.
