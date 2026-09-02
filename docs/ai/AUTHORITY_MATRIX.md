# Authority Matrix

Authority means the component allowed to decide and persist truth. UI state, AI output,
provider callbacks, and cached projections are never authority by themselves.

| Domain | Authoritative source/service | Allowed callers | Required controls |
| --- | --- | --- | --- |
| Identity and roles | Firebase Auth plus governed user/role records | Authenticated clients; admin functions | Token verification, server-side role checks, least privilege, audit |
| Customer identity | Canonical `Customer` record through CRM/domain services | Authorized office/operations flows | Stable ID, duplicate detection, merge/alias audit |
| Property identity | Canonical `Property` record linked to its Customer | Authorized CRM and scheduling flows | Stable ID, preserved history, no embedded duplicate identity |
| Contact identity | Canonical `Contact` record | Authorized CRM and communication flows | Stable ID, deduplication, consent and audit |
| Contact-to-Property responsibility | `contactPropertyAssignments` | Authorized CRM/communication flows | Explicit role/responsibility and effective configuration |
| Scheduling and capacity | Booking Authority and approved canonical company/calendar/capacity settings | Office tools, ERP Next, allowlisted AI tool | Commit-time revalidation, conflict prevention, idempotency |
| Work-order lifecycle | Work-order application service | Assigned/authorized roles | Valid transitions, evidence rules, actor/time audit |
| Physical field execution | Field Operations Authority over `workVisits`, Visit Assets, Work Interventions and governed child records | Current assigned field roles through authenticated commands | Complete linear visit chain, transaction-scoped assignment, optimistic version, idempotency and append-only audit |
| Professional Report readiness | Read-only projection derived by Field Operations Authority from canonical field truth | Assigned field readers and authorized office readers | No independent persistence or editorial state; fail closed on identity/reconciliation/report contradictions |
| Field commercial sale lines | Field Operations Authority over `fieldSaleLines`, using canonical `services` Product identity and Pricing Authority snapshots | Current accountable field roles through authenticated commands; customer decision captured as immutable `FieldApproval` evidence | Catalog identity/price are server-owned, exact retry and optimistic version are mandatory, non-catalog remains unpriced for Office Review, and no Inventory/Billing effect is implied |
| Customer and Equipment Field histories | Read-only projections from canonical Work Visits, Work Interventions, Field Findings and Field Sale Lines | Assigned Field readers through the already-authorized Work Order job context | Customer identity must match the assigned job; every child resolves to its canonical visit/intervention/asset; no independently writable history store |
| Field equipment QR identification | Field Operations Authority validating the presented QR against the canonical `equipmentSystems` record inside the assigned active Work Visit transaction | Current assigned roles with server-projected `asset.add`; ERP Next may only select from the assignment-scoped equipment projection | QR is optional and identification-only; exact Customer/Property/Asset identity, active equipment, current visit and canonical QR must match; QR never creates or reassigns an Asset |
| Field-to-Inventory handoff candidate | Immutable `fieldInventoryHandoffs` emitted transactionally by Field Operations only when Office Review approves a frozen revision containing sold catalog Products | Authorized Office Review approval boundary; later consumption belongs exclusively to Inventory Authority | Exact review/revision/Work Order/Customer/Property/Visit/Sale Line identity, deterministic replay, explicit source-location or quantity blockers, and zero stock/movement effects until Inventory Authority acts |
| Field-to-Billing candidate | Immutable `fieldBillingCandidates` emitted transactionally by Field Operations when Office Review approves frozen completed interventions or Field Sale Lines | Authorized Office Review approval boundary; later pricing resolution, invoicing and accounting belong to their existing authorities | Exact review/revision/Work Order/Customer/Property/Visit/source-line identity, deterministic replay, explicit missing-price/mixed-currency blockers, and zero invoice/QBO effects |
| Field offline transport | User-scoped browser IndexedDB cache, version-linked drafts and exact-payload outbox; never an authoritative source | Authenticated ERP Next Field client only | No tokens stored; cached reads are visibly stale/read-only; queued writes retain the original request ID, never render as committed, and authoritative conflicts block instead of overwrite |
| Office Review lifecycle | Field Operations Authority over `fieldOfficeReviews` and immutable `fieldOfficeReviewRevisions` | Accountable lead may submit; authorized Office/Operations roles may review | Server-derived readiness, one review per Work Order, immutable revisions, exact retry, approval lock, atomic audit and no implicit customer delivery |
| Pricing and service duration | Approved company rule/settings hierarchy | Read consumers; authorized settings editor | Rule version, effective date, no AI invention |
| Employee master identity | `staffProfiles` | Authorized workforce/admin flows | Firebase users remain authentication identities, never a duplicate employee master |
| Regular Van crew and Van vehicle profile | `vans` | Authorized operations/scheduling flows | Van owns responsible driver, regular helper, optional third helper; employee `primaryVanId` is compatibility/read metadata only; no simultaneous regular assignment |
| Van maintenance / repair history | `vanMaintenanceLogs` plus current service milestone projection on `vans` | Authorized operations/scheduling flows | Additive history, stable Van identity, no duplicate maintenance source |
| Dated staff unavailability | `staffAbsences` | Authorized workforce/operations flows | Vacation, sickness, and one-off dated ranges only |
| Van-assigned technical recurring schedule | `vanHalfDaySchedules` for the Van/team plus company calendar | Authorized operations/scheduling flows | Assigned technical staff inherit the Van/team rule; exact worked window; employee schedule cannot override active Van authority |
| Individual recurring employee schedule | `employeePayrollSettings` | Authorized workforce/payroll flows | Office/non-technical employees and technical employees with no canonical Van assignment only; payroll permission boundary, effective versions, employee linkage; Van assignment takes precedence for technical staff |
| Explicit daily attendance/payroll exception | `employeeTimesheets`, interpreted against the canonical resolved employee schedule | Authorized payroll-sensitive Employees/Payroll flows | Deterministic employee/date ID, schedule-derived overtime, classified partial missing-time segments, schedule snapshot, actor/time audit, payroll-only Firestore access |
| Temporary crew override | `dailyVanAssignments` | Authorized operations/scheduling flows | Date-scoped driver/helper/optional third helper; no simultaneous dated assignment; does not rewrite regular crew ownership |
| Commercial Product / Service catalog | `services` | Authorized catalog and operational flows | One canonical commercial catalog; no duplicate Product or Service authority |
| Sellable Product stock | `commercialProductStock`, including location balances | Warehouse/authorized work-order flows through Firebase `inventoryAuthority` for transactional operations | Atomic validated balance updates, stable Product/location identity, reconciliation and audit |
| Material / consumable stock | `warehouseInventory`, including location balances | Warehouse/authorized work-order flows through Firebase `inventoryAuthority` for transactional operations | Atomic validated balance updates, stable item/location identity, reconciliation and audit |
| Tool catalog | `toolCatalog` | Authorized catalog and warehouse flows | One canonical Tool catalog; no location-specific duplicate catalogs |
| Physical Tool assets | `vanToolAssets`, supporting Warehouse, Office, and Van locations | Authorized warehouse/custody flows through governed operations | Stable asset/location identity, custody validation, reconciliation and audit |
| Inventory transfer workflow / custody state | `inventoryTransfers` | Authorized warehouse/custody flows | Workflow state only; never treated as canonical stock balance or another ledger |
| Inventory physical-movement audit | Immutable `inventoryMovements` | Firebase `inventoryAuthority` and authorized audit/reconciliation readers | Append-only audit evidence; never treated as canonical balance authority |
| Operational finance records | DEMAC ERP governed operational workflows | Finance roles and verified integrations | Operational traceability; no competing accounting balances or books |
| Accounting books | QuickBooks Online, the planned/official accounting system of record, through a governed integration | Authorized finance integration | No parallel accounting engine, duplicate official numbering authority, or competing reconstruction of QBO history |
| Transactional WhatsApp | Communication authority using canonical provider configuration; current default is `wacli` | Governed producers and the configured transport adapter | One queue/sender/contact model/notification authority; another provider such as Meta requires explicit canonical configuration |
| AI actions | Allowlists and domain tools | Approved agent runtimes | Risk tier, explicit approval where required, bounded inputs, audit |
| External provider state | Provider adapter, translated into canonical records | Verified webhook/poll workers | Signature/auth verification, replay protection, raw-event trace ID |

## Conflict rule

When two sources disagree, do not use recency alone. Prefer the designated authority,
record the discrepancy, and require reconciliation before a high-impact write.

## Van crew boundary

- A regular field assignment is written on the canonical `vans` document, not independently
  on an employee profile. Employee, Technician and Scheduling screens may project that relationship.
- `responsibleStaffId`, `regularHelperId`, and optional `additionalHelperId` are mutually exclusive
  positions within one Van. `technicianIds` is a compatibility/derived projection of those slots.
- `dailyVanAssignments` may replace those positions for one date. Once that date is over or the
  override is removed, regular Van crew resolves again without rewriting the Van profile.
- A person must not resolve onto two Vans on the same date. Regular and dated writes validate this
  before persistence.
- New Van profiles begin out of service and therefore do not silently expand booking capacity.

## Employee recurring schedule boundary

- A technical employee who is part of a canonical regular Van crew resolves recurring schedule
  authority from that Van/team. `vanHalfDaySchedules` controls the Van partial-day window and an
  employee-level payroll schedule must not override it.
- A technical employee who is not assigned to any canonical Van may use the existing
  `employeePayrollSettings` authority for an effective individual schedule, using the same
  versioning, worked-hour and payroll controls as other individual employee schedules.
- Assigning that employee to a Van immediately makes the Van/team schedule authoritative for active
  resolution without deleting the employee's versioned individual schedule history. Removing the
  employee from all Vans makes the applicable individual schedule active again.
- The supported Employee Profile write flow revalidates canonical Van membership before saving an
  individual technical schedule. Domain writes also require explicit confirmation that no Van owns
  that schedule; omission defaults to rejection.
- Sunday remains a protected company closure regardless of individual or Van schedule authority.

## Workforce attendance boundary

- `employeeTimesheets` is not a second recurring schedule authority. Explicit daily records
  are interpreted against the employee schedule resolved from the existing schedule authorities.
- Normal scheduled attendance remains synthesized and is not materialized as a daily record.
- `staffAbsences` remains the dated full-day/operational unavailability authority. A partial
  late arrival, early departure, or extended break is stored on the explicit daily timesheet
  so separate payroll treatment can be preserved without inventing another absence collection.
- Schedule snapshot fields on a timesheet are audit evidence for the calculation used when
  that explicit record was edited; they do not supersede canonical schedule history.

## Inventory boundary

Warehouse, Office, and Vans are locations, not separate Product, Consumable, Material, or
Tool catalogs. Canonical balances remain on `commercialProductStock`, `warehouseInventory`,
and the applicable physical Tool asset records. Firebase `inventoryAuthority` is the
authenticated transactional operation boundary that validates and applies inventory
operations; it is not another catalog, stock ledger, or balance authority. No agent may
introduce a second Product, Consumable, Material, or Tool authority without an explicitly
approved architecture decision and human approval for the new source-of-truth boundary.

## Identity and communication history constraints

- Historical recipient snapshots record what was sent to whom at that time. Later Contact
  or `contactPropertyAssignments` changes must not rewrite those snapshots.
- Legacy embedded property contacts are compatibility fallback only. They must not become
  a second canonical Customer, Property, Contact, or communication-responsibility model.
- Browser/localStorage and `browser-*` operational records are preview, compatibility, and
  non-canonical unless a specific approved architecture document explicitly designates a
  particular record as canonical.
- Booking Authority is the commit-time scheduling authority. Suggestions, rendered agenda
  state, caches, browser models, and AI output may not commit around it.
- No agent may introduce another WhatsApp queue, sender, contact model, or notification
  authority without an approved architecture decision and explicit human approval for the
  new source-of-truth boundary.

## Accounting boundary

DEMAC ERP owns operational workflows. QuickBooks Online is the planned/official system of
record for accounting workflows. ERP may reference, synchronize, present, and initiate
governed workflows through the QuickBooks integration, but it must not become a competing
accounting engine.

Agents must not create inside DEMAC ERP:

- a parallel accounting engine or second accounting ledger/book of record;
- duplicate official invoice-numbering authority;
- duplicate official estimate-numbering authority;
- recreated historical QuickBooks accounting transactions as a competing source of truth; or
- independent accounting balances that compete with QuickBooks.
