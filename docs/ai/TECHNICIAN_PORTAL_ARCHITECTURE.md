# DEMAC ERP Next — Technician Portal Canonical Architecture

Status: Phase 0 architecture checkpoint + architecture design checkpoint
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
| Audit | existing audit-event authority / `AuditWriter` contract |
| Persistence abstractions | `lib/persistence.ts` repository, clock, ID and audit contracts |
| Field API boundary | existing `functions/fieldOperationsAuthority.js` + `fieldOperationsAuthorityCore.js` |
| Legacy field concepts worth preserving | WorkVisit, VisitUnit, WorkIntervention, ScopeChange, VisitApproval, QR identity, report sections, concurrent section editing |

## B. Architecture conflicts found in current code

1. **Two capability vocabularies exist.** `lib/capabilities.ts` uses `*.read`; `lib/security.ts` uses `*.view` and contains Field capabilities. Firebase principal resolution consumes `lib/security.ts`, so the old duplicate matrix must remain a compatibility projection only and must not regain authority.
2. **Field execution is browser-local preview state.** `/field` renders `BrowserFieldExecution`; `browser-field.ts`, `browser-workorder-scope.ts` and the active component persist execution/review state in browser storage. This is non-canonical by repository governance.
3. **Exact-scope hard gate is incompatible with DEMAC operations.** `scopeStatus()` requires selected equipment count to equal booked Work Order quantity before field start. This incorrectly treats scheduling estimate as field truth.
4. **Current browser field model conflates equipment and performed work.** Each equipment row owns one progress/result record, preventing multiple independent interventions on the same A/C.
5. **Current browser add-ons are counters.** Switches, brackets, Armaflex and refrigerant are not catalog-backed commercial lines with price snapshots, approval and downstream linkage.
6. **Evidence and measurements are too generic.** Browser execution uses boolean photo flags and a generic measurement string instead of intervention-context records.
7. **A second non-active demo implementation exists.** `components/field/field-execution.tsx` contains hard-coded assets and prices. It is useful only as UX reference and must not become another domain authority.
8. **`data-schema.ts` contains early greenfield collection names that do not fully reflect current Property/catalog/inventory authorities.** New field collections must be additive and must not revive stale collection boundaries.
9. **Legacy Technician has multiple generations of runtime logic produced by `patch:*` scripts.** Root `package.json` runs `patch:all` before Legacy start/web/typecheck/build; those scripts rewrite Technician source files. New ERP Next Field architecture must not add another patch generation or depend on modifying generated Legacy source without first tracing its patch owner.
10. **Assignment/responsibility is currently duplicated.** `field-authorization.ts` defines lead/technician/helper action policy while `fieldOperationsAuthorityCore.js` independently rebuilds crew responsibility and assignment from raw strings. Future writes cannot extend both implementations.
11. **Van normalization is duplicated.** `bookingVanIdentity.js` already canonicalizes aliases such as historical van IDs; Field Authority currently compares raw Work Order/user van IDs.
12. **Scheduling crew readiness and Field assignment ownership are related but not identical.** `resolveAssignment()` considers absences, `canDriveVan`, maintenance and availability. Field authorization needs stable dated crew membership without retroactively rewriting historical assignment because a readiness input later changes.
13. **Legacy WorkIntervention status conflates technical execution and report review.** `ready_for_review`/`changes_requested` are editorial review states while the canonical WorkIntervention lifecycle represents actual technical work. They must not be merged into one state machine.
14. **Technician V2 defines a local WORK_TYPES catalog and template IDs.** This duplicates Service Catalog and report-template relationships in UI code.
15. **Field Authority equipment projection does not match the active equipment contract.** Legacy equipment stores technical identity primarily in `components[]`; the current `get_job` mapper reads root `brand/model/serial/btu/refrigerant/voltage`, and its fake fixture mirrors that mapper instead of production-shaped data.
16. **Client persistence has incompatible write semantics and no optimistic concurrency contract.** Legacy helpers perform full/partial REST PATCH operations without a Field transaction/application-service boundary. Canonical Field mutations must not introduce a third client writer.
17. **Field server tests are outside the effective ERP Next feature gate.** `fieldOperationsAuthorityCore.test.js` exists, but the ERP Next CI path/steps and `functions/validate:firebase` do not currently make those Field Function files part of the feature's mandatory validation.

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

### FieldReviewRevision
A versioned submission/review snapshot inside the Field Operations authority. It preserves each technician submission, Office return note, correction/resubmission and final approval without reusing WorkIntervention technical status as report-review state. This is a child record of Field Operations, not a new business authority.

## D. Data ownership

- Appointment / planned work: Scheduling / Booking Authority.
- Work Order release/readiness: Work Order application service / Operations authority.
- Work Visit and field child records: Field Operations authority.
- Customer / Property / Asset identity: CRM.
- Service/Product definitions and base prices: `services` catalog.
- Field execution template metadata: optional governed metadata on the canonical service definition, resolved centrally through the existing Service Catalog adapter; never a UI-local Field catalog.
- Field price actually presented/approved: immutable snapshot on field line/intervention.
- Inventory effect: Inventory Authority only.
- Billing result: Billing/Invoice authority; Field only emits governed billing candidates/handoff data.
- Customer and equipment history: read projections from canonical Work Visits, Interventions, Sales, Findings and Evidence; never writable duplicate history tables.
- Authentication identity: Firebase Auth + `users/{uid}`.
- Employee identity: `staffProfiles`.
- Van identity: `bookingVanIdentity`/canonical van records.
- Dated crew override: `dailyVanAssignments`; recurring van crew is fallback, not a second employee master.

## E. State machines

### WorkVisit

`scheduled -> en_route -> on_site -> in_progress -> ready_for_office_review -> completed`

Allowed branches from active states: `pending`, `requires_return_visit`, `no_access`, `cancelled`.

### WorkIntervention

`planned -> confirmed -> in_progress -> completed`

Added work uses `origin=added_on_site_*`; origin is not a status. Branches: `pending_authorization`, `pending_part`, `not_performed`, `declined`, `cancelled`.

### FieldSaleLine

`proposed -> customer_approved -> installed|delivered -> sold`

Branches: `declined`, `voided`.

### FieldReviewRevision

`submitted -> pending_review -> approved`

Return path: `pending_review -> returned -> corrected/resubmitted -> pending_review`.

Every resubmission creates/preserves a revision snapshot. Approval locks the approved revision from normal technician mutation. Corrections after approval require a new amendment/revision event; approved technical truth is never silently rewritten.

### Transition authority decision

The **server-side Field Authority is the only mutation/transition decision boundary**. ERP Next may display server-projected allowed actions and validation messages, but it must not own an independent transition map for canonical writes.

`apps/erp-next/lib/field-operations.ts` may retain pure read/projection helpers while migration is in progress, but its transition functions must be refactored out of the mutation path as server actions are introduced. Do not copy the same transition maps into Functions.

The smallest implementation path is to **extend the existing `fieldOperationsAuthorityCore.js`**, rather than create a new cross-package shared framework. If that file later becomes too large, extraction into server-local pure modules is a refactor under the same Field authority, not another source of truth.

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

Field Authority resolves assignment and returns an `allowedActions` projection with the job/visit. Examples:

- read assigned work;
- en route / arrive / execute;
- edit report section;
- add evidence / measurement / finding;
- add asset;
- add intervention;
- propose sale;
- complete intervention;
- submit/complete visit;
- office review;
- price override where separately authorized.

ERP Next uses this projection only for UX. Every mutation recalculates authorization on the server using current canonical identity and assignment data; a client-supplied `allowedActions` value is never trusted.

### Crew membership reuse/refactor

Do not use raw van-string equality as the canonical crew test.

1. Reuse `bookingVanIdentity.js` for canonical van identity/aliases.
2. Refactor `bookingSchedulingPrimitives.js` so a pure dated **crew membership** helper is reusable independently of readiness.
3. Existing `resolveAssignment()` continues to apply absence/driver/van-readiness logic for Scheduling capacity by consuming that membership helper.
4. Field Authority consumes membership without treating a later absence/readiness change as a destructive rewrite of an already explicit Work Order assignment.
5. Explicit Work Order `technicianIds` remains a direct assignment source.
6. Van-only compatibility may allow discovery/read when necessary, but mutations require resolved explicit staff membership/responsibility.

This preserves Scheduling behavior while preventing a second Field crew engine.

### Client capability vocabulary

`lib/security.ts` remains the typed ERP client capability vocabulary/navigation projection. `lib/capabilities.ts` remains compatibility-only. Neither replaces server authorization. As Field server actions become available, action-level UI logic must use server `allowedActions` rather than add a second role/responsibility matrix in React.

## G. Read model and adapter decisions

### Planned work

Field read models snapshot planned intent from Work Order appointment snapshots first and Appointment work lines as compatibility fallback. Planned quantity remains immutable historical intent after the WorkVisit snapshot is created.

### Equipment

`get_job` must adapt the existing `equipmentSystems` contract instead of inventing a new equipment representation:

- preserve canonical equipment ID/QR/customer/property identity;
- derive display brand/model/serial/BTU/refrigerant/voltage from the applicable component data;
- do not require BTU, brand, model or both nameplate photos merely to create/identify an Asset;
- incomplete technical metadata is explicit and may be enriched during the visit;
- QR belonging to a different customer/property must be rejected for silent reassignment.

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
7. append audit/revision evidence;
8. return authoritative updated projection and `allowedActions`.

UI drafts/outbox are transport state only. They never become another canonical WorkVisit/Intervention source of truth.

## I. Evidence design

Reuse the existing Firebase Storage upload transport and optimization behavior where safe; do not create a second media uploader.

Canonical evidence metadata/linkage must be committed through the Field application boundary so the server can validate Work Order/Visit/Asset/Intervention/report-section ownership. Storage objects are evidence blobs, not the canonical technical record.

A future Storage Rules tightening must be accompanied by emulator allow/deny tests and requires explicit human approval before production deployment.

## J. Office Review separation

Technical execution state and Office Review state are separate.

Legacy compatibility may map old `ready_for_review`, `changes_requested` and reviewed/completed values into FieldReviewRevision projections, but the canonical WorkIntervention lifecycle must not acquire editorial review states.

Office Review may return a revision for correction, but it must not silently mutate the planned Appointment, approved pricing snapshot or prior approved revision.

## K. Runtime boundary and UI migration

Current ERP Next `/field` still renders `BrowserFieldExecution`; Legacy also has its original TechnicianScreen plus later V2 screens. These are three UX implementations over different models.

Migration rule:

- do not merge the three component trees;
- treat Legacy as compatibility/fallback until canonical parity is proven;
- build one ERP Next Field entry surface backed by Field Authority;
- switch the `/field` route only after its read/security behavior is validated;
- do not add write buttons whose server mutations do not exist;
- once canonical persistence/UI reaches parity, retire browser Field code after proving there are no remaining references.

No new `patchTechnician*.cjs` or patch-chain generation is allowed for ERP Next Field.

## L. Smallest architecturally correct implementation slices

### Slice 1 — close the current read/security boundary before any writes

1. Add Field Function syntax/tests to existing Functions validation and ERP Next feature CI paths/steps; do not create a parallel quality gate.
2. Replace fake equipment fixtures with production-contract-shaped `equipmentSystems.components[]` data and fix the existing `get_job` adapter.
3. Reuse `bookingVanIdentity.js` in Field Authority.
4. Refactor/extract dated crew membership inside `bookingSchedulingPrimitives.js` and reuse it from both Scheduling and Field without changing Scheduling capacity behavior.
5. Make Field Authority return server-derived `allowedActions`/responsibility for assigned jobs.
6. Keep Field endpoints read-only through this slice.

**Exit:** Phase 2/3 read authorization is contract-real, tested and single-boundary. No canonical Field record has been mutated.

### Slice 2 — first governed WorkVisit mutation

Only after Slice 1 passes all applicable gates:

1. Add one transaction-backed Visit command at a time, beginning with preparation/start/status transition rather than broad CRUD.
2. Server validates Work Order release, Customer/Property, assignment and transition.
3. Create/snapshot WorkVisit planned scope without rewriting Appointment/Work Order planned quantity.
4. Return authoritative visit + allowed actions.
5. Refactor the equivalent TS/browser transition decision out of the active mutation path.

Do not implement add-on, inventory, billing or Office Review writes in this slice.

### Slice 3+ — progress by domain dependency

VisitAsset -> WorkIntervention -> templates/evidence/measurements/findings -> sale lines/approvals -> partial completion/second visit -> Office Review revisions -> history projections -> offline outbox -> inventory/billing handoffs.

Each slice reuses the existing authority for the downstream domain and must pass its own regression boundary before the next is opened.

## M. Affected systems/files

### Architecture/design checkpoint

Only this document changes.

### Expected Slice 1 implementation files

- `functions/package.json`
- `.github/workflows/erp-next-ci.yml`
- `functions/fieldOperationsAuthorityCore.js`
- `functions/fieldOperationsAuthority.js`
- `functions/fieldOperationsAuthorityCore.test.js`
- `functions/bookingVanIdentity.js` (reuse; modify only if a demonstrated compatibility bug requires it)
- `functions/bookingSchedulingPrimitives.js`
- corresponding Scheduling primitive tests
- `apps/erp-next/lib/field-authority.ts`
- `apps/erp-next/lib/field-authorization.ts` (reduce/refactor action-decision responsibility as server projection becomes available)
- `apps/erp-next/scripts/field-security-acceptance.ts` (keep client projection tests, not server-security claims)

### Later slices

- `apps/erp-next/lib/field-operations.ts`
- `apps/erp-next/lib/field-operations-domain.ts`
- `apps/erp-next/app/(erp)/field/page.tsx`
- canonical Field UI components
- `functions/serviceCatalog.js` and tests when Field template metadata is introduced
- Firestore/Storage rules + emulator tests in their governed security phase

Legacy source/patch scripts are not expected implementation targets unless a specific compatibility defect is proven and its patch owner is traced first.

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
| Field action authorization | Field Operations Authority using identity + assignment | `security.ts`, React button visibility |
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

**Control:** canonical van normalization; one reusable dated crew membership primitive; explicit Work Order membership precedence for mutation; negative known-ID tests.

### High risk — duplicate transition policy

**Risk:** UI permits a transition that server rejects or vice versa.

**Control:** server is sole mutation decision boundary; client receives allowed-actions projection; remove local transition ownership as each mutation becomes server-backed.

### High risk — Scheduling regression

**Risk:** extracting crew membership changes booking capacity behavior.

**Control:** refactor `resolveAssignment()` to consume the new membership helper without changing its readiness calculation; run existing booking/scheduling suites plus focused equivalence tests.

### High risk — equipment contract mismatch

**Risk:** Job Detail loses BTU/brand/model or creates a second Asset representation.

**Control:** contract-real fixtures and component adapter; no new equipment collection.

### High risk — lost updates / multi-device edits

**Risk:** whole-document client PATCH overwrites another technician's section/change.

**Control:** server transaction/batch, expected version/update token, narrow commands, section-level records, idempotency keys.

### Medium risk — Legacy patch regeneration

**Risk:** manual Legacy source fix is overwritten on the next build.

**Control:** Legacy changes require tracing patch owner first; ERP Next Field must not depend on Legacy patch scripts.

### Medium risk — service/template mismatch

**Risk:** UI hardcodes a work/template combination different from catalog configuration.

**Control:** central service-definition resolver and template registry reference; compatibility aliases stay in adapter only.

## P. Testing and evidence plan

### Slice 1 mandatory evidence

- `node --check` for `fieldOperationsAuthority.js` and `fieldOperationsAuthorityCore.js` through existing `functions/validate:firebase`.
- focused `node --test fieldOperationsAuthorityCore.test.js` through an explicit Functions script.
- production-contract-shaped equipment fixture including `components[]`.
- tests for van alias normalization in Field assignment.
- tests for direct technician assignment, dated driver/lead, helper, van fallback read-only, another-team known-ID deny, inactive principal deny and Office read behavior.
- tests proving the extracted crew membership helper leaves existing Scheduling assignment/readiness outcomes unchanged for representative cases.
- ERP Next `test:field-security`, existing field-domain acceptance, typecheck and build.
- existing Scheduling/Booking suites affected by the refactor.

### Before any security-rule deployment

- Firestore emulator allow/deny tests for assigned/unassigned technician, helper/lead, Office and inactive principal.
- Storage emulator tests if evidence rules change.
- No production rule deployment from automated implementation work.

### Before each mutation slice

- state-transition unit tests including invalid transitions;
- idempotent retry tests;
- concurrent expected-version conflict tests;
- audit event assertions;
- integration test from API command to Firestore-shaped result;
- regression test proving Appointment planned quantity/work lines remain unchanged.

## Q. Migration, recovery and rollback

### Migration posture

Migration is additive and phased.

- Slice 1 performs no data migration.
- Existing Work Orders/Appointments/equipment remain readable through adapters.
- First canonical WorkVisit is created only through a governed server mutation after Slice 1.
- New Field records reference existing canonical identities; they do not rewrite Scheduling planned records.
- Historical Legacy records may be projected/adapted during parity work; destructive conversion is prohibited.
- Production backfills/service metadata migration require explicit human approval and a separate reviewed migration plan.

### Recovery

Every mutation uses idempotent commands and auditable records so a retry can recover without creating duplicate visits/interventions/sales. Failed multi-record operations must transactionally commit all required canonical changes or none of them, except external blob upload where orphan cleanup/reconciliation is explicitly handled.

### Rollback

Before route cutover, rollback is simply to leave `/field` on the existing fallback while reverting the feature-branch code commit; no data cleanup is needed.

After additive canonical writes begin, rollback must **never delete the new canonical records**. The safe rollback is to disable/hide the new mutation surface, preserve those records read-only/auditable, and restore the previous UI route while the defect is corrected. Any data repair/backfill requires a separate reviewed recovery operation.

Production function/rule deployment rollback is a human-controlled operational action and is not authorized by this architecture checkpoint.

## Exact-scope hard-gate redesign

**Old rule:** field start requires `selectedEquipment.length === bookedQuantity`.

**Canonical start rule:** field start requires an authorized/released Work Order, an authenticated assigned field principal, a valid Customer/Property reference, and enough information to begin safely. Exact equipment identity/count is not a start prerequisite.

**Canonical submission rule:** before a visit can enter Office Review, every actual intervention must reference an explicit VisitAsset; each VisitAsset must resolve to a canonical Asset or an allowed on-site registration workflow; planned work must be reconciled by performed interventions and/or explicit not-performed dispositions; billable added work requiring approval must have a valid approval; pending work and second-visit requirements must be explicit.

This preserves `planned != actual` without weakening completion integrity.

## Architecture design review passes

### PASS 1 — Correctness
The design traces Scheduling intent to immutable planned snapshots and Field actual truth without requiring booked quantity to equal discovered scope. It preserves multiple interventions per asset, partial work, second visits and review revisions.

### PASS 2 — Architecture
The smallest change extends existing Field Authority, Booking van/crew primitives, Service Catalog and template registry. It does not create a new Field catalog, crew engine, cross-package framework, browser source of truth or patch generation.

### PASS 3 — Integration / regression
Assignment refactoring is constrained to reusable membership while Scheduling retains its readiness calculation. Legacy remains fallback. Inventory and Billing remain downstream authorities. Slice 1 is deliberately read-only.

### PASS 4 — Production readiness
No production deployment, security-rule application, destructive migration, secret/access change, production communication or merge is performed by this checkpoint. Function/rule deployment, production migration and final merge remain human-only boundaries.

## Human-only boundaries

`NEEDS_HUMAN` before any of the following:

- merge to `main`;
- production Firebase Function deployment;
- production Firestore/Storage Rules change;
- production migration/backfill that writes or transforms canonical data;
- destructive cleanup of Legacy/browser/Field records;
- secret/credential/access/security changes;
- live inventory/billing/customer-message side effects;
- any decision that would establish a genuinely new business source-of-truth boundary rather than extend the Field Operations authority already approved by this architecture.
