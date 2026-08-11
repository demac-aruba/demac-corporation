# ERP Next — Dispatch Readiness Board V1

## Objective
Bring source-owned Job Readiness into Scheduling so Operations can see which Work Orders may dispatch across all four vans without opening each order individually.

## Requirements

- **DISP-BOARD-001** Scheduling remains authoritative for appointment date, time and van assignment.
- **DISP-BOARD-002** The Dispatch Readiness Board is a read-only projection and must not mutate Scheduling or Work Order facts.
- **DISP-BOARD-003** Board groups Work Order assignments into VAN-1 through VAN-4 lanes.
- **DISP-BOARD-004** A linked support assignment appears in the support van lane while preserving the same Work Order identity.
- **DISP-BOARD-005** Support assignments are labeled separately from primary assignments and never become a second customer communication owner.
- **DISP-BOARD-006** Before physical Field start, board exposes source-owned READY / AT RISK / BLOCKED.
- **DISP-BOARD-007** AT RISK without a valid current Operations release is counted as `AT RISK · HOLD`.
- **DISP-BOARD-008** AT RISK with a valid risk-signature-bound Operations release is counted as `AT RISK · RELEASED`.
- **DISP-BOARD-009** BLOCKED remains non-overridable by Field.
- **DISP-BOARD-010** READY indicates all eight current readiness dimensions are resolved.
- **DISP-BOARD-011** Temporary appointment holds are visible for capacity context but excluded from Work Order readiness because they are not confirmed Work Orders.
- **DISP-BOARD-012** Once physical Field start occurs, that Work Order stops counting in pre-dispatch READY / AT RISK / BLOCKED metrics.
- **DISP-BOARD-013** In-progress Field work is counted separately as `IN FIELD`.
- **DISP-BOARD-014** Submitted Field work is counted separately as `SUBMITTED`.
- **DISP-BOARD-015** Started jobs continue to show current source readiness only as informational context; original start authority remains the historical execution truth.
- **DISP-BOARD-016** Started-under-AT-RISK jobs show their exact historical dispatch release ID when available.
- **DISP-BOARD-017** Board provides direct navigation to Work Order readiness and Field execution.
- **DISP-BOARD-018** Date selection includes the current Aruba date and dates represented in browser Work Orders/temporary holds.
- **DISP-BOARD-019** The board must not infer missing readiness evidence or create synthetic green states.
- **DISP-BOARD-020** Production migration should consume authenticated repository-backed Scheduling, readiness and Field-start events while preserving the same authority boundaries.

## Readiness lifecycle on the board

`Not started → READY / AT RISK HOLD / AT RISK RELEASED / BLOCKED → Field Started → In Field → Submitted`

Current readiness may continue to change after Field start, but it no longer governs or rewrites the historical fact that the job already started under a specific authority.

## Current data mode
Browser-persistent Scheduling, Work Order, source-owned readiness, dispatch release and Field Execution records.
