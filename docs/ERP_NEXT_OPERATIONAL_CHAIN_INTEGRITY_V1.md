# ERP Next — Operational Chain Integrity Repair V1

## Objective

Restore one continuous operational truth from Scheduling-created Work Order through exact HVAC scope, technician execution and Office Review after a route audit found that the live Field page had regressed to a static demo and Work Orders had lost its Office Review layout.

## Requirements

- CHAIN-001 — The primary Field route must consume persistent Work Orders created from Scheduling; it may not use a hard-coded demo Work Order as operational truth.
- CHAIN-002 — Customer ID, Site ID, customer-facing scope, technician-only instructions and van assignments flow from Work Order into Field without re-entry.
- CHAIN-003 — Exact HVAC Work Order scope is required before Field execution can be submitted.
- CHAIN-004 — Field equipment records are the exact registered/planned scope records, not all equipment inferred from the property.
- CHAIN-005 — Per-equipment evidence, refrigerant state, measurements, technical notes and completion persist in the same Field Execution record.
- CHAIN-006 — Technician add-ons and voice/summary remain part of the same Field Execution record.
- CHAIN-007 — Voice duration over 120 seconds blocks field submission.
- CHAIN-008 — Field submission creates or updates one Office Review for the Work Order; it does not create duplicate reviews.
- CHAIN-009 — Office Review shows original technician summary and professionalized customer summary separately.
- CHAIN-010 — Office can Approve or Return for Correction; customer delivery never occurs from the technician submit action.
- CHAIN-011 — A Returned review can be reopened by the technician on the same Work Order.
- CHAIN-012 — Corrected resubmission returns the same Office Review ID to `pending` rather than creating another review.
- CHAIN-013 — Reviewer note survives the correction/resubmission cycle.
- CHAIN-014 — Pending or Approved Office Review locks field editing/submission in the preview workflow.
- CHAIN-015 — An Approved report cannot be silently reopened by Field; a future governed report-revision workflow is required.
- CHAIN-016 — Work Orders route must physically mount the Office Review queue in addition to the Scheduling → Work Order handoff.

## Repaired route chain

Scheduling
→ Appointment
→ Work Order
→ Exact HVAC Asset Scope
→ Field Execution
→ Office Review
→ Approved Report
→ Customer Delivery Queue
→ Billing / Inventory / Customer Timeline projections

## Important route decision

`apps/erp-next/app/(erp)/field/page.tsx` now renders the persistent `BrowserFieldExecution` flow.

The older static `FieldExecution` component remains in source temporarily as a design/reference artifact, but it is no longer the operational Field page and must not be treated as a second source of field truth.

## Return-for-correction behavior

Office sets Review to `returned`
→ Field shows reviewer note / correction state
→ technician reopens same Field Execution
→ technician edits evidence/summary as needed
→ technician resubmits
→ same Review ID becomes `pending`
→ office reviews again

No duplicate customer report, Work Order or Office Review is created.

## Production migration

The browser records remain preview persistence. Firebase production implementation should preserve the same identity chain and use authenticated actor IDs plus atomic/revision-safe transitions for Field submission and Office Review decisions.