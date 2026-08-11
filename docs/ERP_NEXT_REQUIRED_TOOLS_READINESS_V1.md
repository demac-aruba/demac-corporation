# ERP Next — Required Tools Readiness V1

## Objective
Replace the manual `Required Tools` Work Order check with evidence derived from a company Tool Asset Registry and an explicitly reviewed Tool Requirement Policy.

## Requirements

- **TOOLS-RDY-001** Company tools are tracked separately from consumable/material inventory.
- **TOOLS-RDY-002** Tool assets carry asset ID, name, class, custody location, status, optional QR/serial, optional calibration due date and verification state.
- **TOOLS-RDY-003** The system must not seed fake physical tool assets to make readiness appear healthy.
- **TOOLS-RDY-004** A tool must be verified and `available` to satisfy readiness.
- **TOOLS-RDY-005** A past calibration due date makes a tool unusable for readiness even if status remains available.
- **TOOLS-RDY-006** Maintenance, calibration-due, checked-out or lost assets cannot satisfy READY.
- **TOOLS-RDY-007** Changing asset class, location, status, calibration or identity evidence requires asset reverification.
- **TOOLS-RDY-008** Required tool classes are configured by Work Preset; the ERP does not invent requirements from the service name.
- **TOOLS-RDY-009** An unreviewed Tool Requirement Policy makes Required Tools AT RISK.
- **TOOLS-RDY-010** A reviewed policy may explicitly declare that no tracked company tool is required, producing Tools READY for that policy dimension.
- **TOOLS-RDY-011** Policy supports `Per assigned van` coverage for tools each working van must carry independently.
- **TOOLS-RDY-012** Policy supports `Shared across same job` coverage for tools that may be shared among vans working one linked Work Order at the same job.
- **TOOLS-RDY-013** Missing registered required coverage under a reviewed policy is BLOCKED.
- **TOOLS-RDY-014** Matching but unverified tool coverage is AT RISK.
- **TOOLS-RDY-015** Verified usable coverage satisfying the selected coverage mode is READY.
- **TOOLS-RDY-016** Every Work Order assignment is evaluated against the policy; support vans are not silently ignored.
- **TOOLS-RDY-017** Work Orders no longer expose a manual Required Tools override once the Tool Registry is authoritative.
- **TOOLS-RDY-018** Tool readiness participates in consolidated READY / AT RISK / BLOCKED and its risk signature.
- **TOOLS-RDY-019** Tool changes may invalidate a prior AT RISK release for future Field start but never rewrite historical starts/releases.
- **TOOLS-RDY-020** Production migration requires authenticated custody changes, QR/check-in/out, durable calibration history, condition history and audit events.

## Tool classes in V1

The configurable registry supports:
- Vacuum Pump
- Manifold / Gauge Set
- Micron Gauge
- Recovery Machine
- Drill / Driver
- Service Toolkit

These are available classes, not claims that every Work Preset requires them. Operations must explicitly review each Work Preset policy.

## Decision hierarchy

1. Policy not reviewed → **AT RISK**.
2. Reviewed, no tracked tools required → **READY**.
3. Reviewed + required class missing under selected coverage mode → **BLOCKED**.
4. Matching tool exists but verification incomplete → **AT RISK**.
5. Tool unavailable / maintenance / lost / calibration expired → **BLOCKED** when no other usable matching asset exists.
6. All required coverage verified and usable → **READY**.

## Current data mode
Browser-persistent Tool Asset Registry and Tool Requirement Policy. Production will move custody, calibration and verification into authenticated repository-backed asset/event records.
