# Task: Detect missed Van schedule delivery independently

## Context

- Request/source: GitHub issue #429, follow-up to repeated missed 08:00 Van WhatsApp schedules and PR #427.
- Product surface and users: backend operations / technician Van schedule automation; operations team needs failure evidence before technicians report a missing message.
- Current behavior/evidence: PR #427 introduces an invocation heartbeat and canonical queue reconciliation, but the same Cloud Scheduler job remains the only automatic execution failure domain. Existing Van schedule CI/diagnostic workflows validate scheduling architecture or half-day policy, not real daily delivery health.

## Scope

- In scope: read-only post-08:10 health evaluation from canonical operating calendar, `technicianDailyScheduleBatches/{date}`, and `whatsappOutboundQueue`; GitHub Actions scheduling in a separate failure domain; actionable GitHub workflow failure plus deduplicated alert issue; focused tests.
- Out of scope: sending/retrying WhatsApp messages, invoking the scheduled Cloud Function, changing Van/JID mappings, modifying Work Orders, changing Firebase Rules, changing IAM, adding a second scheduler-based message producer, or solving generalized fleet identity (#430).
- Files/boundaries expected: `functions/diagnostics/`, one GitHub Actions workflow, task/ADR documentation. Depends on PR #427 heartbeat and queue semantics.

## Governance

- Authority owner(s): `operatingCalendarService` for open/closed dates; `whatsappOutboundQueue` for actual delivery state; `technicianDailyScheduleBatches` only for invocation/reconciliation evidence.
- Business-rule IDs: existing operating-calendar rules and COMMS integrity rules; no new commercial/business policy introduced.
- Security/privacy impact: production reads through the existing Firebase deployment service account; diagnostic output excludes customer content, phone numbers, WhatsApp JIDs, message text, raw provider failure reasons, secrets, and credentials.
- Legacy parity impact: none; this is operational observability for the current backend automation.
- ADR/debt impact: record the independent-monitor failure-domain decision; #428 remains infrastructure blocker for the producer and #430 remains separate fleet-identity debt.

## Acceptance criteria

- [x] Given an open DEMAC business date after the health window, when no batch heartbeat exists, then health is unhealthy with a missing-heartbeat reason.
- [x] Given a closed business date, health is successful/skipped and does not alert.
- [x] Given an open date with a failed/partial batch, health is unhealthy even if some queue messages succeeded.
- [x] Given expected queue IDs with failed/cancelled/missing/unknown status, health is unhealthy with counts and reasons.
- [x] Given expected queue IDs still queued/processing after the health window, health is unhealthy as late-pending.
- [x] Given all expected queue messages sent/delivered/read and no producer failure, health is healthy even if the batch snapshot has not yet reconciled from `queued` to `complete`.
- [x] Given `no-active-work-orders`, health is a successful explicit skip.
- [x] Given a manual check before the health window for the current Aruba date, health is `not-due` and does not false-alert.
- [x] The workflow source never calls `queueDay`, `sendNow`, Cloud Scheduler run, Cloud Run invoke, or any WhatsApp sender; PR execution confirms `check-production` is skipped.
- [ ] A failed scheduled/dispatch health check creates or updates exactly one alert issue for the affected date without exposing customer/message content. The workflow implementation is present, but an end-to-end GitHub issue write has not been executed from PR because production jobs are intentionally skipped.

## Plan and risk

- Implementation outline: pure evaluator + Firestore read-only CLI wrapper + focused Node tests + GitHub Actions schedule at 12:20 UTC (08:20 Aruba) with PR validation separated from production reads.
- Migration/rollback or recovery: no data migration. Rollback is removal/disablement of the health workflow and diagnostic module; producer behavior is unaffected.
- Key risks and mitigations: false positives before delivery settles -> health window and `not-due`; duplicate alert spam -> exact-title issue search and one issue per date; second source of truth -> queue remains authoritative; accidental production side effects -> diagnostic exposes no write/send operations and production workflow only reads Firebase; data leakage -> compact counts/statuses only and raw batch/provider errors omitted.

## Verification

- Automated gates: `npm run validate:firebase --prefix functions`; `node --check functions/diagnostics/vanScheduleDeliveryHealth.js`; focused `node --test functions/diagnostics/vanScheduleDeliveryHealth.test.js functions/technicianDailyScheduleRunner.test.js`; repository TypeScript/web build validation.
- Builder evidence: the first health workflow run exposed a null-delivery robustness bug in `compactDelivery`; it was fixed at the shared helper rather than weakening tests. Subsequent health workflow runs #2, #3, #4, #5, #6 and #8 passed. TypeScript/web build passed on runs #3707, #3709, #3711, #3722 and #3733. Final restack onto the controlled-deploy parent must pass again before merge readiness.
- Security/scope review: removed raw batch failure details from diagnostic output; removed redundant custom commit-status writer and `statuses: write`; no DEMAC write/send API is imported or invoked by the health workflow.
- Independent review: required by root `AGENTS.md`; automatic Vercel/Copilot review attempts did not produce evidence, so an actual independent reviewer remains required. Builder will not self-approve.
- Manual scenarios not run: no production workflow-dispatch, no alert-issue write, no deploy, no production mutation, no WhatsApp probe/send, and no manual Scheduler/Cloud Run invocation.
