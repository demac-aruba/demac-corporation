# ERP Next — Crew & Skill Readiness V1

## Objective
Replace the manual `Crew & Required Skill` Work Order check with evidence derived from the active Workforce Registry and actual van assignments.

## Requirements

- **CREW-SKILL-001** Workforce Registry is the source for active employee → van → skill relationships in the browser preview.
- **CREW-SKILL-002** Preview employee records may seed the registry but must start with `skillsVerified = false`.
- **CREW-SKILL-003** An unverified preview skill must never produce Crew READY.
- **CREW-SKILL-004** Changing an employee skill or van assignment invalidates that employee's skill verification until reviewed again.
- **CREW-SKILL-005** Inactive employees do not satisfy Work Order crew/skill readiness.
- **CREW-SKILL-006** Every assigned van on a Work Order, including support vans, must have active crew coverage.
- **CREW-SKILL-007** Every assigned van must have at least one verified crew member with the required skill for the Work Order.
- **CREW-SKILL-008** No active crew on an assigned van is a hard BLOCKED condition.
- **CREW-SKILL-009** If crew exists but relevant skill records remain unverified, Crew & Required Skill is AT RISK.
- **CREW-SKILL-010** If the entire active assigned crew is verified and nobody has the required skill, Crew & Required Skill is BLOCKED.
- **CREW-SKILL-011** Verified required-skill coverage on every assigned van produces Crew & Required Skill READY.
- **CREW-SKILL-012** If no required skill policy exists for a Work Preset, the dimension remains AT RISK rather than guessing.
- **CREW-SKILL-013** Work Order UI must not expose a manual Crew & Required Skill override after this module becomes authoritative.
- **CREW-SKILL-014** Workforce-derived Crew status participates in the existing consolidated READY / AT RISK / BLOCKED calculation.
- **CREW-SKILL-015** A workforce change that changes the Work Order risk signature invalidates an older AT RISK start release for future start authority.
- **CREW-SKILL-016** Historical Field starts and historical dispatch releases are not rewritten by later workforce changes.
- **CREW-SKILL-017** Current skill policy maps Standard Service/Anti-corrosive → Service, Deep Cleaning → Deep Cleaning, Diagnostic/Repair → Diagnostics, and Installation variants → Installation.
- **CREW-SKILL-018** `Other` work remains AT RISK until a required-skill policy is explicitly configured.
- **CREW-SKILL-019** Workforce Registry is operational capability evidence, not payroll authority.
- **CREW-SKILL-020** Production migration requires authenticated workforce maintenance, role permissions, effective dates and an auditable skill-verification actor/timestamp.

## Decision hierarchy

For each assigned van:

1. No active crew → **BLOCKED**.
2. Verified employee covers required skill → van skill requirement satisfied.
3. No verified qualified employee, but unverified crew remains → **AT RISK**.
4. Crew fully verified and required skill absent → **BLOCKED**.

All assigned vans satisfied → Crew & Required Skill **READY**.

## Current data mode
Browser-persistent Workforce Registry. Existing `management-operations.ts` employee records are used only as a preview seed and are deliberately unverified until Operations reviews them.
