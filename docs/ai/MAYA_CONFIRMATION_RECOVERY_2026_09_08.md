# Task: Confirm a committed earlier-appointment move without repeating it

## Context and authorization
Christian authorized continued Maya development, explicitly not merge or production activation. Parent: PR #493, commit 693ee785175e875f5cd0376fe56d12ce6f2205c6. Work only on feature/maya-confirmation-recovery-20260908. No production read/write, deployment, secret/rules/settings change, message or operational demo insertion is authorized by this task.

## Scope
- Recover the exact committed earlier-offer acceptance before another model attempt and after a model failure.
- Render the final confirmation from the canonical appointment and complete accepted source evidence, never an unverified draft.
- Use the existing Communication Authority outbound queue, current-turn processor and bridge claim/ACK path. No new queue, sender, agent, endpoint or domain authority.
- Recheck current authorization, Customer/Property identity, source evidence, appointment, Work Orders and capacity at enqueue and claim.
- Preserve one confirmation identity per canonical source; uncertain physical delivery must not cause a blind retransmission.
- Keep ordinary messages on their existing path. The parent offer and response controls remain intact.

Out of scope: automatic cancellation discovery/ranking, arbitrary clarification conversations, unbooked workloads, reminders, main reconciliation and live pilot activation. English/Spanish confirmation rendering initially; Papiamento still requires reviewed language coverage.

## Authorities and protected rules
Booking Authority remains the only appointment/capacity writer. Original WhatsApp messages and existing offer completion receipts are evidence; confirmation metadata is a derived pointer, not a second appointment state. Communication Authority owns queue/transport, account and ownership epochs. Session updates use the existing session service contracts. COMMS current-turn/one-confirmation/no-invention and OPS-ROUTE/OPS-TEAM/OPS-SVC invariants remain unchanged.

New recoveryConfirmationEnabled permission defaults closed. No test flag value is a production setting. Revocation may suppress a confirmation but must never roll back or repeat an already committed move. A newer customer turn, takeover, changed appointment or unverifiable receipt requires reconciliation, not a stale success message.

## Acceptance criteria
- A committed acceptance can produce the same factual confirmation without another model or scheduling call.
- Failure before commitment cannot generate a successful confirmation; failure after commitment can recover only the exact canonical result.
- Enqueue/claim reject forged text, stale source, wrong recipient/account, revoked pilot, changed CRM/work/capacity, wrong version and malformed completion.
- Repeated calls use the same existing queue record. Do not create a second confirmation when another reply already exists for the same input.
- Queue/session/conversation completion is transactional; storage failure leaves no partial outbound publication. All reads precede writes.
- Transport ACK records what was sent without erasing unread/customer/operator state; an unconfirmed previous attempt is not blindly resent.
- No applicable test is disabled, weakened, deleted or waived.

## Verification plan
Run retained Maya/recovery/Booking/communication suites and relevant syntax/build checks. Exercise actual current-turn queue handling and actual bridge claim/ACK with synthetic in-memory records and scripted transport/model responses. Explicitly separate simulation from live device/model/emulator evidence. Inspect exact-head CI and deployment conditions. Fresh Solo Maintainer Adversarial Review (not independent review) must inspect full diff, affected callers, authorization, retries, stale state, transport uncertainty and failure atomicity.

Local clone failed DNS resolution; do not claim local whole-repository or emulator verification. Firebase transaction contract consulted: https://firebase.google.com/docs/firestore/manage-data/transactions (read-before-write and retry-safe callbacks).

## Delivery / review
Implementation and tests in progress. Keep draft; not merge-ready. Final findings, verification and residual risks to be recorded after review.
