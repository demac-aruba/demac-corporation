# Technician Portal UAT and merge handoff

Prepared: 2026-08-28

This packet prepares human validation only. It does not authorize merge, additional Rules changes, deployment, production data access, customer communication, Inventory movement, invoicing or Accounting/QBO activity.

## Current branch state

- Branch: `feature/technician-portal-canonical-foundation`
- Prepared through implementation commit: `edc9f3899418a0ac665300625ffaea101d3cf844`
- Canonical deliverable count: **40 completed / 41 total / 1 remaining**
- Mandatory scenarios: 26/26 branch-level acceptance evidence PASS
- Rules gate: 5/5 Firestore groups and 16/16 Storage runtime scenarios PASS; no production Rules deployment occurred
- Review mode: current-main Solo Maintainer Review Mode applied; absence of an external reviewer is not itself a blocker
- Human UAT and merge decision: not yet completed

## Preconditions before human UAT can approve release readiness

1. The current branch is pushed and all required GitHub workflows pass at the exact remote head.
2. A final fresh adversarial review covers the complete release candidate under current-main Solo Maintainer Review Mode; an available external reviewer may add evidence but is not mandatory.
3. UAT uses non-production test identities and data only.

## Human UAT script

Record PASS/FAIL and evidence for every item.

1. **Assignment boundary:** assigned lead can open the job; helper sees report-only capabilities; unassigned and inactive users cannot access it even with the ID.
2. **Planned versus actual:** Appointment remains `1 Standard Service`; field execution records Sala Standard Service, Bedroom Standard Service, one Bedroom Switch and Kitchen Check-up as distinct actual records.
3. **On-site A/C registration:** location/title, type, brand, BTU, refrigerant, voltage, reference photo, indoor plate and outdoor plate are required; QR remains optional.
4. **QR attach:** a known matching QR attaches the exact same-Customer/same-Property Asset; a foreign QR is denied without leaking ownership.
5. **Multiple work records:** two interventions may target one A/C; additional work does not rewrite booked quantity or planned work lines.
6. **Professional Report readiness:** incomplete required frozen sections block intervention completion; the preview shows exact server-derived blockers and never acts as Office Review authority.
7. **Partial/return visit:** completed work remains complete, pending-part truth remains partial, and a return creates a distinct physical WorkVisit without overwriting the first.
8. **Office Review:** submit, return with note, technician correction/amendment, resubmit and approve preserve immutable revisions; approval locks ordinary technician mutation.
9. **Field sales:** active catalog Switch/Armaflex/arbitrary Product use canonical snapshots; non-catalog remains unpriced and Office-review-required; declined lines remain historical and unbilled.
10. **Histories:** Customer history shows individual interventions; Equipment history contains only records linked to the exact canonical Asset.
11. **Offline interruption:** cached data is visibly stale/read-only, a local draft retains its base version, uncertain writes remain unconfirmed, exact replay does not duplicate, and a stale conflict preserves a blocked local copy.
12. **Downstream candidates:** Office approval may emit immutable Inventory/Billing review candidates from frozen actual work, but creates no stock movement, invoice, Accounting record or QBO effect.
13. **Mobile/accessibility:** primary controls are usable on the supported phone viewport, keyboard focus and labels are understandable, errors are actionable, and no Scheduling authority appears in Field UI.

## Required evidence bundle

- exact branch head SHA and clean worktree;
- URLs/results for every required workflow at that same SHA;
- Firestore and Storage emulator transcript with all target assertions PASS;
- Solo Maintainer adversarial review record, plus any available external review evidence, with findings resolved or explicitly blocking;
- UAT record naming tester, date, non-production environment and evidence references;
- final diff check showing no Rules change outside the explicitly approved branch scope and no secret, deploy, migration or production-data change.

## Merge decision

Current decision: **HOLD / DO NOT MERGE**.

After every precondition and UAT item passes, a human may decide whether to approve and merge PR #435. Production rollout remains a later, separate human-approved action even after merge.

## Recovery posture

If later non-production validation fails, stop the rollout, preserve all canonical test records for diagnosis, hide/disable the affected UI only through an approved reversible change, and fix forward. Never delete canonical Field history automatically. Server authority must be deployed before its client consumer in any future authorized rollout.
