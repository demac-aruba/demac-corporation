# Task: Advanced canonical Vans profile

## Context

- Request/source: Owner-approved redesign based on the approved Vans mockup in chat.
- Product surface and users: ERP Next `/vans`; owner, operations, scheduling staff.
- Current behavior/evidence: Vans shows canonical crew/half-day/WhatsApp data but only WhatsApp fields are editable. Legacy previously supported editing responsible technician, regular helper, van profile and maintenance records.

## Scope

- In scope:
  - Rename screen heading to `Vans`.
  - Premium master/detail Vans workspace matching the approved concept.
  - Create/edit Van profile using the existing canonical `vans` collection.
  - Regular crew assignment owned by the Van: responsible technician/driver, regular helper, optional third helper.
  - Technical recurring partial-day configuration owned by `vanHalfDaySchedules` with exact worked hours.
  - Date-scoped temporary crew overrides in `dailyVanAssignments`, including optional third helper.
  - WhatsApp group configuration using the existing canonical Van schedule group settings.
  - Capacity/readiness summary derived from canonical crew/status/schedule data.
  - Maintenance and repair history using the existing legacy/canonical `vanMaintenanceLogs` collection and existing Van service/registration fields.
  - Employee profiles remain derived readers of Van crew ownership; no second employee-level crew authority.
- Out of scope:
  - Destructive migration or backfill.
  - Firestore rule changes.
  - Production deployment or merge without explicit owner approval.
  - New inventory authority or new maintenance source of truth.
- Files/boundaries expected: `apps/erp-next` Vans UI, canonical operations types/loaders/mutations, focused acceptance tests, AI engineering docs.

## Governance

- Authority owner(s): `vans` for regular crew and Van profile; `dailyVanAssignments` for date-scoped overrides; `vanHalfDaySchedules` for technical partial day; existing Van WhatsApp settings for group mapping; `vanMaintenanceLogs` for maintenance/repair history.
- Business-rule IDs: `OPS-TEAM-*`, `OPS-STAFF-SCHEDULE-*` plus new `OPS-VAN-PROFILE-001/002/003` documented in company rules.
- Security/privacy impact: Existing Firestore rules already allow active staff reads and operations-role writes for these collections; UI also requires ERP scheduling/employees management capability. No security-rule change.
- Legacy parity impact: Restores Legacy Van profile editing and maintenance-log behavior while keeping the newer canonical authority model.
- ADR/debt impact: No new source of truth. `primaryVanId` remains compatibility/read projection only, not write authority.

## Acceptance criteria

- [ ] Existing canonical Vans load without rewriting or deleting records.
- [ ] Owner/authorized operations user can create a new Van profile.
- [ ] Van regular crew can save a driver, helper and optional third helper in one canonical Van record.
- [ ] The same staff member cannot occupy multiple slots on the same Van.
- [ ] Regular crew assignment is not written independently to Employee Profile.
- [ ] Daily override can replace driver/helper/third helper for one date without changing regular crew.
- [ ] Technical partial-day weekday/start/end persist to `vanHalfDaySchedules` and only exact worked time is counted.
- [ ] Sunday remains company-closed and is not offered as the recurring partial-day selector.
- [ ] WhatsApp group editing continues to use the existing canonical settings path.
- [ ] Maintenance/repair entries use `vanMaintenanceLogs`; existing entries remain readable.
- [ ] Van profile exposes service, registration and insurance fields without destructive migration.
- [ ] Unauthorized UI cannot perform Van writes; Firestore remains the server-side enforcement boundary.

## Plan and risk

- Implementation outline: extend canonical types/loaders additively, add focused Van-domain helpers, build a premium Vans workspace, add acceptance tests, then run ERP Next typecheck/tests/build and adversarial review.
- Migration/rollback or recovery: no migration. New optional fields are additive (`additionalHelperId`, `additionalHelperStaffId`, profile image metadata). Rollback is code-only; existing Firestore documents remain compatible.
- Key risks and mitigations: duplicate crew membership -> validation; stale employee `primaryVanId` -> never used as write authority; old maintenance records -> additive tolerant decoder; temporary override accidentally becoming permanent -> separate collection and save actions.

## Verification

- Automated gates: ERP Next typecheck, focused Vans acceptance, employee schedule/attendance regression, production build.
- Manual scenarios: four existing Vans render; change crew on preview data only; add third helper; partial-day exact hours; daily override; WhatsApp settings; maintenance/repair entry; create Van form.
- Evidence/results: pending.
- Not run and why: production writes/deployment are outside implementation verification until owner authorizes merge/deploy.
