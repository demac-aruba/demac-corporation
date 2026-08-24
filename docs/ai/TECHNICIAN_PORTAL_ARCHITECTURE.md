# DEMAC ERP Next — Technician Portal Canonical Architecture

Status: Phase 0/architecture PASS; Phase 1 foundation PASS; Slice 1 read/security PASS; Slice 2 WorkVisit boundary implemented/tested but not activated; Phase 3 read-only Technician Home PASS
Date: 2026-08-24
Scope: ERP Next field execution only. Legacy remains operational fallback; production deployment is out of scope.

## Architectural rule

Scheduling records what DEMAC expected before arrival. Field Operations records what actually happened on site. Planned scope is immutable historical intent; actual field scope is discovered progressively and must never rewrite the appointment quantity or work lines.

Canonical flow:

`Appointment -> Work Order -> Work Visit -> Visit Asset -> Work Intervention`

Supporting field truth:

`Work Visit -> Scope Change / Planned Work Disposition / Approval / Sale Line / Evidence / Measurement / Finding`

Downstream projections/handoffs:

`Work Interventions + approved Sale Lines -> Office Review -> Billing candidate / Inventory authority / Customer history / Asset history`

## A. Existing reusable components and authorities

| Concern | Reuse / authority |
| --- | --- |
| Authentication | Firebase session + `users/{uid}` profile through `lib/firebase/principal.ts` |
| ERP authorization | `lib/security.ts` is the ERP client capability vocabulary; server-side Field Authority remains the enforcement boundary for field actions |
| Customer | canonical CRM Customer |
| Property | canonical CRM Property; existing `siteId` is a compatibility/domain synonym, not a second location identity |
| Equipment | canonical CRM Asset / existing `equipmentSystems` persistence compatibility boundary |
| Appointment / booking intent | Booking Authority + Scheduling |
| Planned work | Appointment `workLines` / scheduling work-type snapshots |
| Work Order | existing work-order application boundary |
| Product/service catalog | canonical `services` collection and existing service-definition normalization |
| Van identity | existing `functions/bookingVanIdentity.js` |
| Crew scheduling primitives | existing `functions/bookingSchedulingPrimitives.js`; extend/refactor rather than creating a Field-only crew engine |
| Inventory | existing Inventory Authority and canonical stock records |
| Audit | no approved generic Field lifecycle ledger yet; mutation activation remains gated by an injected transactional audit contract and `NEEDS_HUMAN` for the persistent Field event boundary |
| Persistence abstractions | `lib/persistence.ts` repository, clock, ID and audit contracts remain useful typed contracts; production Field writes are server-owned |
| Field API boundary | existing `functions/fieldOperationsAuthority.js` + server-local Field authority modules |
| Legacy field concepts worth preserving | WorkVisit, VisitUnit, WorkIntervention, ScopeChange, VisitApproval, QR identity, report sections, concurrent section editing |

## B. Architecture conflicts found and current disposition

1. **Two capability vocabularies existed.** `lib/capabilities.ts` uses legacy `*.read`; `lib/security.ts` contains canonical ERP capabilities. The old matrix is now compatibility-derived and may not regain authority.
2. **Field execution was browser-local preview state.** The prior `/field` route rendered `BrowserFieldExecution`. The active ERP Next `/field` route now renders the canonical read-only `TechnicianFieldHome` backed by Field Authority. Browser/localStorage Field code remains fallback/compatibility only and is not canonical operational truth.
3. **Exact-scope hard gate is incompatible with DEMAC operations.** Legacy/browser preview `scopeStatus()` requires selected equipment count to equal booked Work Order quantity before field start. The canonical server WorkVisit preparation boundary does not use that gate and preserves unknown/zero estimated equipment quantity as planned intent.
4. **Current browser fallback field model conflates equipment and performed work.** Each equipment row owns one progress/result record, preventing multiple independent interventions on the same A/C. It remains non-canonical fallback and must not shape the target model.
5. **Current browser fallback add-ons are counters.** Switches, brackets, Armaflex and refrigerant are not catalog-backed commercial lines with price snapshots, approval and downstream linkage. They remain non-authoritative.
6. **Browser fallback evidence and measurements are too generic.** Boolean photo flags and a generic measurement string are compatibility behavior only; future canonical records remain intervention-context structures.
7. **A second non-active demo implementation exists.** `components/field/field-execution.tsx` contains hard-coded assets and prices. It is useful only as UX reference and must not become another domain authority.
8. **`data-schema.ts` contains early greenfield collection names that do not fully reflect current Property/catalog/inventory authorities.** New field collections must be additive and must not revive stale collection boundaries.
9. **Legacy Technician has multiple generations of runtime logic produced by `patch:*` scripts.** Root `package.json` runs `patch:all` before Legacy start/web/typecheck/build; those scripts rewrite Technician source files. New ERP Next Field architecture must not add another patch generation or depend on modifying generated Legacy source without first tracing its patch owner.
10. **Assignment/responsibility was duplicated.** Slice 1 removed client action-decision logic; Field Authority projects `allowedActions`, and the client only renders that projection.
11. **Van normalization was duplicated.** Slice 1 reuses `bookingVanIdentity.js` in Field Authority instead of raw Work Order/user van string equality.
12. **Scheduling crew readiness and Field assignment ownership are related but not identical.** Slice 1 extracts pure dated crew membership from `bookingSchedulingPrimitives.js`; Scheduling keeps absence/driver/van readiness semantics in `resolveAssignment()`, while Field consumes membership for authorization.
13. **Legacy WorkIntervention status conflates technical execution and report review.** `ready_for_review`/`changes_requested` are editorial review states while the canonical WorkIntervention lifecycle represents actual technical work. They must not be merged into one state machine.
14. **Technician V2 defines a local WORK_TYPES catalog and template IDs.** This duplicates Service Catalog and report-template relationships in UI code.
15. **Field Authority equipment projection did not match the active equipment contract.** Slice 1 corrected `get_job` to adapt technical identity from `equipmentSystems.components[]`, retaining root-field compatibility fallback only.
16. **Client persistence has incompatible write semantics and no optimistic concurrency contract.** Legacy helpers perform full/partial REST PATCH operations without a Field transaction/application-service boundary. Canonical Field mutations must not introduce a third client writer.
17. **Field server tests were outside the effective ERP Next feature gate.** Slice 1 added Field Function syntax, authority tests and Booking/Scheduling regression tests to the feature CI.
18. **WorkVisit transition/preparation policy had a temporary TS duplicate from Phase 1.** Implementation self-audit removed client WorkVisit transition maps, start/preparation gate and snapshot-construction authority. WorkVisit transitions now live only in server-local `fieldOperationsAuthorityTransitions.js`; preparation/snapshot logic lives in `fieldOperationsAuthorityWorkVisit.js`. Neither mutation surface is HTTP-activated.
19. **Compatibility adapters previously failed open on unknown lifecycle values.** WorkVisit persistence projection and WorkOrder-to-WorkVisit preparation now use explicit status mappings and reject unknown/missing states instead of coercing them to `scheduled`/`not_started`.
20. **Initial WorkVisit identity could be mistaken for a universal WorkOrder→Visit identity.** `initialVisitDocumentId()` is explicitly limited to first-visit Legacy compatibility and matches Legacy 80-character ID behavior. A physical return must use a distinct future visit identity.

## C. Canonical field entities

### WorkVisit
One real physical visit. References Appointment, Work Order, Customer and Property and stores an immutable planned-scope snapshot. A second physical return creates another WorkVisit.

### VisitAsset
Participation of one canonical CRM Asset in one WorkVisit. It records how the asset entered the visit (`scheduled`, `existing_asset`, `qr_scan`, `registered_on_site`) without duplicating permanent asset identity.

### WorkIntervention
One individual service/intervention on one VisitAsset. Multiple interventions may target the same asset. It references the canonical Service Catalog item and stores immutable template/pricing snapshots where applicable.

### ScopeChange
Explicit context when actual work differs from planned work. Planned scope is never overwritten.

### PlannedWorkDisposition
Reconciles planned quantity not performed without inventing fake equipment. Examples: customer cancelled, inaccessible, unsafe, deferred, equipment unavailable.

### FieldApproval
One approval can cover an exact set of interventions and/or sale lines. Approval is evidence, not a pricing engine.

### FieldSaleLine
Catalog-backed field sale/add-on line with price snapshot, status and optional links to intervention/asset. Non-catalog lines are allowed only as office-review-required drafts and never create permanent catalog records.

### FieldEvidence / FieldMeasurement / FieldFinding
Structured, intervention-aware technical truth. AI may summarize or translate these records but may not create technical facts.

## D. Data ownership

- Appointment / planned work: Scheduling / Booking Authority.
- Work Order release/readiness: Work Order application service / Operations authority.
- Work Visit and field child records: Field Operations domain.
- Customer / Property / Asset identity: CRM.
- Service/Product definitions and base prices: `services` catalog.
- Field price actually presented/approved: immutable snapshot on field line/intervention.
- Inventory effect: Inventory Authority only.
- Billing result: Billing/Invoice authority; Field only emits governed billing candidates/handoff data.
- Customer and equipment history: read projections from canonical Work Visits, Interventions, Sales, Findings and Evidence; never writable duplicate history tables.

## E. State machines and mutation authority

### WorkVisit

`scheduled -> en_route -> on_site -> in_progress -> ready_for_office_review -> completed`

Allowed branches from active states: `pending`, `requires_return_visit`, `no_access`, `cancelled`. Transitions are centralized and auditable; arbitrary UI status writes are forbidden.

The canonical WorkVisit transition graph is implemented server-side in `functions/fieldOperationsAuthorityTransitions.js`. It is pure/testable and not exposed as an HTTP mutation. It owns first transition timestamps and rejects invalid/terminal transitions. Client TS transition maps were removed during implementation self-audit.

### WorkIntervention

`planned | added_on_site -> confirmed -> in_progress -> completed`

Branches: `pending_authorization`, `pending_part`, `not_performed`, `declined`, `cancelled`. Origin remains separate from status. Its server mutation state machine is intentionally deferred until the WorkIntervention phase; do not recreate it in React/TS meanwhile.

### FieldSaleLine

`proposed -> customer_approved -> installed|delivered -> sold`

Branches: `declined`, `voided`. Inventory and billing effects are transition-driven, not raw checkbox changes. Its server mutation state machine is intentionally deferred until the Field Sales phase.

The **server-side Field Authority is the only mutation/transition decision boundary**. ERP Next may display server-projected allowed actions and validation messages, but it must not own an independent transition map for canonical writes.

`apps/erp-next/lib/field-operations.ts` now contains only Phase 1 read/reconciliation/specification helpers. WorkVisit preparation, scheduled-scope snapshot construction and WorkVisit transitions were removed from the client mutation domain once the server boundaries existed. `validateVisitForOfficeReview` remains a specification-only helper and must move behind a server command before any Office Review submission mutation is exposed.

Server-local extraction under the existing Field Operations Authority is allowed to keep files cohesive; it is not a new service or source of truth. Do not introduce a cross-package transition framework merely to share code with the client.

## F. Permission and assignment model decision

### Authentication versus Field responsibility

Firebase/user role answers whether the principal may enter a class of ERP functionality. Field responsibility answers what that person may do on one dated Work Order/Visit.

Responsibilities remain:

- `lead`
- `technician`
- `helper`
- `office` projection for Office/Operations readers

A helper is not a separate Firebase authentication role.

### Server action policy

Field Authority resolves assignment and returns an `allowedActions` projection with the job/visit. Current read-model actions include:

- read assigned work;
- en route / arrive / execute eligibility;
- edit report section;
- add evidence / measurement / finding;
- add asset;
- add intervention;
- propose sale;
- complete intervention;
- submit/complete visit;
- office review;
- price override where separately authorized.

ERP Next uses this projection only for UX. Every future mutation recalculates authorization on the server using current canonical identity and assignment data; a client-supplied `allowedActions` value is never trusted.

### Crew membership reuse/refactor

Do not use raw van-string equality as the canonical crew test.

1. Reuse `bookingVanIdentity.js` for canonical van identity/aliases.
2. `bookingSchedulingPrimitives.js` now exposes pure dated **crew membership** separately from readiness.
3. Existing `resolveAssignment()` continues to apply absence/driver/van-readiness logic for Scheduling capacity by consuming that membership helper.
4. Field Authority consumes membership without treating a later absence/readiness change as a destructive rewrite of an already explicit Work Order assignment.
5. Explicit Work Order `technicianIds` remains a direct assignment source.
6. Van-only compatibility may allow discovery/read when necessary, but mutations require resolved explicit staff membership/responsibility.
7. Canonical `participatingStaffIds` contains staff-profile IDs only; raw Work Order `technicianIds` is not copied into that field because historical records may contain a Firebase uid.

### Client capability vocabulary

`lib/security.ts` remains the typed ERP client capability vocabulary/navigation projection. `lib/capabilities.ts` remains compatibility-only. Neither replaces server authorization. `lib/field-authorization.ts` contains only the Field action type contract and a literal `allowedActions` membership helper; it contains no assignment/role/responsibility decision matrix.

## G. Read model and adapter decisions

### Planned work

Field read models snapshot planned intent from Work Order appointment snapshots first and Appointment work lines as compatibility fallback. Planned quantity remains immutable historical intent after the WorkVisit snapshot is created.

### Equipment

`get_job` adapts the existing `equipmentSystems` contract instead of inventing a new equipment representation:

- preserve canonical equipment ID/QR/customer/property identity;
- derive display brand/model/serial/BTU/refrigerant/voltage from the applicable component data;
- retain root technical fields only as historical compatibility fallback;
- do not require BTU, brand, model or both nameplate photos merely to create/identify an Asset;
- incomplete technical metadata is explicit and may be enriched during the visit;
- QR belonging to a different customer/property must be rejected for silent reassignment when the write workflow is introduced.

### Service and report-template relationship

Do not keep `WORK_TYPES` + template IDs in Technician UI as authority.

The canonical `services` definition is extended additively with optional Field execution metadata when that governed catalog phase begins, for example an intervention family and report-template reference/version. `functions/serviceCatalog.js` is the compatibility/normalization boundary for historical service definitions. Scheduling Work Types remain operational scheduling concepts and are not promoted into a second commercial or Field catalog.

No production service documents are migrated in this architecture phase.

## H. Persistence and concurrency design

Canonical Field mutations go through Field Authority, not direct whole-document client writes.

Each mutation command must include or derive:

- authenticated actor;
- Work Order / Visit identity;
- action name;
- expected current status/version/update token where applicable;
- idempotency/correlation key for retry-safe operations;
- reason/notes where the transition requires them.

Server mutation sequence:

1. authenticate;
2. load canonical record(s);
3. resolve dated assignment/responsibility;
4. authorize action;
5. validate transition/invariants;
6. execute Firestore transaction/batch with concurrency precondition/version check;
7. append audit/revision evidence in the same governed transaction where required;
8. return authoritative updated projection and `allowedActions`.

The first WorkVisit preparation command is implemented as a transaction-backed server-local boundary but is deliberately not wired to the HTTP action set. It requires `appendAuditInTransaction`; without an approved persistent Field audit/event writer the command cannot be activated.

UI drafts/outbox are transport state only. They never become another canonical WorkVisit/Intervention source of truth.

## I. Evidence design

Reuse the existing Firebase Storage upload transport and optimization behavior where safe; do not create a second media uploader.

Canonical evidence metadata/linkage must be committed through the Field application boundary so the server can validate Work Order/Visit/Asset/Intervention/report-section ownership. Storage objects are evidence blobs, not the canonical technical record.

A future Storage Rules tightening must be accompanied by emulator allow/deny tests and requires explicit human approval before production deployment.

## J. Office Review separation

Technical execution state and Office Review state are separate.

Legacy compatibility may map old `ready_for_review`, `changes_requested` and reviewed/completed values into FieldReviewRevision projections, but the canonical WorkIntervention lifecycle must not acquire editorial review states.

Office Review may return a revision for correction, but it must not silently mutate the planned Appointment, approved pricing snapshot or prior approved revision.

`apps/erp-next/lib/field-operations.ts::validateVisitForOfficeReview` is currently a Phase 1 domain specification/acceptance helper, not a production mutation authority. Before Phase 8 exposes submission/review writes, its required validation must be implemented server-side and the client-side gate must not remain a second authority.

## K. Runtime boundary and UI migration

Current ERP Next `/field` renders `TechnicianFieldHome`, backed by `getFieldSchedule` and `getFieldJob` from Field Operations Authority. The route is deliberately read-only. Legacy Technician and browser/localStorage Field implementations remain fallback/compatibility paths over older models.

Migration rule:

- do not merge the component trees;
- treat Legacy/browser Field as compatibility/fallback until canonical parity is proven;
- keep one ERP Next Field entry surface backed by Field Authority;
- do not add write buttons whose server mutations do not exist and are not governed/audited;
- once canonical persistence/UI reaches parity, retire browser Field code only after proving there are no remaining references and Legacy parity obligations are satisfied.

No new `patchTechnician*.cjs` or patch-chain generation is allowed for ERP Next Field.

## L. Smallest architecturally correct implementation slices

### Slice 1 — read/security boundary — IMPLEMENTED / VALIDATED

Implemented:

1. Field Function syntax/tests are part of existing Functions validation and ERP Next feature CI.
2. Equipment test fixtures use production-contract-shaped `equipmentSystems.components[]`, and `get_job` projects component technical fields with historical root fallback.
3. Field Authority reuses `bookingVanIdentity.js`.
4. Dated crew membership is factored into `bookingSchedulingPrimitives.js` and reused by Scheduling and Field while Scheduling retains readiness/capacity behavior.
5. Field Authority returns server-derived `responsibility`, `assignmentSource` and `allowedActions`.
6. Field HTTP actions remain exactly `get_schedule` and `get_job`; no mutation endpoint was introduced.
7. Client Field authorization no longer reconstructs lead/helper/technician policy; it consumes the server projection literally.
8. The newly enforced gate exposed and corrected a real off-by-one defect where a nominal seven-day Field range admitted eight days.

Validated on the feature branch with:

- Functions syntax validation;
- Field Authority tests;
- Booking/Scheduling regression tests;
- ERP Next typecheck;
- Dispatch, Appointment lifecycle, Booking Intelligence, Booking Copilot, Live Scheduling, Employee Schedule, Field domain and Field security acceptance suites;
- ERP Next production build;
- Legacy/root TypeScript and Expo web build validation.

**Slice 1 exit: PASS.** The read/security boundary is contract-real and single-authority. No production Function was deployed.

### Slice 2 — first governed WorkVisit boundary — IMPLEMENTED / TESTED / NOT ACTIVATED

Implemented safely under the existing Field Operations Authority:

1. `fieldOperationsAuthorityWorkVisit.js` provides a transaction-backed **initial WorkVisit preparation** command; it is not broad CRUD and is not exported by the HTTP action set.
2. Server validates active/released Work Order state, Customer/Property/Appointment identity and current assignment/action authority.
3. Planned scope is snapshotted without rewriting Appointment or Work Order quantity; unknown/zero estimated equipment remains `0`.
4. It reuses active `workVisits` persistence and emits a canonical projection while retaining Legacy-compatible storage aliases.
5. Initial visit identity matches active Legacy `visit-${idPart(workOrderId)}` behavior and is explicitly not a return-visit identity factory.
6. Canonical participating staff uses staff-profile IDs only and does not copy raw mixed-namespace Work Order `technicianIds`.
7. Unknown Work Order lifecycle or persisted WorkVisit lifecycle fails closed rather than defaulting to a startable state.
8. Retries are idempotent; compatible initial Legacy visits are reused rather than duplicated; identity conflicts fail closed.
9. `appendAuditInTransaction` is mandatory and audit failure aborts the transaction.
10. `fieldOperationsAuthorityTransitions.js` is the sole WorkVisit transition graph. Client WorkVisit transition/start/snapshot authority has been removed.
11. `FIELD_ACTIONS` remains `get_schedule` + `get_job`; `prepare_visit` and `start_visit` are explicitly rejected by tests.

**Activation blocker:** DEMAC does not yet have an approved canonical persistent Field lifecycle/audit event boundary. `userAuditLogs` is user/access administration and must not be repurposed. Creating a Field event ledger is a new persistence authority and is therefore `NEEDS_HUMAN`. Until approved, no WorkVisit mutation is exposed or deployed.

Do not implement add-on, inventory, billing or Office Review writes in this slice.

### Phase 3 read-only Technician Home — IMPLEMENTED / VALIDATED

- `/field` is the canonical Field entry route and no longer renders BrowserFieldExecution.
- Technician post-login default and direct-route guard are derived from existing `navigationGroups`; no second role-routing matrix exists.
- Today/Tomorrow/Week and next-job use centralized Aruba date/time handling and one authorized seven-day server fetch.
- Completed assigned work remains visible but server actions are read-only.
- Job detail separates `PROGRAMADO POR LA OFICINA` from known equipment and preserves incomplete estimated scope.
- Navigate/Call/WhatsApp are contact/navigation affordances only; no field mutation buttons are exposed.
- UI error states preserve server errors and allow the technician to return safely to the route list.

### Slice 3+ — progress by domain dependency

VisitAsset -> WorkIntervention -> templates/evidence/measurements/findings -> sale lines/approvals -> partial completion/second visit -> Office Review revisions -> history projections -> offline outbox -> inventory/billing handoffs.

Each slice reuses the existing authority for the downstream domain and must pass its own regression boundary before the next is opened.

## M. Affected systems/files

### Implemented Field foundation/read/WorkVisit boundary

- `functions/package.json`
- `.github/workflows/erp-next-ci.yml`
- `functions/fieldOperationsAuthorityCore.js`
- `functions/fieldOperationsAuthorityCore.test.js`
- `functions/fieldOperationsAuthorityWorkVisit.js`
- `functions/fieldOperationsAuthorityWorkVisit.test.js`
- `functions/fieldOperationsAuthorityTransitions.js`
- `functions/fieldOperationsAuthorityTransitions.test.js`
- `functions/fieldOperationsAuthority.test.js`
- `functions/bookingSchedulingPrimitives.js`
- `functions/bookingSchedulingPrimitives.test.js`
- `apps/erp-next/lib/field-authority.ts`
- `apps/erp-next/lib/field-authorization.ts`
- `apps/erp-next/lib/field-operations-domain.ts`
- `apps/erp-next/lib/field-operations.ts`
- `apps/erp-next/lib/security.ts`
- `apps/erp-next/lib/capabilities.ts`
- `apps/erp-next/lib/firebase/principal.ts`
- `apps/erp-next/lib/role-routing.ts`
- `apps/erp-next/lib/aruba-date.ts`
- `apps/erp-next/app/(erp)/field/page.tsx`
- `apps/erp-next/components/field/technician-field-home.tsx`
- `apps/erp-next/components/field/technician-field-home.module.css`
- Field acceptance scripts/tests.

`bookingVanIdentity.js` is reused unchanged. `fieldOperationsAuthority.js` remains read-only and its action set remains unchanged.

### Later slices

- VisitAsset / WorkIntervention persistence commands under Field Operations Authority
- canonical report/template/evidence/measurement/finding commands
- `functions/serviceCatalog.js` and tests when Field template metadata is introduced
- Field Sale/approval commands and Inventory/Billing handoffs in their governed phases
- Firestore/Storage rules + emulator tests in their governed security phase

Legacy source/patch scripts are not implementation targets unless a specific compatibility defect is proven and its patch owner is traced first.

## N. Source-of-truth map after this design

| Concept | One authority / source of truth | Non-authoritative projections/adapters |
| --- | --- | --- |
| Authentication | Firebase Auth + governed `users/{uid}` | ERP session/client principal |
| Employee | `staffProfiles` | names embedded in historical snapshots |
| Van identity | canonical vans + `bookingVanIdentity` normalization | user/work-order raw aliases |
| Dated crew override | `dailyVanAssignments` | recurring van crew fallback |
| Scheduling plan | Booking Authority / Appointment | WorkVisit scheduled-scope snapshot |
| Work Order release/lifecycle | Work Order application boundary | Field read projection |
| Actual visit/work | Field Operations Authority | ERP Next view models, offline drafts |
| WorkVisit transition authority | server Field Operations Authority | UI labels/status display only |
| Field action authorization | Field Operations Authority using identity + assignment | `security.ts`, server `allowedActions` rendered by client |
| Customer/Property/Asset identity | CRM | Field snapshots/VisitAsset participation |
| Service/product | `services` | Scheduling Work Type / UI labels |
| Report template definition | governed template registry referenced by service execution metadata | rendered form sections |
| Pricing | catalog/settings authority | immutable Field price snapshot |
| Inventory | Inventory Authority | Field candidate/handoff |
| Billing/accounting | billing integration/QBO authority | Field billing candidate |
| Evidence blob | Firebase Storage | thumbnails/download URLs |
| Evidence technical linkage | Field Operations record | UI media state |
| Office Review revisions | Field Operations review revision records | rendered report/customer output |

## O. Risks and regression controls

### High risk — assignment divergence

**Risk:** a technician sees/changes another team's job, or loses an explicitly assigned job because readiness data changed.

**Control:** canonical van normalization; one reusable dated crew membership primitive; explicit Work Order assignment plus resolved crew membership; negative known-ID tests; van-only profile fallback is read-only.

### High risk — duplicate transition/action policy

**Risk:** UI permits an action that server rejects or vice versa.

**Control:** server is sole action/mutation decision boundary; client receives `allowedActions`; WorkVisit transition/start/snapshot policy has been removed from the client. Future Intervention/Sale/Office Review mutation gates must follow the same pattern before activation.

### High risk — Scheduling regression

**Risk:** extracting crew membership changes booking capacity behavior.

**Control:** `resolveAssignment()` consumes the new membership helper without changing readiness calculation; existing Booking/Scheduling suites and focused membership/readiness tests pass.

### High risk — equipment contract mismatch

**Risk:** Job Detail loses BTU/brand/model or creates a second Asset representation.

**Control:** contract-real `components[]` fixtures and compatibility adapter; no new equipment collection.

### High risk — lost updates / multi-device edits

**Risk:** whole-document client PATCH overwrites another technician's section/change.

**Control:** production-facing ERP Next Field remains read-only. Future writes require server transaction/batch, expected version/update token, narrow commands, section-level records and idempotency keys. The unexposed WorkVisit preparation boundary already demonstrates transaction/idempotency/audit-failure behavior.

### High risk — unknown lifecycle coercion

**Risk:** malformed or newly introduced Work Order/WorkVisit status is silently interpreted as a startable visit.

**Control:** compatibility mappings are explicit allowlists; unknown/missing lifecycle values fail closed and are covered by focused tests.

### Medium risk — Legacy patch regeneration

**Risk:** manual Legacy source fix is overwritten on the next build.

**Control:** Legacy changes require tracing patch owner first; ERP Next Field does not depend on Legacy patch scripts. Root Legacy typecheck/Expo build remains a regression gate.

### Medium risk — service/template mismatch

**Risk:** UI hardcodes a work/template combination different from catalog configuration.

**Control:** central service-definition resolver and template registry reference in the governed catalog phase; compatibility aliases stay in adapter only.

## P. Testing and evidence plan

### Current implemented evidence

- `functions/validate:firebase` includes Field Core, WorkVisit preparation, WorkVisit transitions and HTTP authority syntax — PASS at the latest validated implementation checkpoint.
- focused `test:field-authority`, including read-only HTTP surface, preparation boundary and transition behavior — PASS at the latest validated implementation checkpoint.
- production-contract-shaped equipment fixture including `components[]` — PASS.
- canonical van alias tests — PASS.
- direct technician assignment, dated lead/helper, van fallback read-only, another-team known-ID deny, inactive principal deny and Office behavior — PASS.
- canonical/Legacy role normalization — PASS.
- crew membership/readiness regression against Scheduling primitives — PASS.
- WorkVisit preparation retry, planned-data immutability, CRM identity, staff namespace, audit failure and unknown-lifecycle failure paths — PASS at the latest validated implementation checkpoint.
- ERP Next `test:field-security` validates coarse client capability vocabulary, role routing and literal server-action projection — PASS.
- ERP Next field-domain acceptance, typecheck and production build — PASS at the latest validated implementation checkpoint.
- existing Scheduling/Booking suites affected by the refactor — PASS.
- Legacy/root TypeScript and Expo web build validation — PASS at the latest validated implementation checkpoint.

The latest documentation-only or follow-up hardening commit must still be observed in CI before a later formal review may cite it as fully green; prior green checkpoints do not substitute for a newer head.

### Before any security-rule deployment

- Firestore emulator allow/deny tests for assigned/unassigned technician, helper/lead, Office and inactive principal.
- Storage emulator tests if evidence rules change.
- No production rule deployment from automated implementation work.

### Before each activated mutation slice

- state-transition unit tests including invalid transitions;
- idempotent retry tests;
- concurrent expected-version conflict tests where mutable records are updated;
- audit event assertions using the approved persistent Field audit boundary;
- integration test from API command to Firestore-shaped result;
- regression test proving Appointment planned quantity/work lines remain unchanged;
- server re-resolution of current assignment/action authority inside the mutation transaction or an equivalent proven no-TOCTOU boundary.

## Q. Migration, recovery and rollback

### Migration posture

Migration is additive and phased.

- No production data migration has been performed.
- Existing Work Orders/Appointments/equipment remain readable through adapters.
- The first canonical WorkVisit preparation command exists in branch code but is not HTTP-activated and has not created production Field records.
- New Field records, when eventually activated, reference existing canonical identities; they do not rewrite Scheduling planned records.
- Historical Legacy records may be projected/adapted during parity work; destructive conversion is prohibited.
- Production backfills/service metadata migration require explicit human approval and a separate reviewed migration plan.

### Recovery

Every future activated mutation uses idempotent commands and auditable records so a retry can recover without creating duplicate visits/interventions/sales. Failed multi-record operations must transactionally commit all required canonical changes or none of them, except external blob upload where orphan cleanup/reconciliation is explicitly handled.

The initial WorkVisit preparation command uses a deterministic Legacy-compatible first-visit identity for retry/adoption only. This identity must not be reused for a second physical return; return visits require distinct identities and preserve the first visit.

### Rollback

The current active `/field` route is a read-only Field Authority consumer. A safe code rollback can restore the prior route while preserving all existing data; no production canonical Field mutation has been activated by this workstream.

After additive canonical writes begin, rollback must **never delete the new canonical records**. The safe rollback is to disable/hide the new mutation surface, preserve those records read-only/auditable, and restore the previous UI route while the defect is corrected. Any data repair/backfill requires a separate reviewed recovery operation.

Production function/rule deployment rollback is a human-controlled operational action and is not authorized by this architecture checkpoint.

## Exact-scope hard-gate redesign

**Old rule:** field start requires `selectedEquipment.length === bookedQuantity`.

**Canonical start rule:** field start requires an authorized/released Work Order, an authenticated assigned field principal, a valid Customer/Property reference, and enough information to begin safely. Exact equipment identity/count is not a start prerequisite.

**Canonical submission rule:** before a visit can enter Office Review, every actual intervention must reference an explicit VisitAsset; each VisitAsset must resolve to a canonical Asset or an allowed on-site registration workflow; planned work must be reconciled by performed interventions and/or explicit not-performed dispositions; billable added work requiring approval must have a valid approval; pending work and second-visit requirements must be explicit.

This preserves `planned != actual` without weakening completion integrity.

## Implementation checkpoint review status

### Slice 1 review passes — PASS

- **Correctness:** assigned read, responsibility, `allowedActions`, component-shaped equipment projection and bounded seven-day range are covered.
- **Architecture / duplication:** Field server is the action authority; van identity and dated crew membership reuse existing authorities.
- **Integration / regression:** Functions, Scheduling/Booking, ERP Next and Legacy gates passed on the validated Slice 1 checkpoint.
- **Production readiness:** safe read/security foundation only; no production deploy/rule/migration occurred.

### Phase 3 read-only checkpoint — PASS

- `/field` is cut over only to the canonical **read-only** Home.
- role-aware technician routing is derived from existing navigation authority.
- no Field mutation button or browser-local canonical write is active.
- relevant Functions, ERP Next and Legacy gates passed on its validated checkpoint.

### Slice 2 / transition self-audit — implementation present, activation blocked

- preparation + WorkVisit state graph are server-owned and test-gated;
- client WorkVisit transition/start/snapshot authority has been removed;
- compatibility mappings now fail closed;
- HTTP mutation actions remain absent;
- final formal review of the current head remains separate from this implementation/self-audit phase.

## Human-only boundaries

`NEEDS_HUMAN` before any of the following:

- approval/creation of the canonical persistent Field lifecycle/audit event boundary required to activate `prepare_visit` or later Field writes;
- merge to `main`;
- production Firebase Function deployment;
- production Firestore/Storage Rules change;
- production migration/backfill that writes or transforms canonical data;
- destructive cleanup of Legacy/browser/Field records;
- secret/credential/access/security changes;
- live inventory/billing/customer-message side effects;
- any decision that would establish a genuinely new business source-of-truth boundary rather than extend the Field Operations authority already approved by this architecture.