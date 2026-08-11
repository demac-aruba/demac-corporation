# ERP Next — Command Center Readiness Projection V1

## Objective

Make the executive Command Center consume the same consolidated Work Order readiness decision used by Operations instead of a simplified/stale readiness field.

## Requirements

- CMD-RDY-001 — Dashboard dispatch readiness is derived from the consolidated Job Readiness engine.
- CMD-RDY-002 — Only open Work Orders (not Field-submitted) are counted in active dispatch readiness.
- CMD-RDY-003 — Dashboard exposes count of open READY, AT RISK and BLOCKED Work Orders.
- CMD-RDY-004 — A BLOCKED Work Order produces a Critical management-attention item.
- CMD-RDY-005 — An AT RISK Work Order produces a Warning management-attention item.
- CMD-RDY-006 — A READY Work Order may produce an Opportunity/positive action signal.
- CMD-RDY-007 — Attention detail uses the actual first blocker/risk reason from the consolidated evidence engine.
- CMD-RDY-008 — Exact HVAC Scope remains visible as a supporting KPI but is no longer treated as the complete dispatch-readiness decision.
- CMD-RDY-009 — Field-submitted Work Orders are excluded from pre-dispatch READY / AT RISK / BLOCKED counts.
- CMD-RDY-010 — Inventory transfer movements without Work Order identity must not inflate the count of jobs with field-consumption postings.
- CMD-RDY-011 — Switch/refrigerant consumption KPIs use `job_consumption` movements only, not transfer custody movements.
- CMD-RDY-012 — Command Center remains a projection over authoritative module records and does not write readiness status back into Work Orders.

## Readiness source

Command Center
→ open Work Orders
→ Consolidated Job Readiness
→ Appointment confirmation
→ assignment integrity
→ exact HVAC scope
→ materials / reservations / transfers
→ crew & skill check
→ tools check
→ site access check
→ commercial clearance check

The dashboard therefore explains the same operational truth as the Work Orders workspace.

## Inventory projection correction

With Transfer Ledger active, inventory movements can be job consumption or custody transfers. Command Center job-consumption metrics now filter movement type explicitly so transfer-in / transfer-out events cannot be counted as field jobs or material usage.

## Production migration

The production dashboard should consume repository-backed readiness projections with calculation timestamp, source freshness and evidence links. It should remain read/projection oriented; operational changes happen in the owning module.