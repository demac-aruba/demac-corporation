# Legacy Feature Parity

This is a migration control, not a mandate to copy Legacy design or implementation. A row
records evidence and uncertainty; it does not prove migration merely because a screen or
similarly named file exists.

## Status vocabulary

- `VERIFIED`: acceptance evidence proves the canonical target behavior.
- `PARTIAL`: repository evidence covers only part of the capability.
- `MISSING`: the target capability is absent by confirmed inspection.
- `RETIRED`: an approved decision intentionally removed or replaced the capability.
- `UNKNOWN`: evidence is insufficient or contradictory.

## Parity register

| Feature | Legacy evidence/path | ERP Next status | Canonical target authority | Status | Owner/workstream | Evidence/review date |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication and role access | `src` authentication/navigation flows | ERP Next session and access work exists; full parity not established here | Firebase Auth plus server-side role enforcement | UNKNOWN | Security / Identity | Foundation review 2026-08-23; acceptance evidence required |
| Dashboard / command center | Root admin dashboard under `src` | ERP Next command-center documents/components exist | Governed operational read models | PARTIAL | Management Operations | Repository paths inspected 2026-08-23; end-to-end parity unverified |
| Scheduling and dispatch | Legacy agenda under `src`; booking functions under `functions` | ERP Next scheduling implementation and acceptance scripts exist | Booking Authority at commit time | PARTIAL | Scheduling / Dispatch | `docs/ERP_NEXT_SCHEDULING_*`; reviewed 2026-08-23 |
| Projects and project costing | No governed canonical Projects lifecycle established by the current Legacy evidence review | ERP Next includes an integrated fast-validation Projects module with canonical CRM lookup and post-commit Scheduling linkage, while Project records and costing remain browser-persisted preview data | Future canonical Project authority plus Booking Authority lifecycle events and governed costing sources | PARTIAL | Projects / Operations | `apps/erp-next/scripts/projects-preview-acceptance.ts`; reviewed 2026-09-02; residual risk tracked in AD-014 |
| CRM: Customer / Property / Contact | Legacy customer/property/contact flows under `src` | ERP Next CRM and relationship work exists | Canonical Customer, Property, Contact, and `contactPropertyAssignments` | PARTIAL | CRM / Identity | `docs/ERP_NEXT_CRM_*`; reviewed 2026-08-23 |
| Technician agenda | Legacy technician agenda/work views under `src` | ERP Next scheduling/technician surfaces exist; behavioral parity not proven | Booking Authority read model plus authenticated technician access | UNKNOWN | Field Operations | Repository paths inspected 2026-08-23; scenario evidence required |
| Work-order lifecycle | Legacy technician/work-order flows under `src` | ERP Next work-order and field-readiness documents/components exist | Work-order lifecycle authority | PARTIAL | Field Operations / Work Orders | `docs/ERP_NEXT_WORK_ORDERS_FIELD_V1.md`; reviewed 2026-08-23 |
| Equipment / assets | Legacy equipment flows under `src` | ERP Next field-asset and CRM asset work exists | Canonical Property Asset identity and work-order linkage (`Site`/`siteId` is technical/compatibility terminology for Property) | PARTIAL | Field Operations / CRM | `docs/ERP_NEXT_FIELD_ASSETS_V1.md`; reviewed 2026-08-23 |
| Measurements | Legacy technician measurement flows under `src` | Target behavior not proven by this foundation review | Field Execution / Work Order evidence authority | UNKNOWN | Field Operations | Legacy path known; target acceptance evidence required 2026-08-23 |
| Photos / evidence | Legacy technician image/evidence flows under `src` | ERP Next evidence behavior not proven end-to-end | Field Execution evidence plus governed Storage access | UNKNOWN | Field Operations / Security | Legacy path known; persistence/security evidence required 2026-08-23 |
| Intervention report | Legacy technician intervention/report flows under `src` | Target parity not proven by this foundation review | Work Order / Field Execution report authority | UNKNOWN | Field Operations | Acceptance scenarios required 2026-08-23 |
| AI Professional Report | Legacy report generation flows and backend functions | ERP Next replacement/parity not proven here | Governed report service using authoritative work-order evidence | UNKNOWN | Reports / AI | Repository implementation requires dedicated review 2026-08-23 |
| Office Review | Legacy office report-review flow under `src` | ERP Next readiness/review work exists; parity not proven | Office Review workflow authority | UNKNOWN | Office / Field Operations | Dedicated lifecycle evidence required 2026-08-23 |
| Customer-facing Service Report | Legacy customer-report flow under `src` and report functions | ERP Next delivery/parity not proven here | Approved report artifact and delivery authority | UNKNOWN | Reports / Communications | Dedicated output/delivery evidence required 2026-08-23 |
| Inventory | Legacy inventory flows under `src` | ERP Next catalog, stock, tool-asset, transfer, movement-audit, and readiness work exists; full parity is not established | `services` catalog; `commercialProductStock` Product balances; `warehouseInventory` material/consumable balances; `toolCatalog`; `vanToolAssets`; transactional operations through Firebase `inventoryAuthority` | PARTIAL | Inventory / Warehouse | PR #391 approved architecture and `docs/ERP_NEXT_INVENTORY_*`; foundation correction reviewed 2026-08-23 |
| Finance and accounting handoff | Legacy invoice/payment flows under `src` | ERP operational finance previews/workflows exist; QBO adapter is future | DEMAC ERP operational finance; QuickBooks Online accounting authority | PARTIAL | Finance / Integrations | `docs/ERP_NEXT_PURCHASING_FINANCE_V1.md`; reviewed 2026-08-23 |
| Transactional communications | Legacy/backend WhatsApp workflows | Current functions use canonical provider configuration with `wacli` default | Communication authority and configured transactional provider | PARTIAL | Communications | `functions/whatsappTransactionalService.js` evidence reviewed 2026-08-23; no end-to-end claim |
| Settings / company rules | Legacy settings plus governed Firestore settings | ERP Next settings surfaces exist; full parity not established | Approved company settings and protected rules | UNKNOWN | System Governance | `docs/DEMAC-company-rules-v1.md`; acceptance evidence required |

## Evidence required to change status

Document the exact Legacy behavior, approved desired behavior, data mapping, permission
model, edge cases, acceptance tests, reconciliation result, evidence date, and accountable
owner. Record intentional differences explicitly. `VERIFIED` requires executed acceptance
evidence against the canonical authority; document names, component names, screenshots, or
visual similarity alone are insufficient.
