# Owner-approved discard-only WhatsApp cutover

Authorization: 19 October 2026 at 09:34:15 Aruba (13:34:15 UTC). The owner explicitly
authorized deploying the fix and removing all older queued messages without sending them.
This replaces the earlier proposal to recover accumulated messages.

## Production outcome

Completed successfully on 19 October 2026 at 09:54:38 Aruba (13:54:38 UTC).
[Release run 39263814043](https://github.com/demac-aruba/demac-corporation/actions/runs/39263814043)
used release commit `6b21444c1ebe8f41c53b4acb082c4e81175574f0` and reviewed runtime
commit `51225bcc1370b9ad424823d3d91496c508b37971`, merged in
[PR #605](https://github.com/demac-aruba/demac-corporation/pull/605).

- Atomically removed the sending payloads of **133 old queue records** at 09:53:04 Aruba:
  52 queued and 81 failed. One obsolete recipient lock was released. Minimal cancelled
  tombstones prevent old event retries from recreating these records. A queue record can
  contain multiple message parts; 133 is not an individual-message count.
- Preserved sent history. No new record existed at cutover; new records remain eligible.
- Deployed only `wacliOutboundPoll`, revision `waclioutboundpoll-00028-xoz`, replacing
  `waclioutboundpoll-00027-leh`. The deployed two-file source matched the reviewed commit.
  The live dependency lock and runtime configuration were preserved.
- The bridge successfully polled at 09:54:37 Aruba, with no outbound error and zero pending
  ACKs. An invalid bearer was rejected with HTTP 401. Peer functions and Scheduler were
  unchanged.
- Final query found **zero old unsent records and zero old records sent after the cutoff**.
  There were zero new sends and zero new pending records at verification. Therefore this
  confirms restored backend polling and eligibility for new work, not a real new delivery.

The cutoff is creation time strictly before `2026-10-19T13:34:15.000Z`; records at or
after it are preserved. No old customer confirmation, technician agenda or attachment was
replayed. No synthetic message was sent. Future delivery still depends on provider availability.

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
- A fifth release regression verifies that the SSH health script receives stdin and that
  importing the command wrapper does not perform external operations.
- Existing bundle tests plus owner-discarded dependency/recipient isolation regression pass.
- Existing 23 prevalidation, 133 transactional and 37 reference/gateway/media tests are the
  mandatory Node 22 release gates; none may be skipped.
- Syntax, workflow YAML parsing and whitespace checks pass.
- No test or diagnostic sends WhatsApp messages to customers or technicians.

The successful Node 22 release ran **198 tests**, zero failures: five cutover/release,
23 prevalidation, 133 transactional, and 37 reference/gateway/media. It additionally
installed the exact production lock in a separate validation directory, passed the focused
bundle/gateway/media suites against it, and verified the real public SDK project-discovery
call with project environment variables removed. The uploaded production source did not
include this validation directory or a dependency upgrade.

Earlier preflight attempts stopped before queue reads/writes or deployment. The health
probe exposed a child-process stdin configuration error, which was reproduced and fixed
with a regression test. A subsequent comparison found production dependencies differ from
the repository. The release therefore preserved the live lock and added exact-live testing;
it did not replace production dependencies or waive the required tests.

Concurrency review: a competing claim changes the transactional read and causes a retry;
the in-flight check then blocks withdrawal. No transaction writes occur before all reads.
An oversized queue or changed dry-run fingerprint stops before mutation. Payload removal
is intentional and authorized; recovery must never restore discarded message content.
If deployment fails after withdrawal, old content stays cancelled and the release can be
rerun. New pending records remain preserved. No automatic rollback can reintroduce old work.

Residual risk: successful submission of a new message still depends on WhatsApp availability.
The release verifies backend/bridge operation and checks for natural new sends; it does not
manufacture a customer appointment or send a synthetic customer message. The existing retry,
trigger-coupling, delivery-health and inbound-dead-letter findings in the incident report
remain separate follow-up work. No failure-proof or exactly-once guarantee is claimed.
