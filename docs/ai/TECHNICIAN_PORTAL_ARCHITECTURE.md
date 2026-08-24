# DEMAC ERP Next — Technician Portal Canonical Architecture

Status: Phase 0 architecture checkpoint
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
| ERP authorization | `lib/security.ts` is the active principal/capability authority used by Firebase principal loading |
| Customer | canonical CRM Customer |
| Property | canonical CRM Property; existing `siteId` is a compatibility/domain synonym, not a second location identity |
| Equipment | canonical CRM Asset |
| Appointment / booking intent | Booking Authority + Scheduling |
| Planned work | Appointment `workLines` / scheduling work-type snapshots |
| Work Order | existing work-order application boundary |
| Product/service catalog | canonical `services` collection through `lib/service-catalog.ts` |
| Inventory | existing Inventory Authority and canonical stock records |
| Audit | existing audit-event authority / `AuditWriter` contract |
| Persistence abstractions | `lib/persistence.ts` repository, clock, ID and audit contracts |
| Legacy field concepts worth preserving | WorkVisit, VisitUnit, WorkIntervention, ScopeChange, VisitApproval, QR identity, report sections, concurrent section editing |

## B. Architecture conflicts found in current code

1. **Two capability vocabularies exist.** `lib/capabilities.ts` uses `*.read`; `lib/security.ts` uses `*.view` and contains `field.execute`. Firebase principal resolution consumes `lib/security.ts`, so it is the active authority. The duplicate matrix must be retired/migrated rather than extended.
2. **Field execution is browser-local preview state.** `/field` renders `BrowserFieldExecution`; `browser-field.ts`, `browser-workorder-scope.ts` and the active component persist execution/review state in browser storage. This is non-canonical by repository governance.
3. **Exact-scope hard gate is incompatible with DEMAC operations.** `scopeStatus()` requires selected equipment count to equal booked Work Order quantity before field start. This incorrectly treats scheduling estimate as field truth.
4. **Current browser field model conflates equipment and performed work.** Each equipment row owns one progress/result record, preventing multiple independent interventions on the same A/C.
5. **Current browser add-ons are counters.** Switches, brackets, Armaflex and refrigerant are not catalog-backed commercial lines with price snapshots, approval and downstream linkage.
6. **Evidence and measurements are too generic.** Browser execution uses boolean photo flags and a generic measurement string instead of intervention-context records.
7. **A second non-active demo implementation exists.** `components/field/field-execution.tsx` contains hard-coded assets and prices. It is useful only as UX reference and must not become another domain authority.
8. **`data-schema.ts` contains early greenfield collection names that do not fully reflect current Property/catalog/inventory authorities.** New field collections must be additive and must not revive stale collection boundaries.

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

## E. State machines

### WorkVisit

`scheduled -> en_route -> on_site -> in_progress -> ready_for_office_review -> completed`

Allowed branches from active states: `pending`, `requires_return_visit`, `no_access`, `cancelled`. Transitions are centralized and auditable; arbitrary UI status writes are forbidden.

### WorkIntervention

`planned | added_on_site -> confirmed -> in_progress -> completed`

Branches: `pending_authorization`, `pending_part`, `not_performed`, `declined`, `cancelled`. Origin remains separate from status.

### FieldSaleLine

`proposed -> customer_approved -> installed|delivered -> sold`

Branches: `declined`, `voided`. Inventory and billing effects are transition-driven, not raw checkbox changes.

## F. Permission model decision

`lib/security.ts` is the canonical ERP authorization vocabulary because Firebase principal loading already resolves `AuthPrincipal.capabilities` from it. Phase 2 will migrate remaining consumers of `lib/capabilities.ts` and then retire the duplicate matrix.

Field capability design should stay compact:

- `field.read_assigned`
- `field.execute`
- `field.scope.manage`
- `field.sale.propose`
- `field.complete`
- `field.review`
- `field.price.override`

Role labels such as lead/helper are field responsibility/assignment attributes when possible, not a second authentication role system. Server/domain authorization must additionally enforce assignment membership; a capability alone never grants access to every Work Order.

## G. Migration / parity implications

Legacy field behavior is classified as follows:

- KEEP/REFACTOR: today/tomorrow jobs, assignment filtering, customer/contact/location details, en-route/arrival/start/pending/completed timestamps, QR, on-site asset registration, multiple interventions, evidence/measurements, second visits, receiver data, report sections and equipment history concepts.
- REPLACE: Legacy patch chain, UI-embedded permission matrix, patch-specific service compatibility logic, duplicated add-on definitions.
- RETIRE after references are proven: obsolete technician patch helpers and browser-only field models once canonical field persistence/UI reaches parity.
- DEFER: production migration, Firebase security-rule deployment, live inventory deduction, live invoice creation and customer report delivery until their governed phases and human approval boundaries are satisfied.

All data migration must be additive/idempotent first. No production migration or destructive cleanup is authorized by this checkpoint.

## H. Implementation file plan

### Phase 1 — canonical domain foundation

- add `lib/field-operations-domain.ts` for field entities only, reusing base IDs/audit types from `lib/domain.ts` and CRM Asset by reference;
- add `lib/field-operations.ts` for centralized transitions, start/submission gates, reconciliation and domain invariants;
- add field repository contracts without selecting browser storage as persistence;
- add focused acceptance tests for planned-vs-actual, multiple interventions, not-performed work and second-visit preservation.

### Phase 2 — security / assignment

- consolidate capability vocabulary into `lib/security.ts`;
- bind authenticated user -> staff identity -> current technician/van/team assignments;
- introduce assigned-work queries and server/domain deny tests;
- role-aware technician redirect to the field home surface.

### Phase 3+

Build technician home, visit shell, actual-scope discovery, service templates, sale lines, office review, history projections and offline outbox only after the domain/security boundary is stable.

## Exact-scope hard-gate redesign

**Old rule:** field start requires `selectedEquipment.length === bookedQuantity`.

**Canonical start rule:** field start requires an authorized/released Work Order, an authenticated assigned field principal, a valid Customer/Property reference, and enough information to begin safely. Exact equipment identity/count is not a start prerequisite.

**Canonical submission rule:** before a visit can enter Office Review, every actual intervention must reference an explicit VisitAsset; each VisitAsset must resolve to a canonical Asset or an allowed on-site registration workflow; planned work must be reconciled by performed interventions and/or explicit not-performed dispositions; billable added work requiring approval must have a valid approval; pending work and second-visit requirements must be explicit.

This preserves `planned != actual` without weakening completion integrity.

## Phase 0 review passes

### PASS 1 — Correctness
The design preserves booked intent and allows progressive actual scope, including multiple interventions per asset and explicit non-performed work.

### PASS 2 — Architecture
Existing CRM, Scheduling, Work Order, Catalog, Inventory, Billing and authentication authorities are reused. Browser field state is classified as compatibility/preview, not elevated into a second source of truth.

### PASS 3 — Integration / regression
No runtime behavior is changed by this document. Planned integration points are explicit and keep Scheduling ownership separate from Field ownership.

### PASS 4 — Production readiness
No production deployment, security-rule change, destructive migration, secret change or live external write is performed. Production migration remains a future governed step.
