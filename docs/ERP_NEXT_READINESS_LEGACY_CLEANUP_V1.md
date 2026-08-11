# ERP Next — Readiness Legacy Cleanup V1

## Objective
Remove the obsolete manual readiness API now that all eight Consolidated Job Readiness dimensions are source-owned.

## Requirements

- **RDY-CLEAN-001** Current Job Readiness must not export or consume a manual readiness-state contract.
- **RDY-CLEAN-002** Current Job Readiness must not read the legacy `job-readiness-checks.v1` browser key.
- **RDY-CLEAN-003** Current Job Readiness must not expose `checks` as an input to the readiness calculation.
- **RDY-CLEAN-004** The eight readiness dimensions remain sourced from Scheduling, Work Order assignment, HVAC scope, Materials/Inventory, Workforce, Tool Assets, Site Access and Commercial Clearance.
- **RDY-CLEAN-005** AT RISK dispatch releases remain separate authority records and are not removed by this cleanup.
- **RDY-CLEAN-006** Existing old browser-local manual-readiness data is not actively deleted; it simply ceases to be authoritative or readable by the current readiness engine.
- **RDY-CLEAN-007** Historical Field start authority and dispatch release evidence remain unchanged.
- **RDY-CLEAN-008** CI must catch any forgotten source file that still imports the removed manual readiness API.

## Authority model

Owning modules store facts. Consolidated Job Readiness calculates. Operations may authorize an AT RISK start. Field records the actual start authority. No manual dimension override exists in the consolidated layer.
