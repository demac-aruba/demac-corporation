# DEMAC Van Daily Schedule Delivery Architecture V1

Status: proposed in PR #427; not production-active until the production deployment and Scheduler verification complete successfully.

## Objective

Deliver each active Van's daily Work Orders to its configured WhatsApp group at 08:00 America/Aruba on open DEMAC business days, with deterministic recovery ticks at 08:05 and 08:10, without duplicate messages or parallel sources of truth.

## Root cause addressed

The application producer and the scheduled infrastructure could drift apart: the Cloud Function could remain deployed and ACTIVE while the Cloud Scheduler trigger was missing, paused, misconfigured, or not governable by the deployment credential. The previous batch record also treated successful queue insertion as completed delivery, which could hide downstream transport failures.

## Canonical flow

Cloud Scheduler
→ `sendDailyTechnicianSchedules`
→ `createTechnicianDailyScheduleRunner`
→ Operating Calendar + Work Orders + Vans
→ `createTechnicianDailyScheduleService`
→ `whatsappOutboundQueue`
→ canonical transactional provider (`wacli` unless business settings explicitly select another supported provider)
→ provider acknowledgement / receipt state

No second cron, second WhatsApp queue, second sender, technician-phone fallback, or runtime JID realignment is part of this architecture.

## Sources of truth

### Schedule configuration

`functions/vanScheduleDeliveryConfig.js` owns the application/deployment constants for:

- scheduled function name;
- region;
- timezone;
- cron expression;
- expected Firebase Cloud Scheduler job name;
- automatic delivery key/reason/model identifiers.

`operatingCalendarService.TIME_ZONE` remains the canonical company timezone source and is consumed by the Van schedule config.

### Business-day decision

`operatingCalendarService` is authoritative for open/closed DEMAC dates. The scheduled producer must not maintain a second holiday/weekend rule.

### Daily work

`workOrders` is the operational source for the work assigned to a Van on a date. The Van schedule service only consumes active Work Orders under its existing status rules; it does not create an alternative schedule ledger.

### Van to WhatsApp destination

The active canonical Van record in the `vans` collection is authoritative for:

- `whatsappScheduleGroupJid`;
- `whatsappScheduleGroupName` as an optional display label;
- `scheduleDeliveryEnabled`.

Crew names, group labels, historical mappings, migrations, and code constants must never be used at runtime to move a WhatsApp JID from one Van to another.

### Delivery truth

`whatsappOutboundQueue` is authoritative for the delivery state of each produced message.

Terminal success states currently recognized by the Van runner are `sent`, `delivered`, and `read`. `queued` and `processing` are pending states. `failed` and `cancelled`, missing queue records, and unknown states are not successful delivery.

`technicianDailyScheduleBatches/{date}` is an operational heartbeat and last-reconciliation snapshot. It proves whether the scheduled producer was invoked and records the latest state observed by a runner invocation. It is not a second message-delivery ledger and can lag the queue if a provider acknowledgement arrives after the final recovery tick.

## Idempotency

Automatic messages use deterministic queue IDs through the existing daily schedule service with delivery key `auto`.

The 08:00, 08:05, and 08:10 invocations therefore reconcile the same logical queue records instead of generating duplicate WhatsApp messages. A deterministic queue record that already exists is never assumed successful solely because it exists; its current queue status is inspected.

Manual `send_van_schedules_now` requests remain separately idempotent through their stable request ID and `manual-<requestId>` delivery key.

## Concurrency

Batch completion is monotonic. Once one invocation has persisted `complete`, a concurrent or late failing invocation may not downgrade the batch to queued, partial, failed, or skipped.

Firebase documents that scheduled function executions can overlap, so this rule is required rather than optional.

## Observability

Every scheduled invocation writes heartbeat evidence before the business-day decision:

- `runDate`;
- delivery model;
- invocation timestamp/count;
- Scheduler job name when present;
- Scheduler schedule time when present.

Open-day attempts additionally record queue IDs, work-order/message counts, delivered/pending/failure counts, failure details, attempt count, and reconciliation timestamps.

A missing batch on an expected open day therefore means the scheduled producer did not enter its normal application path.

## Deployment governance

The transactional producer workflow must:

1. validate the producer boundary and focused regression tests;
2. authenticate the configured deployment identity;
3. read canonical schedule configuration from `vanScheduleDeliveryConfig.js`;
4. prove Cloud Scheduler is readable before changing production;
5. deploy the existing notification producers through Firebase CLI;
6. verify the deployed functions are ACTIVE;
7. verify the exact canonical Scheduler job exists, is ENABLED, has the expected cron/timezone, and has an HTTP target and OIDC invoker.

A paused Scheduler job is not silently resumed by deployment. A pause is an operational state that requires investigation.

Historical data migrations must not run on every ordinary application deployment.

## Infrastructure prerequisite / blocker

The current GitHub Firebase deployment credential previously failed `cloudscheduler.jobs.list`. Until the deployment identity has effective Cloud Scheduler management capability, the production deploy must fail closed before deploying the scheduled producer.

Google Cloud's predefined `roles/cloudscheduler.admin` includes create, update, delete, get, list, enable/pause/run and related Scheduler permissions. An approved equivalent custom role may be used if DEMAC later standardizes a narrower deployment role. Service-agent roles must not be granted to the GitHub deployment principal.

Longer-term security hardening should move GitHub deployment away from a general Firebase Admin SDK service account to a dedicated CI/deployment service account with only the roles needed for the governed deployment boundaries.

## Removed / consolidated behavior

This architecture removes from the normal production path:

- runtime JID realignment based on technician/group names;
- hardcoded crew-name defaults inside the daily schedule producer;
- recurring execution of historical Van-group and Meta→wacli migrations during ordinary producer deploys;
- the completed 2026-08-22 one-time sender;
- live WhatsApp group probe workflow/script;
- probe-confirmed JID correction workflow/script.

Historical migration modules that remain in the repository are explicit legacy tools only and are not runtime authority.

## Testing required before integration

At minimum:

- syntax checks for producer/config/authority boundaries;
- runner tests for schedule-time date selection;
- closed date;
- no active Work Orders;
- queued vs delivered state;
- failed existing deterministic queue item;
- producer rejection;
- repeated recovery tick idempotency;
- concurrent completion monotonicity;
- Van configuration transaction behavior;
- duplicate enabled JID rejection;
- Booking Authority Van identity regression tests;
- Office Booking Authority communication regression tests;
- TypeScript/web build validation;
- production deployment preflight;
- post-deploy exact Cloud Scheduler verification;
- controlled production execution evidence before declaring the automatic 08:00 delivery repaired.

## Rollback

Application rollback is the PR's pre-change `main` commit. If a production deployment introduces a regression, revert the application commit and redeploy the previously known-good notification producer code.

Do not manually invent a replacement Cloud Scheduler job or a second sending path as rollback. Scheduler state should be repaired through the governed Firebase deployment path after the deployment identity and infrastructure state are understood.

## Known limitations / technical debt

- The broader Booking Van identity model still explicitly recognizes the current physical VAN-1 through VAN-4 fleet. This predates this repair and must be generalized as a separate fleet-scalability change because it affects booking/capacity architecture beyond WhatsApp delivery.
- `technicianDailyScheduleBatches` is a last-observed snapshot, not asynchronous provider truth. If delivery acknowledgement arrives after the last scheduled reconciliation, `whatsappOutboundQueue` remains authoritative.
- Independent post-08:10 health alerting is still required so an absent/failed batch is surfaced proactively rather than discovered by a technician. That monitor must be independent of the same Cloud Scheduler failure domain and must not become a second message producer.
