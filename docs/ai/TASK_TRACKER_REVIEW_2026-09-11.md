# Review: Native ERP Next Task Tracker

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / agent: ChatGPT GPT-5.6 Sol, fresh adversarial pass
Implementation author / agent: ChatGPT GPT-5.6 Sol

This is a Solo Maintainer Adversarial Review. It is intentionally separate from the implementation
pass and is not represented as independent review.

## Scope reviewed

- Request/acceptance criteria: native DEMAC ERP Task Tracker; existing shell/design/font scaling;
  premium desktop and purpose-built phone UX; canonical operator identity; deadlines/status/evidence;
  governed WhatsApp reminders; no Schedule/Dispatch behavior change; no merge/deploy without owner approval.
- Diff/commit: Draft PR `#499`, `feature/task-tracker` at reviewed head
  `4924de5876307dc7cc57ae5af0430fc4bdbe0730`.
- Affected callers/integrations: ERP Next navigation/security, authenticated Firebase user profiles,
  canonical `staffProfiles`, Firebase Functions, private Firebase Storage evidence, existing
  `whatsappOutboundQueue` / Wacli transport, CI.
- Authorities and rule IDs: `OPS-TASK-001` through `OPS-TASK-007`, Identity/roles authority,
  canonical employee `staffProfiles`, transactional WhatsApp authority. Protected `OPS-SCHED-*`
  and Booking Authority are reviewed as non-affected boundaries.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| High — corrected | Initial Task persistence design | Early implementation could have made browser Firestore access part of the Task write boundary, making UI/client behavior too authoritative. | Replaced with authenticated `taskTrackerApi`; server validates active user, role, canonical `staffId`, task assignment, lifecycle and version. No new client Task Firestore rules added. |
| High — corrected | `functions/taskReminders.js` | Reminder workers initially considered automation `enabled` without also requiring the server-only `backendEnabled` rollout gate. A deployed worker could therefore have run under inconsistent settings. | Worker runtime now requires both `backendEnabled === true` and `enabled === true`; focused regression asserts the gate. |
| Medium — corrected | `functions/taskTrackerApi.js` mutation versioning | Missing `expectedVersion` could previously fall back to the current server version, weakening optimistic concurrency for a caller that omitted the field. | State mutation now rejects absent/invalid versions and fails stale writes with `409`. |
| Medium — corrected | `functions/taskTrackerApi.js` checklist normalization | Incomplete checklist items could include explicit `undefined` optional properties, which Firestore may reject when serializing nested values. | Optional completion metadata is now omitted entirely unless an item is completed; regression verifies no undefined keys. |
| Medium — corrected | Create / manual reminder retry behavior | Task creation or manual `Request Update` could create duplicate operational side effects after network/retry ambiguity. | Task creation uses deterministic request fingerprint fallback (and supports explicit request IDs); manual update queue/event IDs are deterministic per actor/task revision and transactionally deduplicated. |
| Medium — corrected | Task evidence | Initial feature branch had metadata/UI intent but no governed real upload/download flow. | Added private `task-evidence/` Storage transport, server authorization, 20 MB/type bounds, attachment-required completion, version check, orphan cleanup and authenticated download without public URLs. |
| Medium — corrected | Evidence kill-switch semantics | Applying `backendEnabled` to evidence downloads would have prevented audit/reconciliation reads after disabling writes. | Kill switch blocks new evidence writes/automation; already-authorized evidence remains readable for audit/reconciliation. |
| Medium — corrected | Operations navigation | Task Tracker was initially inserted between Scheduling & Dispatch and Projects, violating an existing protected Projects navigation invariant. | Existing regression caught it; Task Tracker moved below Projects. Protected test was not changed or weakened. |
| Low — corrected | `functions/bootstrap.js` | Spreading the whole Task API module risked exposing `_taskTrackerTest` as a Firebase export candidate. | Bootstrap now exports only the deployable `taskTrackerApi` handler; test helpers remain internal to the module. |
| Low — follow-up | Task API / attachment transport | Role normalization and Task access checks exist in both server endpoints. They are currently consistent and tested, but duplication could drift if endpoints expand. | Do not block this release. Consolidate into a shared Task authority helper before adding materially more Task endpoints/roles. Owner: ERP maintainer. Trigger: next Task backend expansion. |
| Medium — follow-up | Live visual UAT | Repository has no Vercel project rooted at `apps/erp-next`; root-repository Vercel previews are not valid evidence for the ERP Next `/tasks` UI. | Before production activation, create/use an owner-approved ERP Next preview/deployment and validate desktop/mobile, light/dark and Settings font offsets visually. Owner: DEMAC owner + ERP maintainer. Due: before activation. |
| Medium — follow-up | Production identity data | Repository contracts require Office Operator ERP users to be linked to canonical `staffProfiles.staffId`, but this review cannot inspect/confirm production user records. An unlinked operator fails closed and receives no executable Tasks. | During owner-approved UAT/activation, verify each intended operator user has the correct canonical `staffId` link. Do not add fallback identity guessing. Owner: DEMAC admin. Due: before assigning production Tasks. |

## Verification

- Required checks run:
  - ERP Next TypeScript typecheck.
  - Task Tracker frontend acceptance.
  - Firebase Functions syntax validation.
  - Task Tracker backend/reminder/evidence policy tests.
  - Project phase planner, browser-autofill and typography/accessibility acceptance.
  - Dispatch, Appointment lifecycle, Booking Intelligence, Booking Copilot and Live Scheduling acceptance.
  - Employee schedule and Employee attendance/Work Order acceptance.
  - Field domain, simulator, technician experience, assignment security and offline acceptance.
  - ERP Next production build.
  - Repository/PR changed-file inspection.
  - Related workflows: Office Booking Authority, Work Order Application, Field Operations Authority,
    Transactional WhatsApp Production, WhatsApp Wacli Connector, Workforce Admin and web build validation.
- Results: all automated gates on reviewed head passed. No Scheduling/Dispatch/Appointment/Booking/CRM
  implementation file is present in the PR changed-file list.
- Security and permission cases:
  - manager-only assignment/administration;
  - Office Operator execution scoped to own provisioned canonical `staffId`;
  - Finance/Technician/etc. do not receive Task capabilities;
  - private evidence download/upload rechecks Task access server-side;
  - UI visibility is not treated as authorization;
  - `backendEnabled` is server-side and absent from regular Task UI.
- Business-invariant cases:
  - Task is not Appointment/Work Order/capacity truth;
  - terminal lifecycle cannot reopen through ordinary mutation;
  - overdue is derived, not competing persisted state;
  - checklist/evidence completion requirements are enforced server-side;
  - canonical `staffProfiles` identity and canonical WhatsApp queue/provider are reused.
- Retry/concurrency/idempotency cases:
  - state mutations require exact optimistic version;
  - scheduled reminder queue IDs are deterministic;
  - manual Request Update is deterministic per Task revision;
  - Task create retries converge on a deterministic request identity when the current client does not supply one;
  - evidence upload rechecks version in transaction and removes an uploaded object if metadata commit fails.
- Failure/recovery cases:
  - missing activation fails closed;
  - missing/expired auth fails closed;
  - stale Task version fails closed;
  - missing assignee phone prevents WhatsApp queueing;
  - disabling `backendEnabled` stops Task writes/evidence writes/reminder processing while preserving authorized reads;
  - branch/PR can be discarded with no production migration because nothing has been deployed or activated.
- Unverified areas:
  - live browser visual/UAT because there is no dedicated `apps/erp-next` Vercel preview project yet;
  - actual production `users.staffId` linkage for intended office operators;
  - real Firebase Storage upload/download against deployed Functions, because deployment is intentionally prohibited before owner approval.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

No open Critical or High code finding remains in this review. The feature branch is technically ready
for owner review/approval, but not yet activated for production use. Residual risk is limited to the
human-approved preview/UAT and production identity/linkage checks described above.

Residual risk, owner, and due date:

- Visual ERP Next browser UAT: DEMAC owner + ERP maintainer; before production activation.
- Intended Office Operator `users.staffId` linkage: DEMAC admin; before assigning production Tasks.
- Shared Task server authorization-helper consolidation: ERP maintainer; next material backend expansion.

Human approval still required before merge, dedicated ERP Next preview/deployment, Firebase Function
deployment, source-of-truth activation (`backendEnabled`), or production reminder execution.
