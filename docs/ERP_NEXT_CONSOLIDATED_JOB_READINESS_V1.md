# ERP Next — Consolidated Job Readiness V1

## Objective

Provide one explainable pre-dispatch decision per Work Order by combining derived operational facts with explicit office checks. `READY` is a calculated conclusion, never a manually selected overall status.

## Requirements

- JOB-RDY-001 — Overall Work Order readiness is one of `READY`, `AT RISK`, or `BLOCKED`.
- JOB-RDY-002 — Overall READY cannot be selected directly by a user; it is derived from readiness dimensions.
- JOB-RDY-003 — Any BLOCKED dimension makes the whole Work Order BLOCKED.
- JOB-RDY-004 — If no dimension is BLOCKED but at least one is AT RISK, the Work Order is AT RISK.
- JOB-RDY-005 — Only when every dimension is READY can the Work Order be READY.
- JOB-RDY-006 — Customer Confirmation is derived from the source Appointment status.
- JOB-RDY-007 — Van Assignment is derived from Work Order assignments and requires exactly one customer communication owner.
- JOB-RDY-008 — Exact HVAC Scope is derived from the Work Order asset-scope record and is a hard blocker when incomplete.
- JOB-RDY-009 — Materials uses the Work Order Material Readiness engine, including reservations and inbound-transfer state.
- JOB-RDY-010 — Crew & Required Skill is an explicit office check until a dedicated workforce/skill subsystem provides authoritative data.
- JOB-RDY-011 — Required Tools is an explicit office check until Tool Custody can derive it automatically.
- JOB-RDY-012 — Site Access is an explicit office check until access/confirmation data becomes a dedicated structured source.
- JOB-RDY-013 — Commercial Clearance is an explicit office check until deposits/PO/credit rules are linked to Finance/QBO.
- JOB-RDY-014 — `NOT CHECKED` manual dimensions are AT RISK, never READY.
- JOB-RDY-015 — `NOT REQUIRED` may only be used for dimensions where not-required is a legitimate business outcome; Crew & Required Skill cannot be not-required.
- JOB-RDY-016 — A manual dimension explicitly marked BLOCKED becomes a hard blocker.
- JOB-RDY-017 — Every dimension exposes its reason and source/evidence label to the operator.
- JOB-RDY-018 — Pre-dispatch manual checks are locked after Field submission in the current preview workflow so historical readiness cannot be silently rewritten.
- JOB-RDY-019 — Production corrections after dispatch/submission must append revision/audit evidence rather than overwrite history without trace.

## Current dimensions

1. Customer Confirmation — derived from Appointment
2. Van Assignment — derived from Work Order assignment integrity
3. Exact HVAC Scope — derived from Work Order Scope
4. Materials — derived from Material Plan + Inventory/Transfers/Reservations
5. Crew & Required Skill — office check
6. Required Tools — office check
7. Site Access — office check
8. Commercial Clearance — office check

## Decision hierarchy

```text
if any dimension == BLOCKED:
    overall = BLOCKED
else if any dimension == AT_RISK:
    overall = AT_RISK
else:
    overall = READY
```

This hierarchy intentionally prevents a green dashboard from hiding an unresolved operational fact.

## Manual checks are facts, not the final decision

The office may say:

- Crew & skill = Ready
- Tools = Not required
- Site access = Ready
- Commercial clearance = Not required

But those facts do not override a missing HVAC scope or material shortage. The final status remains derived.

## Browser persistence

Manual readiness facts:

`demac.erp-next.operations.job-readiness-checks.v1`

Derived dimensions continue to read their authoritative browser source records rather than duplicating those facts into the manual record.

## Production migration

As dedicated subsystems mature, manual dimensions should progressively become derived:

- workforce schedule + skill matrix → Crew & Skill
- tool custody/QR/calibration → Tools
- customer/site access workflow → Site Access
- deposit/PO/credit/QBO state → Commercial Clearance

The overall decision engine can remain stable while its evidence sources become more authoritative.