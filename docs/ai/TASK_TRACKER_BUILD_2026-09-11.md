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
- Governed private Task evidence:
  - evidence metadata is part of the canonical Task;
  - image/PDF/text/CSV/Word/Excel upload support is bounded to 20 MB;
  - file bytes live privately under Firebase Storage `task-evidence/`;
  - authenticated `taskTrackerAttachments` authorizes upload/download against the Task actor;
  - no public evidence URL is persisted;
  - stale-version metadata commits fail closed and uploaded orphan objects are deleted.
- `attachment_required` completion policy blocks task completion until evidence exists.
- Deterministic WhatsApp reminder planner: 24h, 3h, 1h, deadline and overdue opportunities.
- Daily WhatsApp digest with one numbered message per operator; default 08:00 Aruba time and configurable scheduling window with deterministic deduplication.
- Manual `Request Update` and scheduled reminders reuse the existing `whatsappOutboundQueue`; no second sender/provider was created.
- Fail-closed activation: server persistence requires `businessSettings/task-tracker.backendEnabled === true`, and that activation switch is intentionally not exposed in the UI.

## Deliberately not activated / not merged

- No production Firebase Function deployment.
- No merge to `main`.
- No production task data migration/backfill.
- No `backendEnabled` activation.
- No WhatsApp reminder activation.
- No demo task data.
- No new browser Firestore or Storage rules for Task Tracker; persistence/evidence are routed through authenticated backend authorities instead.

## Governance

- Task truth: proposed canonical `taskRecords` collection + append-only `taskEvents`, accessed through `taskTrackerApi`.
- Task evidence: metadata on `taskRecords`; private bytes through `taskTrackerAttachments` and Firebase Storage `task-evidence/`.
- Employee/operator identity: existing canonical `staffProfiles`.
- Authentication/roles: Firebase Auth plus provisioned `users`; UI capability checks are convenience only and backend authorization is authoritative.
- Transactional WhatsApp: existing `whatsappOutboundQueue` and Wacli bridge remain the authority.
- Business-rule family: `OPS-TASK-001` through `OPS-TASK-007`; protected `OPS-SCHED-*` behavior is unchanged.
- Architecture record: `ADR-001-TASK-TRACKER-AUTHORITY.md` is Proposed until owner-approved rollout/merge.
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
- [x] Governed private attachment upload/download and attachment-required completion are implemented.
- [x] Static responsive/accessibility contract validates mobile cards/board/full-screen drawers and continued use of the shared ERP text scaling boundary.
- [ ] Human visual UAT in a dedicated deployed ERP Next preview is complete.

## Verification evidence

Draft PR: `#499` (`feature/task-tracker` -> `main`). No merge performed.

Automated evidence on the branch includes:

- Firebase Functions syntax checks including Task API/reminder/evidence functions.
- Task Tracker backend acceptance including lifecycle, server completion policy and evidence-file policy.
- ERP Next Task Tracker acceptance including authorization, reminder planning, evidence completion and mobile UX source contract.
- ERP Next TypeScript typecheck.
- Project phase planner, browser autofill and typography/accessibility tests.
- Dispatch and Appointment lifecycle acceptance.
- Booking Intelligence, Booking Copilot and Live Scheduling acceptance.
- Employee schedule and Employee attendance/Work Order authority acceptance.
- Field domain, simulator, technician experience, assignment security and offline acceptance.
- ERP Next production build.

PR changed-file inspection shows no Scheduling, Dispatch, appointment, booking or CRM implementation file modified. Existing menu invariant keeping `Projects` immediately below `Scheduling & Dispatch` was detected by a protected regression test during development and was corrected without weakening the test.

## Visual UAT boundary

Repository evidence shows the existing Vercel projects are not configured with `apps/erp-next` as
their project root. ERP Next's own README requires a separate Vercel project/root configuration for
its preview/deployment. Therefore a root-repository Vercel preview is not valid evidence of the ERP
Next `/tasks` screen.

Creating a dedicated ERP Next preview/deployment is an infrastructure/deployment action and remains
inside the Human Approval Boundary. Until the owner approves that preview/deployment step, visual QA
is limited to source/layout contracts, successful Next.js build and the shared responsive/font-scaling
architecture. This limitation must not be misreported as completed screenshot/browser UAT.

## Release gates

1. Full CI on the final branch head must remain green.
2. Solo Maintainer Adversarial Review must pass or record explicit follow-up risk.
3. Owner approves the proposed ADR/source-of-truth boundary and merge.
4. Owner separately approves deployment/activation, including the dedicated ERP Next preview/UAT path.
5. `backendEnabled` remains false until that activation approval is explicitly given.
