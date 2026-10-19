# Owner-approved discard-only WhatsApp cutover

Authorization: 19 October 2026 at 09:34:15 Aruba (13:34:15 UTC). The owner explicitly
authorized deploying the fix and removing all older queued messages without sending them.
This replaces the earlier proposal to recover accumulated messages.

## Task and acceptance

Deep Review; Communication Authority remains the existing outbound queue. No appointment,
customer, work-order, finance, recipient mapping, IAM, secret or scheduler mutation.
All unsent `queued`, `processing` and `failed` records created before the authorization
cutoff are excluded from delivery. Unknown creation times are treated as old. Records
created at/after the cutoff and sent history are preserved. An in-flight old record blocks
the operation; it is never silently discarded while a send may be occurring.

## Implementation

The runner first verifies the exact reviewed source and downloads the current poll source.
It preserves that live archive, including its dependency lock and unrelated files, and
overlays only `whatsappWacliGateway.js` and `whatsappReferenceBundle.js`.

The queue operation has a default dry-run and a separate execution flag. Its fingerprint
is rechecked in a single Firestore transaction before any write. The bounded transaction
reads all candidate records, recipient locks and its audit marker before writing. It removes
old message bodies, attachments, media capabilities and sending claims. A minimal cancelled
record retains its idempotency ID and routing identity, so an old event cannot recreate the
same queued message and a new same-recipient dependency can pass the discarded item.
Only this specific owner-cutover cancellation releases a dependency; arbitrary cancellation
or a different recipient does not. Retired records cannot be selected by existing retry APIs,
which accept failed records only. An internal incident audit records counts and authorization.

This atomic queue withdrawal is the delivery barrier. No unsupported service stop or sudo
permission change is used. It completes before the corrected function can resume dispatch.
The bridge must have no pending ACK, and any old processing record causes a fail-closed stop.
After the transaction there are no earlier eligible queue payloads left to send. A repeated
execution is safe and does not remove new records.

Deploy only `wacliOutboundPoll`. Preserve runtime settings, credentials, IAM, instance limits,
memory, timeout and Scheduler. Verify deployed source, unchanged runtime configuration,
unchanged peer function revisions, successful authenticated bridge polls, rejection of an
invalid bearer, no older remaining unsent records, and no old record sent after the cutoff.

## Verification and separate adversarial review

Mode: Solo Maintainer Adversarial Review, not independent review. Fresh pass after coding
covered the full helper, release driver, workflow, gateway dependency handling and callers.

- Four cutover tests pass: exclusive cutoff/missing timestamp, read-only dry-run and
  idempotent apply, changed/in-flight queue rejection, and complete removal of sending content.
- Existing bundle tests plus owner-discarded dependency/recipient isolation regression pass.
- Existing 23 prevalidation, 133 transactional and 37 reference/gateway/media tests are the
  mandatory Node 22 release gates; none may be skipped.
- Syntax, workflow YAML parsing and whitespace checks pass.
- No test or diagnostic sends WhatsApp messages to customers or technicians.

Concurrency review: a competing claim changes the transactional read and causes a retry;
the in-flight check then blocks withdrawal. No transaction writes occur before all reads.
An oversized queue or changed dry-run fingerprint stops before mutation. Payload removal
is intentional and authorized; recovery must never restore discarded message content.
If deployment fails after withdrawal, old content stays cancelled and the release can be
rerun. New pending records remain preserved. No automatic rollback can reintroduce old work.

Residual risk: successful submission of a new message still depends on WhatsApp availability.
The release verifies backend/bridge operation and observes natural new sends; it does not
manufacture a customer appointment or send a synthetic customer message. Runtime results
will be recorded in the release summary and final incident report.
