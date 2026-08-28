# DEMAC ERP Next — Technician Portal Canonical Architecture

Status: Phase 0/architecture PASS; Phase 1 foundation PASS; Slice 1 read/security PASS; Phase 3 Technician Home PASS at foundation; approved Field audit boundary + initial WorkVisit preparation active on branch; Phase 4 active status PARTIAL (`en_route` / `on_site` / `in_progress`)
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
| Work Order | governed existing WorkOrder record semantics provide release/context; the repository does not yet contain a production-grade persisted WorkOrder transition service for Field to call, so Field does not invent one |
| Product/service catalog | canonical `services` collection and existing service-definition normalization |
| Van identity | existing `functions/bookingVanIdentity.js` |
| Crew scheduling primitives | existing `functions/bookingSchedulingPrimitives.js`; extend/refactor rather than creating a Field-only crew engine |
| Inventory | existing Inventory Authority and canonical stock records |
| Audit | approved append-only `fieldOperationEvents` through `functions/fieldOperationsAudit.js`; `userAuditLogs` is not repurposed |
| Persistence abstractions | `lib/persistence.ts` repository, clock, ID and audit contracts remain useful typed contracts; production Field writes are server-owned |
| Field API boundary | existing `functions/fieldOperationsAuthority.js` + server-local Field authority modules |
| Legacy field concepts worth preserving | WorkVisit, VisitUnit, WorkIntervention, ScopeChange, VisitApproval, QR identity, report sections, concurrent section editing |

## B. Architecture conflicts found and current disposition

1. **Two capability vocabularies existed.** `lib/capabilities.ts` uses legacy `*.read`; `lib/security.ts` contains canonical ERP capabilities. The old matrix is now compatibility-derived and may not regain authority.
2. **Field execution was browser-local preview state.** The prior `/field` route rendered `BrowserFieldExecution`. The active ERP Next `/field` route now renders `TechnicianFieldHome` backed by Field Authority. Browser/localStorage Field code remains fallback/compatibility only and is not canonical operational truth.
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
17. **Field server tests were outside the effective ERP Next feature gate.** Slice 1 added Field Function syntax, authority tests and Booking/Scheduling regression tests to the feature CI. The CI trigger now covers all `functions/fieldOperations*.js` modules so isolated Field server changes cannot silently miss the gate.
18. **WorkVisit transition/preparation policy had a temporary TS duplicate from Phase 1.** Client WorkVisit transition maps, start/preparation gates and snapshot-construction authority were removed. WorkVisit transitions live only in `fieldOperationsAuthorityTransitions.js`; activated target projection derives from that graph through `fieldOperationsVisitActions.js`; preparation/snapshot logic lives in `fieldOperationsAuthorityWorkVisit.js`. `prepare_visit` and the first active `transition_visit` slice are now HTTP-exposed on the feature branch through the same Field Authority.
19. **Compatibility adapters previously failed open on unknown lifecycle values.** WorkVisit persistence projection and WorkOrder-to-WorkVisit preparation use explicit status mappings and reject unknown/missing states instead of coercing them to `scheduled`/`not_started`.
20. **Initial WorkVisit identity could be mistaken for a universal WorkOrder→Visit identity.** `initialVisitDocumentId()` is explicitly limited to first-visit Legacy compatibility and matches Legacy 80-character ID behavior. A physical return must use a distinct future visit identity.
21. **WorkOrder status and physical visit status can diverge by design.** The Field read model now returns `fieldVisit` separately from the WorkOrder release/planning status. ERP Next displays both and uses WorkVisit for physical `En camino` / `En el sitio` / `En proceso` progress instead of rewriting WorkOrder status or inferring actual state from scheduling data.
22. **The ERP Next Work Order module is currently preview/domain UI, not a persisted application-service authority.** `work-order-command.tsx` uses seed state and `nextLifecycleStatus()` in the browser. Field must not call or copy that preview logic as a production WorkOrder transition service.

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

### FieldOperationEvent
Append-only audit evidence for material Field lifecycle actions. `fieldOperationEvents` records actor, target, request/correlation identity, occurrence time and bounded before/after metadata. It is audit evidence, not a second WorkVisit state store; WorkVisit remains the actual visit authority.

## D. Data ownership

- Appointment / planned work: Scheduling / Booking Authority.
- Work Order release/readiness/context: existing governed WorkOrder semantics / Operations boundary. Until a real persisted WorkOrder transition application service exists, Field does not create one inside the Technician Portal.
- Work Visit and field child records: Field Operations domain.
- Customer / Property / Asset identity: CRM.
- Service/Product definitions and base prices: `services` catalog.
- Field price actually presented/approved: immutable snapshot on field line/intervention.
- Field lifecycle audit: append-only `fieldOperationEvents`; never used as current-state authority.
- Inventory effect: Inventory Authority only.
- Billing result: Billing/Invoice authority; Field only emits governed billing candidates/handoff data.
- Customer and equipment history: read projections from canonical Work Visits, Interventions, Sales, Findings and Evidence; never writable duplicate history tables.

## E. State machines and mutation authority

### WorkVisit

`scheduled -> en_route -> on_site -> in_progress -> ready_for_office_review -> completed`

Allowed branches from active states: `pending`, `requires_return_visit`, `no_access`, `cancelled`. Transitions are centralized and auditable; arbitrary UI status writes are forbidden.

The canonical WorkVisit transition graph is implemented server-side in `functions/fieldOperationsAuthorityTransitions.js`. `allowedWorkVisitTransitions()` exposes the graph to other server modules without duplicating it. `fieldOperationsVisitActions.js` filters that canonical graph to the transitions actually activated in the current slice. The HTTP `transition_visit` command exposes `en_route`, `on_site`, `in_progress`, governed `pending -> in_progress`, governed `requires_return_visit`, and terminal `no_access` / `cancelled`. Entering `pending` requires a canonical reason, preserves an optional next action, uses exact retry semantics for that payload, and records server-owned pause/resume timestamps plus atomic audit. Entering `requires_return_visit` records a required reason, timestamp and `requiresSecondVisit=true` without creating or overwriting a physical visit. Entering `no_access` or `cancelled` requires its own canonical reason, uses exact retry semantics, records a server-owned terminal timestamp plus atomic audit, and does not mutate Appointment or WorkOrder lifecycle. First transition timestamps are server-owned and invalid/terminal transitions are rejected.

### WorkIntervention

`planned | added_on_site -> confirmed -> in_progress -> completed`

Branches: `pending_authorization`, `pending_part`, `not_performed`, `declined`, `cancelled`. Origin remains separate from status. Its server mutation state machine is intentionally deferred until the WorkIntervention phase; do not recreate it in React/TS meanwhile.

### FieldSaleLine

`proposed -> customer_approved -> installed|delivered -> sold`

Branches: `declined`, `voided`. Inventory and billing effects remain separate governed downstream handoffs, not raw checkbox changes.

The Field Sales phase is now activated through `functions/fieldOperationsSaleLines.js` and the authenticated `create_field_sale_line`, `decide_field_sale_line` and `transition_field_sale_line` actions. Catalog lines resolve active Product identity and immutable presented price only from the canonical `services`/Pricing Authority boundary; client labels, units and prices are ignored. Customer approval or rejection creates one immutable `FieldApproval` linked only to the exact sale line. Non-catalog entries remain unpriced Office Review drafts and may only remain proposed or be voided; they never create a shadow catalog item. The server projects the exact permitted decisions/transitions, uses optimistic version and payload-exact retry semantics, and appends audit atomically. `sold` is field truth and never changes stock by itself.

When Office Review approves an immutable revision, `functions/fieldOperationsInventoryHandoffs.js` derives sold catalog Product lines from that frozen evidence and transactionally creates at most one deterministic `fieldInventoryHandoffs` candidate. The candidate carries exact Sale Line, Product, quantity, Work Order and source-location references and exposes unresolved location/whole-quantity mismatches as review blockers. It contains no Inventory movement IDs and never writes `commercialProductStock`, `warehouseInventory` or `inventoryMovements`; only the existing Inventory Authority may later perform the governed issue.

The same Office approval transaction uses `functions/fieldOperationsBillingCandidates.js` to derive at most one deterministic immutable `fieldBillingCandidates` record from completed interventions and sold catalog Field Sale Lines in the frozen revision. Governed price snapshots become candidate lines; missing pricing and mixed currencies remain explicit blockers. Declined or voided lines are excluded. The candidate contains no invoice line IDs and does not write invoices, operational finance, Accounting or QBO; those remain separate downstream authorities.

The **server-side Field Authority is the only mutation/transition decision boundary**. ERP Next displays server-projected `canPrepareVisit`, `allowedActions`, `fieldVisit` and `availableTransitions`; it does not own an independent transition map or preparation rule for canonical writes.

`apps/erp-next/lib/field-operations.ts` contains only Phase 1 read/reconciliation/specification helpers. WorkVisit preparation, scheduled-scope snapshot construction and WorkVisit transitions were removed from the client mutation domain once the server boundaries existed. `validateVisitForOfficeReview` remains a specification/compatibility helper only; production submission validation and mutation are already owned by `functions/fieldOperationsOfficeReview.js`, and the client consumes its readiness and blockers.

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

Field Authority resolves assignment and returns an `allowedActions` projection with the job/visit. Current action vocabulary includes:

- read assigned work;
- execute eligibility;
- edit report section;
- add evidence / measurement / finding;
- add asset;
- add intervention;
- propose sale;
- complete intervention;
- submit/complete visit;
- office review;
- price override where separately authorized.

For the active visit slice, `execute` eligibility is combined server-side with the canonical WorkVisit graph to derive `canPrepareVisit` and `availableTransitions`. ERP Next uses those projections only for UX. Every mutation recalculates authorization on the server using current canonical identity and assignment data; client-supplied `allowedActions`, `canPrepareVisit`, or transition projections are never trusted.

### Crew membership reuse/refactor

Do not use raw van-string equality as the canonical crew test.

1. Reuse `bookingVanIdentity.js` for canonical van identity/aliases.
2. `bookingSchedulingPrimitives.js` exposes pure dated **crew membership** separately from readiness.
3. Existing `resolveAssignment()` continues to apply absence/driver/van-readiness logic for Scheduling capacity by consuming that membership helper.
4. Field Authority consumes membership without treating a later absence/readiness change as a destructive rewrite of an already explicit Work Order assignment.
5. Explicit Work Order `technicianIds` remains a direct assignment source.
6. Van-only compatibility may allow discovery/read when necessary, but mutations require resolved explicit staff membership/responsibility.
7. Canonical `participatingStaffIds` contains staff-profile IDs only; raw Work Order `technicianIds` is not copied into that field because historical records may contain a Firebase uid.
8. Active mutations re-read dated assignment + canonical Van context inside the same Firestore transaction that changes Field truth, closing the assignment TOCTOU gap.

### Client capability vocabulary

`lib/security.ts` remains the typed ERP client capability vocabulary/navigation projection. `lib/capabilities.ts` remains compatibility-only. Neither replaces server authorization. `lib/field-authorization.ts` contains only the Field action type contract and literal `allowedActions` membership helper; it contains no assignment/role/responsibility decision matrix.

## G. Read model and adapter decisions

### Planned work

Field read models snapshot planned intent from Work Order appointment snapshots first and Appointment work lines as compatibility fallback. Planned quantity remains immutable historical intent after the WorkVisit snapshot is created.

### Current physical visit

`get_schedule` and `get_job` project the current physical WorkVisit independently from WorkOrder status.

- no WorkVisit yet => `fieldVisit: null`;
- `canPrepareVisit` is server-derived and currently true only for an executable not-started active WorkOrder compatible with initial `scheduled` WorkVisit preparation;
- once a WorkVisit exists, its canonical status/version/timestamps and activated `availableTransitions` are returned;
- historical multiple visits are resolved by their `previousVisitId` chain; broken, branched, cyclic, disconnected or identity-conflicting history fails closed rather than guessing current truth;
- Legacy WorkOrders already in an in-flight status but lacking a WorkVisit are not silently converted into canonical physical history. Legacy remains the fallback for such records until a governed reconciliation/migration decision exists.

### Equipment

`get_job` adapts the existing `equipmentSystems` contract instead of inventing a new equipment representation:

- preserve canonical equipment ID/QR/customer/property identity;
- derive display brand/model/serial/BTU/refrigerant/voltage from applicable component data;
- retain root technical fields only as historical compatibility fallback;
- do not require BTU, brand, model or both nameplate photos merely to create/identify an Asset;
- incomplete technical metadata is explicit and may be enriched during the visit;
- optional QR identification is activated only for an already-projected Asset: `attach_visit_asset_by_qr` hardcodes `qr_scan` provenance and revalidates current assignment, active visit, Customer, Property, Asset and canonical QR inside the same transaction;
- a missing, mismatched, inactive or foreign-customer/property QR fails closed and never creates or reassigns an Asset. New A/C registration remains the separate governed path with all mandatory technical fields and evidence.

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
3. revalidate current WorkOrder release/context where required;
4. resolve dated assignment/responsibility inside the transaction;
5. authorize action;
6. validate transition/invariants;
7. execute Firestore transaction/batch with concurrency/version check;
8. append `fieldOperationEvents` evidence in the same transaction;
9. return authoritative updated projection and `allowedActions`/available transitions.

`prepare_visit` implements this sequence for initial WorkVisit preparation/adoption. `transition_visit` implements it for the currently activated physical transitions. Same-target retry is an idempotent no-op even when the caller still has the pre-transition version; a different stale transition receives `version_conflict` and must refresh. Audit failure aborts the surrounding transaction.

UI cache, drafts and outbox are transport state only. They never become another canonical WorkVisit/Intervention source of truth. ERP Next stores these records in user-scoped IndexedDB without authentication tokens. Successful reads refresh a bounded cache; a cached schedule/job is labeled stale and disables canonical mutations, while technical free-text may remain a local version-linked draft. An uncertain mutation stores the exact action/payload/request ID and reports it as pending rather than successful. Reconnection retries the same idempotency key; definitive server/version conflicts become blocked records requiring review rather than destructive overwrite.

## I. Evidence design

Reuse the existing Firebase Storage upload transport and optimization behavior where safe; do not create a second media uploader.

Canonical evidence metadata/linkage must be committed through the Field application boundary so the server can validate Work Order/Visit/Asset/Intervention/report-section ownership. Storage objects are evidence blobs, not the canonical technical record.

A future Storage Rules tightening must be accompanied by emulator allow/deny tests and requires explicit human approval before production deployment.

## J. Office Review separation

Technical execution state and Office Review state are separate.

Legacy compatibility may map old `ready_for_review`, `changes_requested` and reviewed/completed values into FieldReviewRevision projections, but the canonical WorkIntervention lifecycle must not acquire editorial review states.

Office Review may return a revision for correction, but it must not silently mutate the planned Appointment, approved pricing snapshot or prior approved revision.

`apps/erp-next/lib/field-operations.ts::validateVisitForOfficeReview` remains a Phase 1 specification/compatibility helper, not production mutation authority. `functions/fieldOperationsOfficeReview.js` now owns submission validation, immutable revision creation and office decisions. It evaluates the complete linear physical-visit chain, freezes the Professional Report read projection as source evidence without merging the two domains, and exposes only server-derived readiness/blockers to the client.

The canonical lifecycle is `submit -> pending review -> approve` or `return -> correct -> resubmit`. One deterministic Office Review identity belongs to the Work Order; each submission creates a new immutable revision. A corrected resubmission requires a technician amendment note and freezes the prior revision identity, the Office return note and the technician correction note in the new revision; prior technical evidence and revisions are not overwritten. Approval moves the current WorkVisit to `completed`; return moves it to `in_progress`. Technician transition APIs expose no action from `ready_for_office_review`, so only the Office Review decision boundary can reopen or complete a submitted visit. Customer delivery is explicitly outside this command set.

## K. Runtime boundary and UI migration

Current ERP Next `/field` renders `TechnicianFieldHome`, backed by Field Operations Authority. `get_schedule` / `get_job` are assignment-scoped reads, and the UI consumes server-projected capabilities for visit lifecycle, assets, interventions, report evidence, approvals, planned-work disposition, Field Sale Lines and Office Review submission. The optional QR control searches only the already assignment-scoped equipment projection and sends the selected canonical Asset plus presented QR for server revalidation; it is not a registration or ownership authority. Field Sale controls never reconstruct pricing or transition policy in the UI. Legacy Technician and browser/localStorage Field implementations remain fallback/compatibility paths over older models.

`functions/fieldOperationsHistories.js` derives Customer and Equipment histories during the already assignment-authorized `get_job` read. It queries canonical Customer-linked Field records, validates every child against its Work Visit and every Finding against its Work Intervention, and returns Equipment histories as exact references into the Customer projection. ERP Next validates those relations again and renders them read-only. No Customer-history or Equipment-history collection is created or mutated.

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
6. At the Slice 1 checkpoint, Field HTTP was read-only (`get_schedule` + `get_job`). Later governed slices add mutation actions without changing this read/security authority.
7. Client Field authorization does not reconstruct lead/helper/technician policy; it consumes the server projection literally.
8. The enforced gate exposed and corrected a real off-by-one defect where a nominal seven-day Field range admitted eight days.

**Slice 1 exit: PASS.** No production Function was deployed.

### Slice 2 — approved initial WorkVisit + audit boundary — IMPLEMENTED / HTTP-ACTIVATED ON BRANCH

Implemented under the existing Field Operations Authority:

1. `fieldOperationsAuthorityWorkVisit.js` provides transaction-backed initial WorkVisit preparation; it is exposed only through governed `prepare_visit`, not broad CRUD.
2. Server validates active/released WorkOrder state, Customer/Property/Appointment identity and current assignment/action authority.
3. Planned scope is snapshotted without rewriting Appointment or WorkOrder quantity; unknown/zero estimated equipment remains `0`.
4. It reuses active `workVisits` persistence and emits a canonical projection while retaining Legacy-compatible storage aliases.
5. Initial visit identity matches active Legacy `visit-${idPart(workOrderId)}` behavior and is explicitly not a return-visit identity factory.
6. Canonical participating staff uses staff-profile IDs only and does not copy raw mixed-namespace WorkOrder `technicianIds`.
7. Unknown WorkOrder lifecycle or persisted WorkVisit lifecycle fails closed rather than defaulting to a startable state.
8. Retries are idempotent; compatible initial Legacy visits are reused rather than duplicated; identity conflicts fail closed.
9. DEMAC approved append-only `fieldOperationEvents`; the command requires a transaction-scoped audit writer and audit failure aborts the transaction.
10. Current assignment is re-resolved through `fieldOperationsMutationAssignment.js` inside the same Firestore transaction.

**Slice 2 activation status:** code is HTTP-activated on the feature branch; no production Function has been deployed.

### Phase 3 Technician Home — IMPLEMENTED / VALIDATED FOUNDATION, EXTENDED BY PHASE 4

- `/field` is the canonical Field entry route and no longer renders BrowserFieldExecution.
- Technician post-login default and direct-route guard are derived from existing `navigationGroups`; no second role-routing matrix exists.
- Today/Tomorrow/Week and next-job use centralized Aruba date/time handling and one authorized seven-day server fetch.
- Job detail separates `PROGRAMADO POR LA OFICINA` from actual physical visit state and known equipment.
- Navigate/Call/WhatsApp remain contact/navigation affordances.
- Phase 4 extends this same component with server-projected active-visit controls; it does not introduce a second Field component tree.

### Phase 4 — active physical visit status — PARTIAL / IMPLEMENTED FOR FIRST THREE TRANSITIONS

Implemented:

1. `fieldOperationsAuthorityTransitions.js` remains the only full WorkVisit transition graph.
2. `fieldOperationsVisitActions.js` derives the activated targets from that graph and `execute` authority.
3. `fieldOperationsVisitRead.js` projects the current physical WorkVisit, `canPrepareVisit`, version/timestamps and `availableTransitions` while keeping WorkOrder status separate.
4. `fieldOperationsVisitMutation.js` owns transaction-backed `en_route`, `on_site`, and `in_progress` transitions with optimistic concurrency, retry behavior, current assignment, WorkOrder release revalidation and atomic audit.
5. `transition_visit` is authenticated through the same Field HTTP authority; client-supplied action projections are ignored.
6. Technician Home uses only server-projected preparation/transition eligibility and shows **En camino**, **Llegué**, and **Iniciar trabajo**.
7. On uncertain timeout/error, the client re-fetches server state instead of guessing whether the transaction committed.
8. WorkOrder planned/release status is not rewritten to simulate physical Field status.

The governed `requires_return_visit` outcome records the need first; a separate authenticated `create_return_visit` command then creates a new scheduled physical WorkVisit with its own deterministic retry identity and `previousVisitId`, while preserving the first visit and rejecting a branched chain. Office Review submission/completion is now activated over the complete linear chain, and a chain tip still marked `requires_return_visit` is not final-submittable. Returned-review amendment/resubmission is activated as immutable revision context; it does not reopen append-only technical evidence or silently rewrite prior submissions. The terminal `no_access` / `cancelled` branches do not imply that Appointment/WorkOrder was cancelled.

### Slice 3+ — progress by domain dependency

VisitAsset -> WorkIntervention -> templates/evidence/measurements/findings -> sale lines/approvals -> partial completion/second visit -> Office Review revisions -> history projections -> Inventory/Billing candidates -> offline outbox -> downstream authority consumption.

The dependency chain is implemented through Customer/Equipment history projections, immutable Field-to-Inventory/Field-to-Billing candidates and the user-scoped offline cache/draft/outbox boundary. Inventory, invoice and accounting authority consumption remain later boundaries.

Each slice reuses the existing authority for the downstream domain and must pass its own regression boundary before the next is opened.

## M. Affected systems/files

### Implemented Field foundation/read/active WorkVisit boundary

- `functions/package.json`
- `.github/workflows/erp-next-ci.yml`
- `functions/fieldOperationsAudit.js`
- `functions/fieldOperationsFirestoreData.js`
- `functions/fieldOperationsMutationAssignment.js`
- `functions/fieldOperationsAuthorityCore.js`
- `functions/fieldOperationsAuthorityWorkVisit.js`
- `functions/fieldOperationsAuthorityTransitions.js`
- `functions/fieldOperationsVisitActions.js`
- `functions/fieldOperationsVisitRead.js`
- `functions/fieldOperationsVisitMutation.js`
- `functions/fieldOperationsAuthority.js`
- corresponding focused tests
- `functions/bookingSchedulingPrimitives.js`
- `functions/bookingSchedulingPrimitives.test.js`
- `apps/erp-next/lib/field-authority-contract.ts`
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

`bookingVanIdentity.js` is reused unchanged. The authenticated Field HTTP facade now exposes governed schedule/job reads and explicit server-owned commands for visit lifecycle, equipment, interventions, report evidence, planned-work dispositions, sales, Office Review and histories. Its allowlist is the action contract; the client cannot manufacture an unsupported mutation.

### Activated modules and remaining boundaries

- VisitAsset, WorkIntervention, report/template/evidence/measurement/finding commands and governed catalog sale lines are activated under Field Operations Authority.
- Immutable Inventory/Billing review candidates are emitted from approved frozen actual work; no stock movement or invoice is created.
- Customer/Equipment histories are read-only projections, and browser offline cache/draft/outbox remains transport state only.
- Downstream Inventory/Billing authority consumption remains a later separately governed phase.
- Firestore/Storage rules and their emulator allow/deny proof remain in the governed security phase; no Rules change is authorized by this workstream.

Legacy source/patch scripts are not implementation targets unless a specific compatibility defect is proven and its patch owner is traced first.

## N. Source-of-truth map after this design

| Concept | One authority / source of truth | Non-authoritative projections/adapters |
| --- | --- | --- |
| Authentication | Firebase Auth + governed `users/{uid}` | ERP session/client principal |
| Employee | `staffProfiles` | names embedded in historical snapshots |
| Van identity | canonical vans + `bookingVanIdentity` normalization | user/work-order raw aliases |
| Dated crew override | `dailyVanAssignments` | recurring van crew fallback |
| Scheduling plan | Booking Authority / Appointment | WorkVisit scheduled-scope snapshot |
| WorkOrder release/context | existing governed WorkOrder record semantics | Field read projection; preview WorkOrder UI state is not persistence authority |
| Actual visit/work | Field Operations Authority | ERP Next view models, offline drafts |
| WorkVisit transition authority | server Field Operations Authority | UI labels/status display only |
| Field action authorization | Field Operations Authority using identity + assignment | `security.ts`, server projections rendered by client |
| Field lifecycle audit | append-only `fieldOperationEvents` | log/report views; not current-state authority |
| Field commercial sale | Field Operations `fieldSaleLines` + immutable canonical price snapshot + linked `FieldApproval` | ERP Next controls; immutable Inventory/Billing candidates on Office approval |
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

**Control:** canonical van normalization; one reusable dated crew membership primitive; explicit WorkOrder assignment plus resolved crew membership; negative known-ID tests; van-only profile fallback is read-only; mutation assignment is re-resolved inside the write transaction.

### High risk — duplicate transition/action policy

**Risk:** UI permits an action that server rejects or vice versa.

**Control:** server is sole action/mutation decision boundary; client receives `allowedActions`, status/version and exact action/transition projections. Activated Visit, Intervention, Sale and Office Review targets derive from their canonical server boundaries; future mutation gates must follow the same pattern.

### High risk — WorkOrder/WorkVisit state conflation

**Risk:** refresh shows planned/release WorkOrder status as though it were actual Field state, or Field rewrites WorkOrder merely to keep UI labels aligned.

**Control:** read contract carries WorkOrder status and `fieldVisit` separately; physical progress counters/detail use WorkVisit; Field active transitions mutate WorkVisit only. No production WorkOrder transition service is invented from preview UI logic.

### High risk — Scheduling regression

**Risk:** extracting crew membership changes booking capacity behavior.

**Control:** `resolveAssignment()` consumes the membership helper without changing readiness calculation; existing Booking/Scheduling suites and focused membership/readiness tests pass.

### High risk — equipment contract mismatch

**Risk:** Job Detail loses BTU/brand/model or creates a second Asset representation.

**Control:** contract-real `components[]` fixtures and compatibility adapter; no new equipment collection.

### High risk — lost updates / multi-device edits

**Risk:** whole-document client PATCH overwrites another technician's section/change.

**Control:** active status writes are narrow server transactions using expected WorkVisit version. Same-target retries are idempotent; conflicting stale versions fail with 409. Future report/scope writes require similarly narrow commands, section-level records and idempotency keys.

### High risk — unknown lifecycle coercion

**Risk:** malformed or newly introduced WorkOrder/WorkVisit status is silently interpreted as a startable visit.

**Control:** compatibility mappings are explicit allowlists; unknown/missing lifecycle values fail closed. `canPrepareVisit` is server-derived and catches unsupported WorkOrder status rather than asking React to infer it.

### Medium risk — Legacy patch regeneration

**Risk:** manual Legacy source fix is overwritten on the next build.

**Control:** Legacy changes require tracing patch owner first; ERP Next Field does not depend on Legacy patch scripts. Root Legacy typecheck/Expo build remains a regression gate.

### Medium risk — service/template mismatch

**Risk:** UI hardcodes a work/template combination different from catalog configuration.

**Control:** central service-definition resolver and template registry reference in the governed catalog phase; compatibility aliases stay in adapter only.

## P. Testing and evidence plan

### Current implemented evidence

At the mandatory-scenario checkpoint through `5e71714c0c2bc8e56f27e9c813cf7390d0036b39`:

- `functions/validate:firebase` explicitly includes all Field server modules, including audit, Firestore serializer, mutation assignment, visit action/read/mutation modules and HTTP authority — PASS.
- focused `test:field-authority` manifest, executed in-process because this Windows host denies Node test-runner child-process creation — **340 tests, 340 pass, 0 fail/skipped/todo**.
- Field extension gate — **45 tests, 45 pass, 0 fail/skipped/todo**.
- Booking/Scheduling regression — **94 tests, 94 pass, 0 fail/skipped/todo**.
- active transition tests cover first timestamps, `scheduled -> en_route -> on_site -> in_progress`, same-target retry, two-device stale-version conflict, helper/read-only/unassigned denial, WorkOrder cancellation revalidation, audit rollback and nonactivated target denial.
- current-visit read tests cover no-visit preparation eligibility, WorkVisit state/version/next-transition projection, helper read-only behavior, return-chain resolution and broken/branched/cyclic/identity mismatch fail-closed behavior.
- production-contract-shaped equipment fixture including `components[]` — PASS.
- canonical van alias tests — PASS.
- direct technician assignment, dated lead/helper, van fallback read-only, another-team known-ID deny, inactive principal deny and Office behavior — PASS.
- canonical/Legacy role normalization — PASS.
- crew membership/readiness regression against Scheduling primitives — PASS.
- WorkVisit preparation retry, planned-data immutability, CRM identity, staff namespace, audit failure and unknown-lifecycle failure paths — PASS.
- ERP Next `test:field-security` validates route/capability vocabulary plus strict read/prepare/transition transport contracts — PASS.
- all 26 mandatory scenarios and the exact booked-1/actual-3+Switch fixture — PASS.
- ERP Next field-domain/offline/security acceptance and typecheck — PASS.
- production build compiles successfully on this host, after which the Next.js worker spawn is blocked locally with `EPERM`; remote CI remains the authoritative build result once the branch can be pushed.

### Before any security-rule deployment

- Firestore emulator allow/deny tests for assigned/unassigned technician, helper/lead, Office and inactive principal.
- Storage emulator tests if evidence rules change.
- No production rule deployment from automated implementation work.

### Before each later activated mutation slice

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
- Existing WorkOrders/Appointments/equipment remain readable through adapters.
- Initial WorkVisit preparation and first active status transitions are HTTP-activated in branch code but have not been deployed to production by this workstream.
- New Field records reference existing canonical identities; they do not rewrite Scheduling planned records.
- Historical Legacy records may be projected/adapted during parity work; destructive conversion is prohibited.
- Legacy in-flight WorkOrders with no WorkVisit are not silently backfilled during reads or button clicks.
- Production backfills/service metadata migration require explicit human approval and a separate reviewed migration plan.

### Recovery

Activated mutations use idempotent commands and auditable records so retries recover without creating duplicate visits or duplicate transition facts. Failed multi-record operations transactionally commit the required Field state + audit or neither. HTTP timeout is treated as uncertain delivery: the client re-reads canonical server state rather than applying an optimistic local state.

The initial WorkVisit preparation command uses a deterministic Legacy-compatible first-visit identity for retry/adoption only. Return visits use a separate deterministic request identity, preserve the first visit and immutable scheduled-scope snapshot, revalidate current assignment/WorkOrder release/history in one transaction, and append `work_visit_return_created` audit evidence atomically.

### Rollback

No production deployment has occurred. If a later rollout is authorized, server authority must be deployed before the ERP Next consumer. A safe UI rollback removes/hides active controls while preserving any canonical WorkVisits/events already written. Rollback must **never delete canonical Field records automatically**.

Production Function/rule deployment rollback is a human-controlled operational action and is not authorized by this architecture checkpoint.

## Exact-scope hard-gate redesign

**Old rule:** field start requires `selectedEquipment.length === bookedQuantity`.

**Canonical start rule:** field start requires an authorized/released WorkOrder, an authenticated assigned field principal, a valid Customer/Property reference, and enough information to begin safely. Exact equipment identity/count is not a start prerequisite.

**Canonical submission rule:** before a visit can enter Office Review, every actual intervention must reference an explicit VisitAsset; each VisitAsset must resolve to a canonical Asset or an allowed on-site registration workflow; planned work must be reconciled by performed interventions and/or explicit not-performed dispositions; billable added work requiring approval must have a valid approval; pending work and second-visit requirements must be explicit.

This preserves `planned != actual` without weakening completion integrity.

## Implementation checkpoint review status

### Slice 1 review passes — PASS

- **Correctness:** assigned read, responsibility, `allowedActions`, component-shaped equipment projection and bounded seven-day range are covered.
- **Architecture / duplication:** Field server is the action authority; van identity and dated crew membership reuse existing authorities.
- **Integration / regression:** Functions, Scheduling/Booking, ERP Next and Legacy gates passed on the validated Slice 1 checkpoint.
- **Production readiness:** safe read/security foundation only; no production deploy/rule/migration occurred.

### Phase 3 foundation checkpoint — PASS

- `/field` is the canonical Technician Home.
- role-aware technician routing is derived from existing navigation authority.
- current Phase 4 controls extend this component rather than creating another Field surface.

### Approved audit + preparation checkpoint — IMPLEMENTED / ACTIVE ON BRANCH

- `fieldOperationEvents` is the approved append-only Field lifecycle audit boundary;
- `prepare_visit` is authenticated, assignment-revalidated, transaction-backed and audit-coupled;
- no production deployment occurred.

### Phase 4 active status checkpoint — PARTIAL / IMPLEMENTED

- canonical transition graph remains server-owned;
- current-visit resolution and preparation/transition eligibility are server-projected;
- `en_route`, `on_site`, `in_progress`, `pending -> in_progress`, governed `requires_return_visit`, and terminal `no_access` / `cancelled` are activated through `transition_visit`;
- Technician Home exposes only those server-authorized controls, with a required canonical reason before either terminal outcome;
- WorkOrder planned/release status remains separate and is not mutated by Field;
- distinct return-visit creation is activated through `create_return_visit`; each return remains a separate physical WorkVisit;
- Office Review submission and office approve/return decisions are activated through `submit_visit_for_office_review`, `get_office_review_queue` and `decide_office_review`; revisions are immutable and customer delivery remains separate;
- returned-review correction/resubmission requires and preserves an immutable technician amendment note together with the Office return request; prior revisions remain unchanged;
- formal four-pass review of this newer slice remains separate from this implementation phase.

## Human-only boundaries

`NEEDS_HUMAN` before any of the following:

- merge to `main`;
- production Firebase Function deployment;
- production Firestore/Storage Rules change;
- production migration/backfill that writes or transforms canonical data;
- destructive cleanup of Legacy/browser/Field records;
- secret/credential/access/security changes;
- live inventory/billing/customer-message side effects;
- automatic production accounting/invoice effects unless separately approved;
- any decision that would establish another genuinely new business source-of-truth boundary.

The `fieldOperationEvents` audit boundary itself has already been explicitly approved for this architecture and is not an outstanding `NEEDS_HUMAN` item. That approval does not authorize any production operation listed above.
