# ADR-001: Independent health monitoring for Van schedule delivery

- Status: Proposed
- Date: 2026-08-24
- Owners: DEMAC Operations / ERP Engineering
- Related task/rules: GitHub issue #429; `TASK_VAN_SCHEDULE_DELIVERY_HEALTH_20260824.md`; PR #427; operating-calendar and COMMS integrity rules
- Supersedes/superseded by: none

## Precedence rule

Later approved ADRs may supersede this decision only if they explicitly preserve or replace the independent-failure-domain requirement and identify the new canonical delivery/observability authorities.

## Context

The 08:00 Van schedule producer is a Firebase scheduled function backed by one Cloud Scheduler job. Its 08:00, 08:05 and 08:10 cron ticks provide idempotent retries but share one infrastructure failure domain. Production evidence on 2026-08-24 showed that a deployed ACTIVE function can coexist with no application heartbeat when the scheduled invocation path does not execute.

PR #427 adds durable invocation/reconciliation evidence, but evidence that nobody checks does not satisfy operational observability. A monitor implemented as another callback inside the same Scheduler job would fail with the same incident class. A second message producer would create duplicated authority and duplicate-send risk.

## Decision

DEMAC will monitor Van schedule delivery from an independent GitHub Actions scheduled workflow after the final automatic recovery tick.

The monitor is read-only with respect to DEMAC production state. It consumes:

1. `operatingCalendarService` to determine whether the date is operational.
2. `technicianDailyScheduleBatches/{date}` for invocation heartbeat and last producer reconciliation evidence.
3. `whatsappOutboundQueue` for actual individual message delivery truth.

`whatsappOutboundQueue` remains authoritative for delivery state. The batch document is not a second ledger and may be stale after the final runner reconciliation; when all expected queue items are terminal-success and the batch has no producer failure, delivery health may be healthy even if the batch snapshot still says `queued`.

The monitor must never invoke `queueDay`, `sendNow`, Cloud Scheduler run, the scheduled Cloud Function, Cloud Run, or a WhatsApp transport. It must never modify Vans, Work Orders, appointments, queue records or business-calendar data.

The independent workflow runs after the final 08:10 Aruba recovery tick. The initial target is 08:20 America/Aruba (12:20 UTC). Manual execution before the health window returns `not-due` rather than a false alert.

An unhealthy result produces GitHub-native operational evidence: a failing workflow plus a deduplicated alert issue for the affected date. GitHub alert artifacts are notification/audit surfaces only and are not DEMAC domain state.

## Alternatives considered

| Alternative | Benefits | Costs/risks | Why not selected |
| --- | --- | --- | --- |
| Add another Cloud Scheduler health function | Familiar infrastructure | Same failure domain as the incident; can fail silently together | Does not provide independent detection |
| Add another cron/message sender | Could resend automatically | Creates second producer/authority and duplicate-message risk | Violates single-source and idempotency architecture |
| Only inspect Cloud Scheduler job state | Detects paused/missing job | Does not prove application invocation or WhatsApp delivery | Infrastructure state alone is insufficient |
| Only inspect the batch status | Simple | Batch is a reconciliation snapshot and can be stale after queue delivery | Would create a false second delivery ledger |
| GitHub Actions read-only monitor | Independent failure domain; existing credentials/pattern; auditable | GitHub scheduled runs can be delayed and GitHub is an external dependency | Best fit for independent detection without production writes |

## Consequences

- Positive: missed invocation and late/failed delivery are surfaced independently; no new sender; canonical delivery authority remains unchanged.
- Negative/tradeoffs: GitHub schedules are best-effort and may start later than the nominal minute; the alert channel depends on GitHub availability.
- Security/privacy: diagnostic output is limited to operational date/status/count/reason metadata and must not expose message bodies, customer data, phone numbers, JIDs or secrets.
- Scalability/operations: evaluation works from the batch's queue IDs and is not coupled to exactly four Vans.
- Migration/compatibility: depends on PR #427 heartbeat/queue ID fields; no database migration is required.

## Verification and rollout

- Acceptance evidence: focused evaluator tests for closed day, not-due, missing heartbeat, failed/partial batch, missing/failed queue items, late pending, no-work skip and successful terminal delivery.
- Observability: GitHub workflow conclusion, job summary and one alert issue per unhealthy date.
- Rollback or forward recovery: remove/disable the GitHub health workflow; no DEMAC production data rollback is required. Producer remains unchanged.
- Review date/triggers: review after first controlled production week, any false-positive/false-negative incident, any change to the producer batch schema, queue status model or operating-calendar authority.
