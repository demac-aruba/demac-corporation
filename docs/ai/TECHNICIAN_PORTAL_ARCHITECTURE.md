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
