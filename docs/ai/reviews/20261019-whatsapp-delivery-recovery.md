# WhatsApp delivery recovery — 19 October 2026

## Task and evidence

Owner requested an audit of missing appointment confirmations and technician schedules,
then authorized continuing the read-only production investigation and reliability work.
Deep Review. Baseline main: dccb8b43772a03714acb90db61d34cbd25bbca63.
Production ERP: https://demac-aruba.com/scheduling/.

The read-only audits are on `chore/whatsapp-incident-audit-20261019`; diagnostic workflows
and their credentials are deliberately excluded from this repair branch.

Confirmed runtime evidence, 19 October, 09:20 Aruba / 13:20 UTC:

- Scheduler is enabled at 08:00, 08:05 and 08:10, America/Aruba.
- The 08:00 batch queued 17 records and marked generation complete. This is not proof
  that any WhatsApp was sent. All 38 pending records carrying today's schedule date
  had zero delivery attempts at the 09:16 snapshot.
- There were 52 queued records in total, including a customer confirmation. The oldest
  pending creation was 17 October at 12:39 Aruba. These are queue records, not necessarily
  individual WhatsApp messages: an attachment bundle contains multiple parts.
- Bridge and sync services were active. No ACK backlog. Last successful outbound poll
  was 08:11:51 Aruba and last successful send was 08:11:54; subsequent polling failed.
- The last 20 application errors all reported missing Firebase project identity at
  `whatsappWacliGateway.js:594`. The running poll function had neither `GCLOUD_PROJECT`
  nor `GOOGLE_CLOUD_PROJECT`, nor a project ID in `FIREBASE_CONFIG`.
- Firestore was accessible and resolved the expected project. The defect was the media
  URL builder's environment-only lookup, not a demonstrated WhatsApp login failure.

Evidence: [initial audit](https://github.com/demac-aruba/demac-corporation/actions/runs/39252900340),
[current queue and bridge](https://github.com/demac-aruba/demac-corporation/actions/runs/39258643408),
[source location](https://github.com/demac-aruba/demac-corporation/actions/runs/39258886301),
[confirmed error and configuration](https://github.com/demac-aruba/demac-corporation/actions/runs/39259223058).
Outputs contain aggregate metadata and error categories, not customer data or secrets.

## Scope and governance

Communication Authority and the existing `whatsappOutboundQueue` remain authoritative.
`OPS-SCHED-REFERENCES-001` requires ordered Work Orders and attachments; temporary
delivery failures retain the current part, and other recipients must remain available.
Booking Authority, recipient selection, scheduling, roles, finance, existing ACK semantics,
provider configuration and private media authorization are unchanged.

In scope: project resolution, bounded failure isolation and regression coverage.
Out of scope: production deployment, resend, queue edits, merges, account/configuration
changes and a new communication authority. Legacy and ERP Next use the same fixed backend.
No migration or new architectural decision is needed.

Acceptance criteria:

- [x] Private media can be claimed when the runtime project environment variables are absent.
- [x] Project discovery uses the existing Admin Storage client's public `getProjectId()` API.
- [x] Successful discovery is cached; rejected or stalled discovery can recover on a later poll.
- [x] Discovery is bounded to 1.5 seconds and attempted at most once per poll on failure.
- [x] A deferred attachment does not consume an attempt or lose its cursor, claim or ordering.
- [x] Other recipients can progress when project discovery fails.
- [x] Unauthenticated bridge requests do not discover projects or modify the queue.
- [x] Existing media authorization, ACK replay and sequential bundle tests still pass.

## Implementation and verification

The SDK already discovers project identity for authenticated Google Cloud clients. Reuse
the Admin Storage client's public project resolver instead of requiring optional environment
variables or adding credentials/dependencies. Validate the result before constructing the
fixed Cloud Functions hostname. Successful discovery is cached per process; a failure or
timeout clears the cache. A poll memoizes its failure and continues with other recipients.
Log one sanitized error code per minute per instance when resolution is unavailable.

Two new end-to-end gateway regression scenarios first failed against the unmodified code
with HTTP 500, reproducing the incident. The fix passes those and three additional cases:
stalled discovery recovery, invalid project hostname rejection, and authentication denial.

Local Node 24.19.0 verification (production target Node 22):

- `npm run validate:firebase --prefix functions`: PASS, including 23 required prevalidation tests.
- `npm run test:transactional-whatsapp --prefix functions`: 133 PASS, zero failed/skipped.
- Five reference/gateway/media test files: 36 PASS, zero failed/skipped.
- `git diff --check`: PASS.
- Node 22 validation: pending branch CI before release approval.

## Separate Solo Maintainer Adversarial Review

Mode: Solo Maintainer Adversarial Review, not independent review. Implementer/reviewer:
Codex in separately performed implementation and adversarial review passes.

Reviewed the complete repair diff and poll, ACK, private-media, queue producer and bridge
callers. Challenged the incident reproduction, timeout/cache rejection behavior, candidate
ordering, authentication and disclosure boundaries. This change does not claim or fail a
deferred part. Existing per-recipient reservations and dependency checks still prevent a
later message from overtaking its unfinished attachment. No automatic text retry or queue
recreation was added, so ambiguous provider sends do not receive a new retry policy here.
The SDK call is bounded; its eventual late completion cannot overwrite a newer cache.

Decision: prepared for review, production activation blocked pending owner authorization
and review of the accumulated queue. No production repair has been claimed.

## Release and recovery boundary

The necessary runtime change is source deployment of **wacliOutboundPoll only**. Preserve
its runtime identity, environment, secrets, IAM, timeout and memory. No bridge restart,
frontend deployment, Scheduler change, Firestore rule change or data migration is needed.
Verify the deployed source matches the reviewed commit and runtime configuration is
unchanged. Observe fresh successful polls, absence of the project-identity error, queue
progress, ACKs and successful media retrieval after authorized activation.

Deploying this function would allow the existing bridge to resume the pending queue
automatically. Old and potentially repeated schedule entries must be reviewed first;
do not use "Send schedule" again as a workaround. Any suppression/cancellation/resend
requires a separately authorized, bounded plan with current state checks and an audit trail.
Rolling back source would restore the defect; use forward recovery if verification fails.

## Additional audit findings and residual risks

1. Daily batch `complete` currently means queue generation completed. Recovery ticks do
   not reconcile delivery. Track delivery health separately without re-enqueuing work.
2. The shared Work Order trigger does not retry automatically; a same-day technician
   enqueue error can prevent the customer confirmation producer from running. A separate
   change needs stale-event and idempotency tests before enabling retries.
3. Ordinary text failure is terminal on its first negative ACK; bundles have bounded
   retry. A future retry policy must distinguish known failures from ambiguous sends.
4. Bridge `/health` can report `ok: true` while outbound polling is stale/erroring. Monitor
   last successful poll, oldest pending age and failure state, rather than service liveness alone.
5. The bridge reported 146 inbound dead-letter events. They were not replayed and are not
   the confirmed cause of this outbound incident.

No live delivery test or production deployment was performed. Provider availability and
crashes between external send and durable acknowledgement remain existing residual risks;
no exactly-once or failure-proof guarantee is made.
