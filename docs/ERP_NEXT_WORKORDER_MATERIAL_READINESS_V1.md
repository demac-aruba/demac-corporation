# ERP Next — Work Order Material Requirements & Readiness V1

## Objective

Give the material dimension of Job Readiness a deterministic meaning. A Work Order must either explicitly declare its tracked material requirements or explicitly confirm that no additional tracked materials are required; ERP Next must not invent parts or silently treat an unchecked job as ready.

## Requirements

- WO-MAT-001 — Material readiness belongs to a specific Work Order.
- WO-MAT-002 — No material plan means `NOT CHECKED / AT RISK`, not READY and not BLOCKED.
- WO-MAT-003 — Office can explicitly confirm `No additional tracked materials required`; that makes the material dimension READY by policy.
- WO-MAT-004 — Requirements mode stores item, unit, quantity and assigned working van/location for each material line.
- WO-MAT-005 — A material line may only be assigned to a van actually assigned to that Work Order (primary or linked support van).
- WO-MAT-006 — Material READY requires the required quantity to be physically on the assigned van after earlier Work Order reservations.
- WO-MAT-007 — Earlier unsubmitted Work Orders reserve their explicit material quantities before later Work Orders on the same van/item.
- WO-MAT-008 — Submitted Work Orders stop reserving planning quantity because their actual Field consumption is represented by inventory ledger movements.
- WO-MAT-009 — Issued/in-transit inbound stock may reduce a shortage from BLOCKED to AT RISK, but cannot make the job READY until receipt posts the destination inventory movement.
- WO-MAT-010 — Requested/approved but not issued inbound transfers may also cover a planning shortage only as AT RISK.
- WO-MAT-011 — A requirement not covered by on-hand plus inbound commitments is BLOCKED.
- WO-MAT-012 — Requirements mode with zero lines is AT RISK; office must either add lines or explicitly mark no additional tracked materials required.
- WO-MAT-013 — Material plan is locked after Field submission in the current preview workflow.
- WO-MAT-014 — Material planning does not move stock, create transfers or create purchase requirements by itself.
- WO-MAT-015 — Inventory, Transfer Ledger and Replenishment remain the authoritative workflows for correcting a material shortage.
- WO-MAT-016 — The material-readiness projection must preserve item/location evidence used to reach READY / AT RISK / BLOCKED.

## Readiness hierarchy

### Not checked

No plan exists:

`AT RISK — material requirements have not been reviewed.`

### Explicit no additional tracked material

Office explicitly confirms:

`READY — no additional tracked material required.`

### Explicit requirements

For each line:

`Available for Job = Current On-Hand − Earlier Unsubmitted Work Order Reservations`

Then:

1. `Available >= Required` → READY
2. `Available + Issued Inbound >= Required` → AT RISK (in transit)
3. `Available + Issued Inbound + Requested/Approved Inbound >= Required` → AT RISK (planned only)
4. otherwise → BLOCKED

The Work Order material dimension takes the most severe line status.

## Why reservations matter

If Van 1 physically has 10 switches and an earlier Work Order explicitly requires 6, a later Work Order requiring 5 must not see all 10 as available. Its planning availability is 4 until the earlier job is completed/consumed or its plan changes through a governed action.

## Current preview item scope

Material planning currently uses the tracked browser inventory items already connected to the location ledger:

- 220V Switch
- Refrigerant
- A/C Bracket
- Armaflex / Insulation

The production Item Master will expand variants, units of measure, serialized components and equipment.

## Production migration

Firebase production implementation should persist Work Order material plans and reservation evidence with authenticated actors and durable timestamps. High-concurrency readiness should calculate/reserve stock transactionally or through an authoritative reservation ledger so two dispatchers cannot reserve the same available quantity concurrently.