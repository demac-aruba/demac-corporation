# Technician Portal UAT and merge handoff

## Authorized release update — 2026-09-03

- The owner approved the simplified Technician Portal concept and explicitly authorized merge and production deployment so the flow can be tested on a phone. This authorization includes the already-reviewed Firestore/Storage access-rule effect of the merge; it does not authorize migrations, secret changes, destructive recovery, Inventory movement, invoicing, Accounting/QBO writes, or customer communication.
- The production function was deployed before the client from reviewed source SHA `628d32c6e300f111414ffbbafa11b52dd7c06e41`. GitHub Actions run `33796220465` completed successfully. Independent direct probes confirmed `fieldOperationsAuthority` CORS preflight `204` for `https://demac-corporation.vercel.app` and unauthenticated POST rejection `401` with `error.code=unauthenticated`.
- The approved release UI shows only the current Aruba day, offers a temporary `super_admin` selector for one individual Van or technician at a time, removes the administrative shell for technician accounts, presents the work flow as `Llegada / Servicio / Cierre`, and keeps all canonical server states and mutations intact.
- The temporary selector can be revoked with `FIELD_ADMIN_SIMULATOR_ENABLED=false` and must be removed after the UAT window.
- Authenticated phone UAT remains an explicit post-deployment follow-up because the agent did not have a production login session. It must not be recorded as already passing.

Release decision for this approved staged rollout: **PASS WITH RECORDED PHONE-UAT FOLLOW-UP**. This section supersedes the historical HOLD below; the original preparation record remains intact for audit history.

Prepared: 2026-08-28

This packet prepares human validation only. It does not authorize merge, additional Rules changes, deployment, production data access, customer communication, Inventory movement, invoicing or Accounting/QBO activity.

## Current branch state

- Branch: `feature/technician-portal-canonical-foundation`
- Prepared through local current-main merge: `62cb3c7950defd276b2700b906c7276623fde95e`
- Remote code candidate with identical tree and passing CI: `562e46e5f7e169d50d3e56f8912b5e05cfeecd8b`
- Canonical deliverable count: **41 completed / 41 total / 0 remaining**
- Mandatory scenarios: 26/26 branch-level acceptance evidence PASS
- Rules gate: 5/5 Firestore groups and 16/16 Storage runtime scenarios PASS; no production Rules deployment occurred
- Review mode: current-main Solo Maintainer Review Mode applied; absence of an external reviewer is not itself a blocker
- Human UAT: not yet recorded
- Conditional human merge approval: received on 2026-08-28, subject to no remaining release blocker
- Production Rules/access deployment authorization: not yet received

## Preconditions before human UAT can approve release readiness

1. **PASS:** the current code tree is published and all 11 required GitHub workflows plus both Vercel previews pass at remote candidate `562e46e5f7e169d50d3e56f8912b5e05cfeecd8b`.
2. **PASS:** a final fresh adversarial review covers the complete release candidate under current-main Solo Maintainer Review Mode; it is not described as independent review.
3. **REQUIRED FOR UAT:** use non-production test identities and data only.

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

Current decision: **HOLD / DO NOT MERGE** until human UAT is recorded and the production Rules/access deployment is explicitly authorized.

The current PR changes `firestore.rules` and `storage.rules`, and the repository workflow deploys those Rules on a qualifying push to `main`. Therefore this merge will automatically cross the production Rules/access boundary; conditional merge approval alone does not authorize that production effect. After UAT passes, a human must explicitly authorize that deployment consequence before PR #435 can be merged.

## Recovery posture

If later non-production validation fails, stop the rollout, preserve all canonical test records for diagnosis, hide/disable the affected UI only through an approved reversible change, and fix forward. Never delete canonical Field history automatically. Server authority must be deployed before its client consumer in any future authorized rollout.
