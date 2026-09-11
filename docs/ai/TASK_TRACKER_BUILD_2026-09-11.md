# Task: Build native ERP Next Task Tracker

## Context

- Request/source: Business-owner request on 2026-09-11 to build a Task Tracker for assigning operator work, deadlines, status, evidence, and governed WhatsApp reminders.
- Product surface and users: DEMAC ERP Next; owner/super admin, operations/project managers, and office operators.
- Current behavior/evidence: ERP Next has the shared `ErpShell`, canonical `staffProfiles`, Firebase-authenticated Firestore REST access, accessibility text scaling, and the governed WhatsApp outbound queue. There is no canonical Task Tracker module yet.

## Scope

- In scope:
  - Native `/tasks` ERP Next module using the existing shell, theme tokens, responsive behavior, and text-size accessibility contract.
  - Task domain contract, lifecycle, priority, deadlines, checklist, comments/activity metadata, completion requirements, acknowledgements, audit events, reminder policy, and automation settings contract.
  - Canonical assignee selection from existing `staffProfiles` (no duplicate employee/operator identity).
  - Desktop-first management surfaces plus purpose-built phone UX (compact task cards, grouped status board, mobile action bar and sheet-style forms rather than a desktop table stacked vertically).
  - Governed integration contract for reminders through the existing `whatsappOutboundQueue` authority.
  - Focused acceptance tests for lifecycle, permissions and reminder planning.
- Out of scope for this branch until explicit activation approval:
  - Production deployment or merge.
  - Firestore/Storage rule deployment.
  - Production data migration/backfill.
  - Any change to Scheduling & Dispatch, Booking Authority, appointments, capacity, CRM, or existing Schedule behavior.
  - A new WhatsApp sender/queue/provider.
- Files/boundaries expected:
  - `apps/erp-next/app/(erp)/tasks/**`
  - `apps/erp-next/components/task-tracker/**`
  - `apps/erp-next/lib/task-tracker/**`
  - Narrow additions to `apps/erp-next/lib/navigation.ts`, `apps/erp-next/lib/security.ts`, and `apps/erp-next/package.json`.
  - No scheduling files.

## Governance

- Authority owner(s):
  - Task truth: new governed Task Tracker domain (proposed `taskRecords` + append-only `taskEvents`).
  - Employee/operator identity: existing canonical `staffProfiles`.
  - Authentication/roles: Firebase Auth + governed user/role records.
  - Transactional WhatsApp: existing communication authority and `whatsappOutboundQueue`; provider configuration remains canonical.
- Business-rule IDs:
  - New proposed family `OPS-TASK-*`; no change to protected `OPS-SCHED-*` rules.
- Security/privacy impact:
  - Task access is role/capability scoped. Assignees may execute their own work; assignment/automation administration is restricted. UI visibility is not considered authorization.
- Legacy parity impact: none. This is a new ERP Next capability.
- ADR/debt impact:
  - The new task source-of-truth boundary must be documented before production activation. This branch may implement the contract and preview behavior but must not deploy new access rules without human approval.

## Acceptance criteria

- [ ] Given an authorized manager, when `/tasks` opens, they can see a responsive task overview without loading or mutating Schedule data.
- [ ] Given canonical `staffProfiles`, when creating a task, assignees are selected from that source rather than duplicated task-specific operator records.
- [ ] Given a task, when priority/status/deadline changes, lifecycle rules reject invalid terminal transitions and audit metadata is produced.
- [ ] Given an office operator, when viewing tasks, their execution surface prioritizes their own assigned tasks and does not expose task administration controls they lack.
- [ ] Given a configured deadline, reminder planning produces deterministic 24h/3h/1h/deadline/overdue opportunities without reminder spam or duplicated reminder keys.
- [ ] Given a WhatsApp reminder, the integration contract targets the existing governed outbound queue; it does not create another sender, provider configuration, or notification authority.
- [ ] On a narrow phone viewport, primary actions, filters, creation and task detail are touch-first and usable without horizontal desktop-table interaction.
- [ ] Existing Scheduling & Dispatch files and behavior remain unchanged.

## Plan and risk

- Implementation outline:
  1. Add domain types and pure lifecycle/reminder policy.
  2. Add Firestore repository adapter behind explicit capabilities and canonical staff identity.
  3. Add responsive Task Tracker workspace and route using existing ERP tokens/shell.
  4. Add narrow navigation/capability entries.
  5. Add focused acceptance test script.
  6. Run typecheck + focused task acceptance test; build if integration surface is ready.
  7. Perform separate Solo Maintainer Adversarial Review before requesting merge approval.
- Migration/rollback or recovery:
  - No production migration in this branch. All changes are isolated to `feature/task-tracker`; rollback is branch deletion/PR closure before merge.
- Key risks and mitigations:
  - Schedule regression: zero imports/writes from task code to scheduling modules; compare diff before review.
  - Duplicate employee identity: reference `staffProfiles` IDs only.
  - WhatsApp duplication/spam: deterministic reminder keys and existing queue authority only.
  - Client-only authorization: capability checks are implemented in the application contract, but production activation remains blocked until corresponding server/Firestore enforcement is reviewed and approved.

## Verification

- Automated gates:
  - `npm run typecheck --prefix apps/erp-next`
  - `npm run test:task-tracker --prefix apps/erp-next`
  - `npm run build --prefix apps/erp-next` before release/preview handoff when available.
- Manual scenarios:
  - Desktop owner overview/create/detail/board/automation.
  - Mobile operator My Tasks/detail/status update.
  - Font-size offset and dark/light theme.
  - Negative capability paths.
- Evidence/results: pending implementation.
- Not run and why: production deploy/migration/security-rule deployment are intentionally prohibited until owner approval.
