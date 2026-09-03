# Review: Projects module integration preview

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: Dirac (`premerge_quality_audit`)
Implementation author / agent: primary agent plus scoped implementation reviewers

## Scope reviewed

- Request/acceptance criteria: integrated Projects module under Operations; Project creation/editing; canonical CRM lookup; one-hour Project slots; Project-aware Scheduling confirmation and Temporary Hold; technician handoff; permission, concurrency, completion, and posting behavior.
- Diff/commit: final working tree for `apps/erp-next` Projects, Scheduling, browser-preview domain/storage, focused acceptance tests, navigation, and paired governance evidence.
- Affected callers/integrations: ERP Next navigation, Projects workspace, New Appointment drawer, Booking Authority, canonical CRM references, technician handoff, browser preview storage, and Projects financial projection.
- Authorities and rule IDs: CRM remains authoritative for Customer and Property identity; Booking Authority remains authoritative for Appointment, Work Order, Temporary Hold, and capacity; Field Operations remains authoritative for canonical execution; AD-014 records the noncanonical Projects preview boundary.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| High (resolved) | `browser-projects.ts`; Projects workspace; Scheduling appointment drawer | The earlier full-snapshot persistence path could overwrite a Scheduling assignment saved concurrently in another tab. All Project preview writes now acquire one Web Lock, re-read the latest snapshot, reduce over that snapshot, verify persistence, and update React state only after the write succeeds. Acceptance tests cover stale fallback data, failed writes, and in-lock authorization. | Resolved before merge. |
| High (resolved) | Project permissions and canonical assignment lifecycle | Reads and mutations are gated independently; permission is rechecked synchronously inside the transaction before storage access; canonical Scheduling-linked assignments cannot manufacture local actuals or completion. | Resolved before merge. |
| Medium (recorded) | `browser-projects.ts` transaction fallback | Browsers without the Web Locks API use a synchronous unlocked fallback, so cross-tab writes can still race on those unsupported surfaces. The target in-app Chromium surface supports Web Locks, and Projects remains an explicitly documented browser-only preview. | Require Web Locks or move mutation authority server-side before expanding the preview to unsupported browsers. Owner: DEMAC Projects platform. |
| Medium (recorded) | raw `project_manager` / `projects` role aliases versus `officeBookingAuthority` | Those raw aliases receive a backend 403, while current User Management cannot provision them and the supported Supervisor/Operations path is accepted. There is no authorization bypass; the latent contract mismatch matters only if manually created or legacy profiles exist. | Inventory legacy/manual profiles before enabling a dedicated Project Manager role; align frontend capability and backend allowlists under an approved access-control change. Owner: DEMAC Security / Operations. |
| Medium (recorded) | AD-014, canonical commit followed by local Project link | Booking Authority can commit valid canonical work before browser-local Project linkage. A local-link failure is exposed as `syncStatus: pending`; it does not claim rollback or linked success. | Introduce a tenant-scoped canonical Project authority and durable idempotent reconciliation before Projects becomes production authority. Owner: DEMAC Projects platform. |

## Verification

- Required checks run: `npm run typecheck`; `npm run test:projects-preview`; `npm run test:live-scheduling`; `npm run test:lifecycle`; `npm run test:crm`; `npm run build` from `apps/erp-next`.
- Results: all commands passed on the final implementation. The production build compiled, typechecked, generated 54 routes, and included `/projects`; its prebuild employee schedule, attendance, attendance/Work Order, Van profile, and Projects acceptance suites also passed.
- Security and permission cases: independent `projects.view` and `projects.manage` denial; render-synchronous revocation state; authorization before locked storage reads/writes; canonical backend authorization retained.
- Business-invariant cases: six one-hour slots per work day; Service Project material budget omitted; AWG implicit; canonical Customer/Property identity; Project-recorded descriptions and technician instructions; no fabricated manager, unit, technician, date, rate, or cost.
- Retry/concurrency/idempotency cases: stale Project snapshots preserve newer Scheduling links; duplicate Scheduling links and posted assignment replays are no-ops; write verification failures reject; completion and posting re-evaluate the latest Project under the shared lock.
- Failure/recovery cases: capacity is revalidated by Booking Authority; failed local Project linkage is marked pending after canonical success; browser preview reset and mutations fail visibly when persistence is unavailable.
- Unverified areas: automated in-app-browser interaction with `localhost` was unavailable under the browser-control URL policy; no production deployment, production-data migration, or authenticated production smoke test was performed.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Residual risk, owner, and due date: AD-014 and the two Medium items above are owned by DEMAC Projects platform / Security and must be closed before Projects becomes a canonical production authority or unsupported browser/dedicated Project Manager access is enabled.

Human approval still required before any action covered by the repository Human Approval Boundary: publishing this commit to `origin/main` may activate a production deployment and requires explicit user authorization.
