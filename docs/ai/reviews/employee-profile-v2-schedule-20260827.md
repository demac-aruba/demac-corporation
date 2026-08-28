# Review: Employee Profile V2 — Work Schedule

Review mode: **Solo Maintainer Adversarial Review**
Date: 2026-08-27
Branch: `feature/employee-profile-v2-mainline-20260827`
Base: current `main` at review start (`3b1073aa2a4aaa105a13193604765d2e79252b2c`)

This review is intentionally separate from the Builder pass. It is not represented as an independent external review.

## Scope reviewed

- Request/acceptance criteria: premium employee profile; office 08:00–17:00 / 09:00–18:00 schedules; individual office half-day 4h worked + 4h paid-free; technician half-day remains Van/team 5h + 3h; Sunday closed; effective dates; employment start/end boundaries; no loss of real employee data.
- Complete diff against current `main`: Employee Profile UI, schedule settings/resolver, focused acceptance tests, package prebuild gate, and schedule-rule documentation only.
- Authorities: `staffProfiles`, `employeePayrollSettings`, `vanHalfDaySchedules`, `staffAbsences`, Firebase Auth.
- Rule IDs: `OPS-STAFF-SCHEDULE-001` through `OPS-STAFF-SCHEDULE-005`.

## Adversarial findings

| Severity | Location | Evidence and impact | Required correction / disposition |
| --- | --- | --- | --- |
| High | Original implementation branch ancestry | The first implementation branch was based on an older feature branch rather than current `main`; a PR from it would have carried unrelated technician-portal changes. | **Fixed before PR.** Rebuilt the feature on `feature/employee-profile-v2-mainline-20260827` directly from current `main`; compare now reports 0 commits behind and only Employee Profile V2 files. |
| High | Profile replacement parity | An earlier premium-editor pass omitted/simplified ERP access management and employee lifecycle actions that existed in the canonical profile. | **Fixed before mainline port.** Current V3 preserves create/link/disable access, password reset, offboarding and reactivation. |
| Medium | Operational role vs ERP access role | An earlier pass risked coupling employee-type changes to ERP access-role/email ownership changes. | **Fixed before mainline port.** Current editor keeps operational type/role separate from authentication role and login-email ownership. |
| Medium | `employee-schedule-acceptance.ts` | The first expanded test file replaced several pre-existing regression cases (morning-off, missing effective date, Saturday behavior, employment label). Removing tests would violate the absolute quality-gate rule. | **Fixed.** All prior behavioral cases were restored and new V2 cases added. |
| Medium | Historical payroll schedule changes | Updating only current half-day fields could make future schedule changes alter historical projections. | **Fixed.** First V2 save preserves the legacy configuration as a historical schedule version; date resolution selects the applicable version. |
| Low | UI-only edit affordances | A few controls may remain visually editable for a user who cannot persist the enclosing profile. | Server/data authorization and save-path guards remain authoritative; no privilege escalation. Treat as a non-blocking UX follow-up if it is observed in authenticated manual testing. |

## Authority / security review

- `staffProfiles` remains the employee master identity; no second employee identity or collection is introduced.
- Firebase Auth remains authentication only. Operational employee role and ERP access role remain separate.
- Office schedule writes remain in `employeePayrollSettings`, whose Firestore write boundary is payroll-authorized.
- Technician recurring half-days remain in `vanHalfDaySchedules`; `buildEmployeeScheduleChanges` rejects an individual technician schedule write.
- Dated vacation/sickness/unavailability remains `staffAbsences`.
- No Firestore/security rules were changed by this feature.
- No production data, secrets, access rules, or migrations were modified.

## Data preservation / failure review

- Existing payroll-setting documents are updated with Firestore update masks rather than replaced wholesale, preserving unrelated real fields.
- New schedule fields are additive; no production backfill is required.
- Existing legacy half-day records resolve without migration, including legacy records missing `halfDayEffectiveFrom`/`halfDayOffPeriod`.
- Schedule saves use a stable employee payroll-settings record and replace the same-effective-date version, making a retry deterministic rather than creating duplicate effective versions.
- If the secondary cleanup of deprecated profile fields fails after the payroll schedule write, the saved schedule remains authoritative and a retry is safe; runtime no longer depends on the deprecated full-day fields.
- Explicit historical timesheets/absences are not deleted or rewritten by schedule changes.

## Verification

- `npm run typecheck --prefix apps/erp-next` — **PASS** in Vercel build for commit `074257c8067c767a5b6e6e6e34166dd4f00919c7`.
- `npm run test:employee-schedule --prefix apps/erp-next` — **PASS**. Coverage includes preserved legacy cases, 08:00–17:00 / 09:00–18:00 schedules, morning/afternoon half-day, missing legacy effective date, Saturday, Sunday closure, start/end employment boundaries, technician Van ownership, history versioning, data-field preservation and invalid-shift rejection.
- `npm run build --prefix apps/erp-next` — **PASS** in Vercel preview.
- Vercel `demac-corporation` — **SUCCESS**.
- Vercel `demac-corporation-web` — **SUCCESS**.
- Compare current branch to `main` — **0 behind**, scope limited to Employee Profile V2 implementation/tests/docs.
- Security-rule review — existing `employeePayrollSettings` payroll-role boundary and `staffProfiles`/`staffAbsences` operation boundaries remain unchanged.

## Unverified area

An authenticated browser click-through of the final preview has not been performed by this agent because the preview/application requires interactive account authentication not available through the current verification tools. Compile, focused domain acceptance, route generation and preview deployment are verified. This does not authorize production deployment.

## Decision

- [x] **Approve with recorded follow-up** under Solo Maintainer Adversarial Review Mode.
- [ ] Request changes.

Residual risk: authenticated visual/interaction smoke test of the premium profile remains the final UX confirmation. Owner: DEMAC. This is not a data-integrity or authorization blocker; production merge/deploy still requires explicit owner approval.
