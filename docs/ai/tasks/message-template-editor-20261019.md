# Task: Administrator-editable operational message copy

## Context and scope

The owner requested a System menu section where DEMAC can edit confirmation,
reminder and technician greetings/closing paragraphs and accommodate future message
types. ERP Next now has `/settings/messages`, with 14 existing automated message
types: two customer, seven technician and five Task Tracker variants. Customer
messages retain English, Spanish, Dutch and Papiamento; other types retain their
existing operational language. Future producers are registered in the shared catalog,
not created as disconnected free-form automation from the editor.

Deep Review applies because this introduces an authenticated administrative write
path consumed by multiple notification producers. Solo Maintainer Adversarial Review
is required; owner visual approval is separate from technical verification.

## Authority, rules and boundaries

- The existing transactional communication authority and
  `businessSettings/whatsapp` configuration remain canonical. Authored copy lives
  under `businessSettings/whatsapp/messageCopy/{templateId}_{language}`.
- No additional queue, sender, contact or booking identity. `OPS-TASK-006/007`,
  canonical property/appointment identity and existing recipient/eligibility rules
  remain intact. Task automation activation flags are unchanged.
- `messageCopySettings` validates revoked Firebase tokens and fresh active admin
  profiles. Save rechecks the profile inside the Firestore transaction. Browser
  reads/writes to the subcollection remain denied by existing rules.
- Versioned fields, actor/time, immutable history and request receipts belong to
  this configuration extension. There is no new operational source of truth.
- This is ERP Next functionality; Legacy remains compatible with default messages
  and the same backend. No Legacy screens, security rules, secrets or runtime
  dependencies change.

## Acceptance

- [x] System → Message Templates is restricted to administrators, with server denial.
- [x] Greeting, introduction and closing can be edited independently per language.
- [x] Live preview shares the actual producer composition and uses example data.
- [x] Canonical dates, times, task details and separate address/apartment lines remain
  protected; no HTML, arbitrary fields or unknown placeholder names are accepted.
- [x] Save records a revision and actor; history can be loaded into a draft and saved
  as a new revision; restoring defaults also requires an explicit save.
- [x] Optimistic revisions reject stale writes; exact request receipts make uncertain
  saves safe to retry, including after refresh and temporary loss of permission.
- [x] Existing queued/sent messages are not rewritten or replayed. New enqueues use
  saved copy, with the selected template/version recorded on the queue item.
- [x] Text/attachment order and captions remain unchanged in reference bundles.
- [x] Built-in defaults remain the producer fallback if copy configuration cannot
  be read. The editor blocks malformed stored configuration instead of overwriting it.
- [ ] Business owner validates the interactive preview and authorizes production.

## Limits and failure/recovery

The initial catalog has 20 template/language records. Each field is bounded to
300/1200/1600 characters, HTTP JSON to 12 KB, and history reads to the latest 20
versions. Full immutable history/receipts remain retained for audit and retry safety.
Expected use is occasional administrator copy editing, not bulk messaging. Task
workers reuse the configuration snapshot within each batch; no cross-request cache
delays a subsequent edit. Existing queue throughput and provider quotas are unchanged.
The ERP administrator owns configuration maintenance and existing communication
health monitoring. A configuration-read outage logs only template/language and
falls back to the previous built-in copy; it never retries a sent queue record.

Production uses wacli. Externally approved Meta templates retain their existing
provider contract and cannot be rewritten through this editor. Arbitrary AI replies,
provider-managed authentication email templates and manually composed messages are
outside this operational catalog.

## Release and recovery

This task prepares code and an isolated synthetic preview only. No production
configuration is seeded, no client messages are sent and no historical queue replay
is permitted. After owner approval, prepare a separate controlled release that
verifies the exact deployed bundles and preserves each function's existing
configuration/IAM/schedules. A blanket function redeployment and the previous
appointment-copy release script are not appropriate substitutes.

Affected exports requiring source consideration: `queueAppointmentConfirmation`,
`sendDailyAppointmentReminders`, `sendDailyTechnicianSchedules`,
`notifyBookingReferenceUpdate`, `notifyTaskAssigneeOnCreate`,
`processTaskDeadlineReminders`, `sendDailyTaskSummaries`, and new HTTP
`messageCopySettings`. Audit additional transitive bundle consumers before release.
Deploy the reviewed API/producers before publishing the ERP menu. Verify unauthenticated
and non-admin denial, active-admin list/save/history with a controlled example, and
actual bundle/queue version attribution without contacting customers. Rollback can
restore the prior deployed producer/UI revisions; absent custom config already uses
built-in copy. History remains retained. Do not mutate queue history during rollback.

## Verification

See the separate [review record](../reviews/message-template-editor-20261019.md).
The downloadable interactive HTML bundles the actual React editor and shared
composer with a synthetic local-only API. It demonstrates UI behavior; it is not
evidence of a deployed Firebase endpoint or production permissions.
