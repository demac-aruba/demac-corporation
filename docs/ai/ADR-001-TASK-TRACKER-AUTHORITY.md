# ADR-001: Governed Task Tracker authority independent from Scheduling

- Status: Proposed
- Date: 2026-09-11
- Owners: DEMAC business owner; ERP maintainer
- Related task/rules: `OPS-TASK-001` through `OPS-TASK-007`; `TASK_TRACKER_BUILD_2026-09-11.md`
- Supersedes/superseded by: none

## Precedence rule

Later approved ADRs may supersede earlier ADRs. Mark the earlier decision clearly as
`Superseded` and link both directions. Agents must follow the latest applicable approved
decision and must not resurrect obsolete or superseded architecture. If applicable ADRs
conflict and precedence cannot be proven, escalate instead of guessing or combining them.

## Context

DEMAC needs an internal Task Tracker for owner/management assignments to office operators and
other authorized staff, including priority, Aruba deadlines, checklist/evidence completion,
activity history and governed WhatsApp reminders. Existing Scheduling & Dispatch is a protected
capacity/appointment authority and must not be overloaded with administrative follow-up tasks.
Employee identity already belongs to `staffProfiles`, authentication/roles already belong to
Firebase Auth plus governed user records, and WhatsApp delivery already has a canonical outbound
queue/provider authority.

The Task Tracker therefore creates a new operational source-of-truth boundary, but that boundary
must remain narrow, fail closed before activation, avoid client-authoritative writes, preserve
existing Schedule behavior, and reuse existing identity/communication authorities rather than
creating parallel ones.

## Decision

1. Canonical Task truth is stored in `taskRecords`; activity/audit is append-only `taskEvents`.
2. Task assignment references canonical `staffProfiles.id`. Task name/phone values are historical
   snapshots only and never become another employee identity or authorization source.
3. ERP Next presentation calls authenticated Firebase Functions. `taskTrackerApi` owns Task
   mutations and enforces active user, normalized ERP role, canonical `staffId`, lifecycle,
   optimistic version and completion requirements server-side.
4. Super Admin, Operations and Project Manager may assign/administer Tasks. An Office Operator
   may execute only Tasks whose `assigneeStaffId` matches that authenticated user's provisioned
   canonical `staffId`. UI visibility is not authorization.
5. `overdue` is a derived attention state from the Aruba deadline. It is not a second persisted
   lifecycle state. `completed` and `cancelled` are terminal states.
6. Task evidence metadata is stored on the Task; file bytes are private Firebase Storage objects
   under `task-evidence/` and are accessed only through authenticated `taskTrackerAttachments`.
   No public media URL is part of the Task evidence contract.
7. Task reminder planning is owned by Task Tracker, while actual message transport remains owned
   by the existing `whatsappOutboundQueue` and configured WhatsApp provider. Deterministic queue
   identifiers prevent duplicate scheduled reminders.
8. Task Tracker has no import, write path, capacity effect or derived write into Scheduling,
   Booking Authority, Appointments, Work Orders or CRM. A future handoff would require a separate
   approved architecture decision and explicit domain contract.
9. `businessSettings/task-tracker.backendEnabled` is a server-only fail-closed rollout gate. It is
   intentionally absent from the regular Task Tracker UI. Production Function deployment and
   activation remain explicit human-approval actions.

## Alternatives considered

| Alternative | Benefits | Costs/risks | Why not selected |
| --- | --- | --- | --- |
| Store Tasks inside Scheduling/appointments | Reuses an existing screen/data set | Pollutes capacity truth, creates false booking semantics, risks Schedule regressions | Violates protected Scheduling authority and owner requirement |
| Direct browser writes to new Firestore collections | Fastest implementation | UI/client becomes de facto authority; difficult least-privilege rules; role/staff bypass risk | Replaced by authenticated server authority |
| Duplicate Task-specific operator directory | Simple assignment UI | Creates competing employee identity, stale phones/names, authorization drift | Canonical `staffProfiles` already owns employee identity |
| New WhatsApp sender/queue for Tasks | Isolated implementation | Duplicate provider/contact/notification authority and operational drift | Existing governed queue/provider must remain canonical |
| Public Storage URLs for evidence | Simple viewing/downloading | Long-lived link exposure and weak per-Task authorization | Evidence is private and streamed through authenticated authority |

## Consequences

- Positive:
  - Task work cannot silently consume or change Schedule capacity.
  - Employee and WhatsApp authorities remain single-source.
  - Server authorization, version conflicts and audit evidence are explicit.
  - Mobile and desktop UI can evolve without redefining business authority.
  - Evidence supports completion accountability without new public Storage rules.
- Negative/tradeoffs:
  - New Firebase Functions must be deployed before live Task persistence works.
  - Task evidence upload/download passes through Functions rather than direct Storage clients.
  - Task Tracker and evidence transport currently repeat a small amount of role normalization logic;
    future consolidation is appropriate if more Task endpoints are introduced.
- Security/privacy:
  - Firebase ID token verification and active governed user profile are mandatory.
  - Office operators are assignment-scoped by canonical `staffId`.
  - Evidence is private and no public download URL is persisted.
  - Browser controls are convenience only; server checks remain authoritative.
- Scalability/operations:
  - Initial Task/list limits are intentionally bounded for current DEMAC scale.
  - Reminder queue IDs are deterministic; WhatsApp delivery/retry remains in its existing authority.
  - Evidence files are capped at 20 MB and Task attachment history is bounded.
- Migration/compatibility:
  - No existing Scheduling/CRM/Work Order migration or backfill is required.
  - Production starts with an empty Task source of truth when explicitly activated.

## Verification and rollout

- Acceptance evidence:
  - ERP Next Task Tracker focused acceptance tests.
  - Task server authority/reminder/evidence-policy tests.
  - Full ERP Next typecheck/build and Scheduling/Booking/Field regression suites.
  - Diff verification that no Scheduling/Dispatch/Appointment implementation file changes.
- Observability:
  - Task events provide actor/time activity evidence.
  - WhatsApp reminder queue items include Task IDs/source/reason.
  - Firebase Function logs record server failures without reporting uncommitted writes as saved.
- Rollback or forward recovery:
  - Before merge: close PR/delete branch.
  - After code deployment but before activation: leave `backendEnabled` false.
  - After activation: disabling `backendEnabled` stops new Task mutations/evidence/reminder work while preserving records for reconciliation.
- Review date/triggers:
  - Re-review before production activation, before any Task-to-Scheduling handoff, before role expansion,
    or before replacing the current WhatsApp/evidence boundaries.
