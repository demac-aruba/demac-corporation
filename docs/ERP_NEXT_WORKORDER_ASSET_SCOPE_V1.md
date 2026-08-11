# ERP Next — Exact Work Order HVAC Asset Scope V1

## Objective

Ensure a Work Order identifies the exact HVAC equipment being serviced instead of inferring equipment from property + quantity.

Example: if a property has seven registered air conditioners and today's service is for two, the Work Order must contain exactly two selected HVAC asset identities and the technician must see those two only.

## Requirements

- WO-SCOPE-001 — Work Order equipment scope is explicit and durable.
- WO-SCOPE-002 — Registered Customer 360 HVAC assets are the preferred scope source.
- WO-SCOPE-003 — Scope is restricted to the selected Work Order customer/property context.
- WO-SCOPE-004 — Exact scope count must equal the Work Order expected quantity before it is considered complete.
- WO-SCOPE-005 — Scope retains Asset ID plus operational display snapshot (name/type/capacity/serial where available).
- WO-SCOPE-006 — Field execution is pre-populated from the saved exact Work Order scope.
- WO-SCOPE-007 — Existing unsubmitted field execution is re-scoped when office changes the Work Order scope.
- WO-SCOPE-008 — Scope cannot be changed after technician submission to Office Review.
- WO-SCOPE-009 — Field App exposes a pre-flight scope status before execution.
- WO-SCOPE-010 — A controlled Temporary / Planned Units mode exists for legitimate installation/new-equipment work where durable assets do not yet exist in CRM.
- WO-SCOPE-011 — Temporary units are explicit Work Order placeholders, not fake registered CRM assets.
- WO-SCOPE-012 — Future Firebase persistence will preserve canonical Asset IDs rather than relying on copied equipment names.

## Browser preview persistence

Scope records use:

`demac.erp-next.operations.work-order-scope.v1`

The scope record contains:

- Work Order ID
- Customer ID / Site ID when available
- expected quantity
- exact scope items
- registered vs temporary mode
- completion status
- updated timestamp

## Field handoff

Work Order
→ exact Asset scope
→ Field Execution equipment records
→ evidence/measurements/add-ons
→ Office Review

The Field Execution record is updated from the scope so the technician does not re-select or retype the equipment list.

## Production migration

Recommended production representation:

- Work Order remains the parent operational record.
- Exact Asset IDs can be stored directly for simple jobs or through a `work_order_assets` / scoped assignment structure when per-asset metadata grows.
- Asset display snapshots may remain for report/history readability, but `assetId` is authoritative.
- Installation placeholders become real CRM Assets during/after commissioning and handover.
