# DEMAC ERP Next — Technician Portal Canonical Architecture

Status: Phase 0 architecture checkpoint + architecture design checkpoint + Slice 1 implementation checkpoint
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

1. **Two capability vocabularies existed.** `lib/capabilities.ts` uses legacy `*.read`; `lib/security.ts` contains canonical ERP capabilities. The old matrix remains compatibility-only and may not regain authority.
2. **Field execution is browser-local preview state.** `/field` renders `BrowserFieldExecution`; `browser-field.ts`, `browser-workorder-scope.ts` and the active component persist execution/review state in browser storage. This is non-canonical by repository governance.
3. **Exact-scope hard gate is incompatible with DEMAC operations.** `scopeStatus()` requires selected equipment count to equal booked Work Order quantity before field start. This incorrectly treats scheduling estimate as field truth.
4. **Current browser field model conflates equipment and performed work.** Each equipment row owns one progress/result record, preventing multiple independent interventions on the same A/C.
5. **Current browser add-ons are counters.** Switches, brackets, Armaflex and refrigerant are not catalog-backed commercial lines with price snapshots, approval and downstream linkage.
6. **Evidence and measurements are too generic.** Browser execution uses boolean photo flags and a generic measurement string instead of intervention-context records.
7. **A second non-active demo implementation exists.** `components/field/field-execution.tsx` contains hard-coded assets and prices. It is useful only as UX reference and must not become another domain authority.
8. **`data-schema.ts` contains early greenfield collection names that do not fully reflect current Property/catalog/inventory authorities.** New field collections must be additive and must not revive stale collection boundaries.
9. **Legacy Technician has multiple generations of runtime logic produced by `patch:*` scripts.** Root `package.json` runs `patch:all` before Legacy start/web/typecheck/build; those scripts rewrite Technician source files. New ERP Next Field architecture must not add another patch generation or depend on modifying generated Legacy source without first tracing its patch owner.
10. **Assignment/responsibility was duplicated.** Before Slice 1, `field-authorization.ts` and `fieldOperationsAuthorityCore.js` both decided lead/technician/helper actions. Slice 1 removes client action-decision logic; Field Authority now projects `allowedActions`, and the client only renders that projection.
11. **Van normalization was duplicated.** Slice 1 reuses `bookingVanIdentity.js` in Field Authority instead of raw Work Order/user van string equality.
12. **Scheduling crew readiness and Field assignment ownership are related but not identical.** Slice 1 extracts pure dated crew membership from `bookingSchedulingPrimitives.js`; Scheduling keeps absence/driver/van readiness semantics in `resolveAssignment()`, while Field consumes membership for authorization.
13. **Legacy WorkIntervention status conflates technical execution and report review.** `ready_for_review`/`changes_requested` are editorial review states while the canonical WorkIntervention lifecycle represents actual technical work. They must not be merged into one state machine.
14. **Technician V2 defines a local WORK_TYPES catalog and template IDs.** This duplicates Service Catalog and report-template relationships in UI code.
15. **Field Authority equipment projection did not match the active equipment contract.** Slice 1 corrects `get_job` to adapt technical identity from `equipmentSystems.components[]`, retaining root-field compatibility fallback only.
16. **Client persistence has incompatible write semantics and no optimistic concurrency contract.** Legacy helpers perform full/partial REST PATCH operations without a Field transaction/application-service boundary. Canonical Field mutations must not introduce a third client writer.
17. **Field server tests were outside the effective ERP Next feature gate.** Slice 1 adds Field Function syntax, authority tests and Booking/Scheduling regression tests to the existing feature CI.

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

### WorkIntervention

`planned | added_on_site -> confirmed -> in_progress -> completed`

Branches: `pending_authorization`, `pending_part`, `not_performed`, `declined`, `cancelled`. Origin remains separate from status.

### FieldSaleLine

`proposed -> customer_approved -> installed|delivered -> sold`

Branches: `declined`, `voided`. Inventory and billing effects are transition-driven, not raw checkbox changes.

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

### Client capability vocabulary

`lib/security.ts` remains the typed ERP client capability vocabulary/navigation projection. `lib/capabilities.ts` remains compatibility-only. Neither replaces server authorization. `lib/field-authorization.ts` now contains only the Field action type contract and a literal `allowedActions` membership helper; it contains no assignment/role/responsibility decision matrix.

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

**Slice 1 exit: PASS.** The read/security boundary is contract-real and single-authority. No canonical Field record was mutated and no production Function was deployed.

### Slice 2 — first governed WorkVisit mutation — NOT STARTED

Only after a subsequent implementation phase explicitly opens canonical writes:

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

### Slice 1 implementation

- `functions/package.json`
- `.github/workflows/erp-next-ci.yml`
- `functions/fieldOperationsAuthorityCore.js`
- `functions/fieldOperationsAuthorityCore.test.js`
- `functions/fieldOperationsAuthority.test.js`
- `functions/bookingSchedulingPrimitives.js`
- `functions/bookingSchedulingPrimitives.test.js`
- `apps/erp-next/lib/field-authority.ts`
- `apps/erp-next/lib/field-authorization.ts`
- `apps/erp-next/scripts/field-security-acceptance.ts`

`bookingVanIdentity.js` is reused unchanged. `fieldOperationsAuthority.js` remains read-only and unchanged in Slice 1.

### Later slices

- `apps/erp-next/lib/field-operations.ts`
- `apps/erp-next/lib/field-operations-domain.ts`
- `apps/erp-next/app/(erp)/field/page.tsx`
- canonical Field UI components
- `functions/serviceCatalog.js` and tests when Field template metadata is introduced
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

**Control:** server is sole action/mutation decision boundary; client receives `allowedActions`; Slice 1 removes client responsibility/action reconstruction.

### High risk — Scheduling regression

**Risk:** extracting crew membership changes booking capacity behavior.

**Control:** `resolveAssignment()` consumes the new membership helper without changing readiness calculation; existing Booking/Scheduling suites and focused membership/readiness tests pass.

### High risk — equipment contract mismatch

**Risk:** Job Detail loses BTU/brand/model or creates a second Asset representation.

**Control:** contract-real `components[]` fixtures and compatibility adapter; no new equipment collection.

### High risk — lost updates / multi-device edits

**Risk:** whole-document client PATCH overwrites another technician's section/change.

**Control:** future writes require server transaction/batch, expected version/update token, narrow commands, section-level records and idempotency keys. Slice 1 remains read-only.

### Medium risk — Legacy patch regeneration

**Risk:** manual Legacy source fix is overwritten on the next build.

**Control:** Legacy changes require tracing patch owner first; ERP Next Field does not depend on Legacy patch scripts. Root Legacy typecheck/Expo build remains green after Slice 1.

### Medium risk — service/template mismatch

**Risk:** UI hardcodes a work/template combination different from catalog configuration.

**Control:** central service-definition resolver and template registry reference in the governed catalog phase; compatibility aliases stay in adapter only.

## P. Testing and evidence plan

### Slice 1 evidence — PASS

- `node --check` for `fieldOperationsAuthority.js` and `fieldOperationsAuthorityCore.js` through existing `functions/validate:firebase` — PASS.
- focused `test:field-authority`, including read-only HTTP surface — PASS.
- production-contract-shaped equipment fixture including `components[]` — PASS.
- canonical van alias tests — PASS.
- direct technician assignment, dated lead/helper, van fallback read-only, another-team known-ID deny, inactive principal deny and Office behavior — PASS.
- crew membership/readiness regression against Scheduling primitives — PASS.
- ERP Next `test:field-security` now validates coarse client capability vocabulary and literal server-action projection instead of duplicating server assignment rules — PASS.
- ERP Next field-domain acceptance, typecheck and build — PASS.
- existing Scheduling/Booking suites affected by the refactor — PASS.
- Legacy/root TypeScript and Expo web build validation — PASS.

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
- First canonical WorkVisit is created only through a governed server mutation after Slice 1 and an explicit subsequent implementation phase.
- New Field records reference existing canonical identities; they do not rewrite Scheduling planned records.
- Historical Legacy records may be projected/adapted during parity work; destructive conversion is prohibited.
- Production backfills/service metadata migration require explicit human approval and a separate reviewed migration plan.

### Recovery

Every future mutation uses idempotent commands and auditable records so a retry can recover without creating duplicate visits/interventions/sales. Failed multi-record operations must transactionally commit all required canonical changes or none of them, except external blob upload where orphan cleanup/reconciliation is explicitly handled.

### Rollback

Slice 1 rollback is code-only: the active `/field` route was not cut over, no canonical Field records were written, and no production Function/rule deployment occurred.

After additive canonical writes begin, rollback must **never delete the new canonical records**. The safe rollback is to disable/hide the new mutation surface, preserve those records read-only/auditable, and restore the previous UI route while the defect is corrected. Any data repair/backfill requires a separate reviewed recovery operation.

Production function/rule deployment rollback is a human-controlled operational action and is not authorized by this architecture checkpoint.

## Exact-scope hard-gate redesign

**Old rule:** field start requires `selectedEquipment.length === bookedQuantity`.

**Canonical start rule:** field start requires an authorized/released Work Order, an authenticated assigned field principal, a valid Customer/Property reference, and enough information to begin safely. Exact equipment identity/count is not a start prerequisite.

**Canonical submission rule:** before a visit can enter Office Review, every actual intervention must reference an explicit VisitAsset; each VisitAsset must resolve to a canonical Asset or an allowed on-site registration workflow; planned work must be reconciled by performed interventions and/or explicit not-performed dispositions; billable added work requiring approval must have a valid approval; pending work and second-visit requirements must be explicit.

This preserves `planned != actual` without weakening completion integrity.

## Slice 1 implementation review passes

### PASS 1 — Correctness
Read assignment, responsibility, `allowedActions`, component-shaped equipment projection, seven-day range enforcement and read-only HTTP surface are covered by focused server tests. The new gate exposed and corrected the prior eight-day off-by-one defect instead of weakening its test.

### PASS 2 — Architecture / duplication
Field server is the only action-decision authority. Client responsibility/action reconstruction was removed. Van identity and dated crew membership reuse existing Scheduling authorities. No new catalog, crew engine, cross-package policy framework, persistence source or patch generation was created.

### PASS 3 — Integration / regression
Functions syntax, Field authority, Booking/Scheduling regressions, ERP Next typecheck/acceptance/build and Legacy/root TypeScript/Expo build all pass after the final refactor. Scheduling readiness behavior remains behind `resolveAssignment()`; Field consumes membership only.

### PASS 4 — Production readiness for this slice
Slice 1 is safe as a validated feature-branch read/security foundation, not as a completed Technician Portal. No Field mutation endpoint exists, `/field` was not cut over, no production deployment/rules/migration occurred, and PR #435 remains draft/unmerged. Production access-policy work and canonical writes remain gated.

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
