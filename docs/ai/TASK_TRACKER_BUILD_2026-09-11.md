# Task: Build native ERP Next Task Tracker

## Context

- Request/source: Business-owner request on 2026-09-11 to build a Task Tracker for assigning operator work, deadlines, status, evidence, and governed WhatsApp reminders.
- Product surface and users: DEMAC ERP Next; owner/super admin, operations/project managers, and office operators.
- Existing contracts reused: shared `ErpShell`, Settings-driven accessibility text scaling, canonical `staffProfiles`, Firebase Auth + provisioned `users`, and the existing `whatsappOutboundQueue` / Wacli transport authority.
- Protected invariant: Scheduling & Dispatch, appointments, booking capacity and CRM behavior are outside the Task Tracker authority boundary.

## Scope implemented in the review branch

- Native `/tasks` ERP Next route and existing Operations navigation integration.
- Task domain contract: lifecycle, priority, Aruba deadlines, checklist, acknowledgements, comments/activity, completion requirements, audit events and reminder policy.
- Canonical assignee selection from existing `staffProfiles`; no task-specific duplicate employee identity.
- Desktop management UX: overview/list, five-lane status board, creation/detail drawers and reminder administration.
- Purpose-built phone UX: compact task cards, touch-first filters/actions, single-lane mobile status board and full-screen create/detail flows rather than a stacked desktop table.
- Existing theme tokens, dark/light behavior and `AccessibilityTextProvider` font scaling; no parallel design system.
- Authenticated `taskTrackerApi` as the server-side Task Tracker mutation authority.
- Server enforcement of provisioned Firebase identity, normalized ERP role, canonical `staffId`, task ownership, manager-only administration and optimistic version checks.
- Deterministic WhatsApp reminder planner: 24h, 3h, 1h, deadline and overdue opportunities.
- Daily WhatsApp digest with one numbered message per operator; default 08:00 Aruba time and configurable scheduling window with deterministic deduplication.
- Manual `Request Update` and scheduled reminders reuse the existing `whatsappOutboundQueue`; no second sender/provider was created.
- Fail-closed activation: server persistence requires `businessSettings/task-tracker.backendEnabled === true`, and that activation switch is intentionally not exposed in the UI.

## Deliberately not activated / not merged

- No production deployment.
- No merge to `main`.
- No production task data migration/backfill.
- No `backendEnabled` activation.
- No WhatsApp reminder activation.
- No demo task data.
- No new browser Firestore rules for Task Tracker; task persistence is routed through the authenticated backend authority instead.

## Still incomplete before merge approval

- Real attachment upload/download UX and its governed Firebase Storage boundary. Attachment metadata exists in the contract, but the UI intentionally shows evidence as not yet activated rather than faking upload support.
- Final live-browser desktop/mobile visual QA against the deployed ERP shell and user-selected font-size settings.
- Final Solo Maintainer Adversarial Review after attachments/visual QA are complete.
- Optional future scope, not required for the first production release: recurring tasks and richer priority-specific escalation presets.

## Governance

- Task truth: proposed canonical `taskRecords` collection + append-only `taskEvents` activity stream, accessed through `taskTrackerApi`.
- Employee/operator identity: existing canonical `staffProfiles`.
- Authentication/roles: Firebase Auth plus provisioned `users`; UI capability checks are convenience only and backend authorization is authoritative.
- Transactional WhatsApp: existing `whatsappOutboundQueue` and Wacli bridge remain the authority.
- Business-rule family: new `OPS-TASK-*`; protected `OPS-SCHED-*` behavior is unchanged.
- Rollback before merge: close Draft PR / delete `feature/task-tracker`; no production data or infrastructure has been activated.

## Acceptance criteria status

- [x] Authorized management surface exists at `/tasks` without importing or mutating Scheduling data.
- [x] Assignees come from canonical `staffProfiles`.
- [x] Invalid terminal lifecycle transitions and completion requirements are rejected by policy/server authority.
- [x] Office operator execution is scoped to the authenticated operator's canonical `staffId`; managers retain governed administration.
- [x] Reminder planning generates deterministic 24h/3h/1h/deadline/overdue opportunities with deterministic queue IDs.
- [x] Daily summary is one numbered operator digest rather than one morning message per task.
- [x] Task WhatsApp operations target the existing outbound queue/provider authority.
- [x] Mobile UX avoids horizontal desktop-table dependency and uses phone-specific interaction patterns.
- [x] Existing Scheduling & Dispatch implementation files are unchanged in the PR diff.
- [ ] Governed attachment upload/download is complete.
- [ ] Live browser visual QA is complete.

## Verification evidence

Draft PR: `#499` (`feature/task-tracker` -> `main`). No merge performed.

Latest completed ERP Next CI before this documentation-only update:

- Firebase Functions syntax: PASS.
- Task Tracker backend acceptance: PASS.
- Field authority acceptance: PASS.
- Booking and scheduling regression: PASS.
- ERP Next TypeScript typecheck: PASS.
- Project phase planner: PASS.
- Projects browser autofill: PASS.
- Projects typography/accessibility: PASS.
- Dispatch acceptance: PASS.
- Appointment lifecycle: PASS.
- Booking intelligence: PASS.
- Booking Copilot: PASS.
- Live scheduling: PASS.
- Employee schedule architecture: PASS.
- Employee attendance / Work Order authority: PASS.
- Field operations domain: PASS.
- Field admin simulator: PASS.
- Field technician experience: PASS.
- Field assignment security: PASS.
- Field offline cache/draft/outbox: PASS.
- ERP Next production build: PASS.

PR changed-file inspection shows no Scheduling, Dispatch, appointment, booking or CRM implementation file modified. Existing menu invariant keeping `Projects` immediately below `Scheduling & Dispatch` was detected by a protected regression test during development and was corrected without weakening the test.

## Release gates still required

1. Finish governed attachment support.
2. Run desktop/mobile visual QA in the real ERP shell at multiple Settings font-size offsets.
3. Re-run full CI after those changes.
4. Perform final adversarial review.
5. Ask the owner for explicit merge/deploy/activation approval.
