# ERP Next — Dispatch Release Audit V1

## Objective
Preserve a trustworthy chronological distinction between an Operations decision to release an AT RISK Work Order and the technician's later physical Field start.

## Requirements

- **AUD-DISP-001** Every AT RISK dispatch release must remain a historical event after it is created.
- **AUD-DISP-002** Historical release evidence must survive later readiness changes even when the release is no longer valid for a new Field start.
- **AUD-DISP-003** Release evidence must include Work Order ID, authorization time, authorizer and release reason.
- **AUD-DISP-004** Release evidence must preserve the risk snapshot/signature accepted at authorization time.
- **AUD-DISP-005** Audit must show the Operations release and technician Field start as separate chronological events.
- **AUD-DISP-006** A Field start must never be retroactively presented as the same event as an Operations release.
- **AUD-DISP-007** Dispatch release is classified as a sensitive governance event.
- **AUD-DISP-008** Field start remains a Field event with its own timestamp and actor context.
- **AUD-DISP-009** Audit module filtering must surface Operations as an independent source module when release evidence exists.
- **AUD-DISP-010** Customer 360 must project customer-linked dispatch release events through the Work Order customer identity.
- **AUD-DISP-011** Customer Timeline must show authorization reason and authorizer without implying that work had already started.
- **AUD-DISP-012** Customer Timeline must continue to show the later technician start separately.
- **AUD-DISP-013** Invalidated or superseded releases remain historical evidence; invalidation affects start authority, not history.
- **AUD-DISP-014** Preview actor labels remain browser-context evidence only; production events require authenticated server-side identity and durable timestamps.

## Event sequence

`Job Readiness = AT RISK → Operations Release → Technician Start → Field Evidence → Field Submit → Office Review`

The release gives authority to begin under the accepted risk snapshot. It does not itself mean that the technician started the job.

## Current data mode
Browser-persistent preview events derived from `dispatch-at-risk-releases.v1` and Field Execution records. Production migration requires append-only authenticated audit events backed by the repository/database layer.
