# Task: Advanced canonical Vans profile

## Context

- Request/source: Owner-approved redesign based on the approved Vans mockup in chat.
- Product surface and users: ERP Next `/vans`; owner, operations, scheduling staff.
- Current behavior/evidence before implementation: Vans showed canonical crew/half-day/WhatsApp data but only WhatsApp fields were editable. Legacy previously supported editing responsible technician, regular helper, Van profile and maintenance records.

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
- Files/boundaries: `apps/erp-next` Vans/Technicians UI, canonical operations types/loaders/mutations, employee technical schedule resolution, focused acceptance tests, AI engineering docs.

## Governance

- Authority owner(s): `vans` for regular crew and Van profile; `dailyVanAssignments` for date-scoped overrides; `vanHalfDaySchedules` for technical partial day; existing Van WhatsApp settings for group mapping; `vanMaintenanceLogs` for maintenance/repair history.
- Business-rule IDs: `OPS-TEAM-*`, `OPS-STAFF-SCHEDULE-*`, `OPS-VAN-PROFILE-001/002/003` documented in company rules.
- Security/privacy impact: Existing Firestore rules allow active staff reads and operations-role writes for these collections; UI requires ERP scheduling management capability. No security-rule change.
- Legacy parity impact: Restores Legacy Van profile editing and maintenance-log behavior while keeping the newer canonical authority model.
- ADR/debt impact: No new source of truth. `primaryVanId` remains compatibility/read projection only, not write authority.
- Review mode: Solo Maintainer Adversarial Review per repository `AGENTS.md`; no external reviewer is reasonably available and absence of one is not a blocker.

## Acceptance criteria

- [x] Existing canonical Vans load without rewriting or deleting records.
- [x] Owner/authorized operations user can create a new Van profile; a future Van starts out of service.
- [x] Van regular crew can save a driver, helper and optional third helper in one canonical Van record.
- [x] The same staff member cannot occupy multiple slots on the same Van.
- [x] Cross-Van regular crew conflicts are rejected.
- [x] Regular crew assignment is not written independently to Employee Profile or `primaryVanId`.
- [x] Daily override can replace driver/helper/third helper for one date without changing regular crew.
- [x] Cancelling a daily override preserves audit evidence while releasing its operational assignment.
- [x] Technical partial-day weekday/start/end persist to `vanHalfDaySchedules` and only exact worked time is counted.
- [x] Sunday remains company-closed and is not offered as the recurring partial-day selector.
- [x] WhatsApp group editing continues to use the existing canonical settings path.
- [x] Maintenance/repair entries use `vanMaintenanceLogs`; existing entries remain readable and exact retry payloads are deduplicated.
- [x] Van profile exposes service, registration and insurance fields without destructive migration.
- [x] Unauthorized clients remain blocked by Firestore rules; Firestore is the server-side enforcement boundary.
- [x] VAN-5+ may be created/configured but cannot become live Booking Authority capacity until the protected fleet authority is explicitly expanded.

## Plan and risk

- Implementation: canonical types/loaders extended additively, focused Van-domain helpers added, premium Vans workspace implemented, Technicians/employee Van resolution aligned to Van authority, focused acceptance tests added, and adversarial review performed.
- Migration/rollback or recovery: no migration. New optional fields are additive (`additionalHelperId`, `additionalHelperStaffId`, profile metadata and cancellation audit metadata). Rollback is code-only; existing Firestore documents remain compatible.
- Key mitigations: duplicate crew membership validation; `primaryVanId` never used as write authority; old maintenance records tolerated; temporary overrides use a separate collection; cancellation preserves audit evidence; new Vans cannot silently create scheduling capacity.
- Residual risk: cross-document exclusivity validation is read-before-write rather than a Firestore transaction, so truly simultaneous conflicting fleet edits by multiple operations users could race. Multi-document saves can partially succeed on a network failure but are retry-recoverable. These are recorded in the review and are not hidden as atomic guarantees.

## Verification

- Code head verified before review-doc commit: `ac937a0bc18cd7212f41c96518808e8575fa29d8`.
- Automated gates on that code head:
  - ERP Next CI `33176029355` — PASS.
  - TypeScript and web build validation `33176029333` — PASS.
  - Van Schedule Architecture `33176029341` — PASS.
- Covered gates/scenarios:
  - ERP Next typecheck — PASS.
  - Dispatch acceptance — PASS.
  - Appointment lifecycle acceptance — PASS.
  - Booking intelligence acceptance — PASS.
  - Booking Copilot acceptance — PASS.
  - Live scheduling acceptance — PASS.
  - Employee schedule architecture acceptance — PASS.
  - Van schedule ownership and Booking Authority capacity — PASS.
  - Production Next.js build — PASS.
  - Vans acceptance: legacy two-person crew, optional third helper, safe clearing, driver authorization, cross-Van exclusivity, date overrides, cancelled-override recovery, future-Van protection, exact partial-day hours — PASS.
- Security evidence: current `firestore.rules` reviewed for `vans`, `dailyVanAssignments`, `vanMaintenanceLogs`, and `vanHalfDaySchedules`; operations-role write enforcement already exists and this task does not change rules.
- Adversarial review: `docs/ai/reviews/advanced-vans-profile-20260828.md` — Pass with recorded follow-up.
- Not run: authenticated production UI smoke and real production writes, because deployment/production mutation remains behind owner-approved merge. These are owner smoke-test items after deployment, not waived automated gates.
