# Task: Govern recovery-offer queue production and transport claims

## Context and authorization
- Owner: Christian, continuation of Maya development; explicitly NO MERGE without his approval.
- Parent: PR #490 at `0f5ca7157ad6b68d5202528325d0169c95af84db`.
- Delivery: PR #491, `feature/maya-recovery-outbound-20260908`.
- Surface: privileged Functions; existing WhatsApp queue, Wacli poll/ACK and recovery offer service. No new UI or runtime.
- No merge, deployment, production configuration/security/secret changes, customer messages, live appointments or operational demo data were performed.

## Implemented scope
- A deterministic offer-version producer writes only the existing `whatsappOutboundQueue`, mutable delivery metadata on the existing `bookingOffers` document, and a contact cooldown timestamp on the canonical conversation. The producer accepts only offer ID/version; recipient and text come from the verified immutable offer.
- Outreach requires `recoveryOutreachEnabled=true` and an explicit `recoveryContactPolicy` with version, Wacli provider, `America/Aruba` timezone, weekly contact windows, cooldown and minimum remaining response time. Missing/invalid policy fails closed. No values were written to production; test values are not approved business hours or policy.
- Existing offer/reply/selected-phone/ownership/account controls remain. A fresh check of source evidence, reviewed history, CRM/property, unchanged original appointment, full workload, route, crew and released capacity runs before enqueue and again in the existing Wacli poll transaction.
- Recovery queue IDs start with `MRO-`; either this prefix or any recovery metadata invokes the stricter claim boundary. Relabeling a recovery item as transactional or stripping its recovery fields cannot bypass this boundary for a prefixed item.
- The claim records a fingerprint of the exact outbound payload. ACK validation and later delivery proof check that this payload did not change after the claim. A lost/expired recovery claim is not blindly retried; uncertain physical delivery requires reconciliation. Ordinary transactional/conversational behavior is not given this recovery-only retry policy.
- Delivery proof now matches the real gateway contract: canonical `queue.messageId` and separate `queue.providerMessageId`. A governed ACK records a shared server-observed `recoveryAcknowledgedAtIso` on the original message and queue. This is explicitly an acknowledgement time, NOT an invented WhatsApp/provider timestamp.
- The existing ACK handler materializes the canonical outbound message and attempts to bind that exact delivery to the offer after committing transport evidence. Failed or stale binding does not change a successful transport ACK into a resend-triggering error.
- A recovery ACK preserves an operator's ownership/status and unread count. Conflicting original messages are rejected instead of overwritten. Repeated identical ACKs do not create another original message or alter the original delivery proof.
- Governed delivery proof cannot fall back to the legacy timestamp path if its ACK/claim metadata is removed. It remains tied to the offer-to-queue pointer, recipient, policy, exact payload and valid claim/ACK chronology.

This slice does not invoke the producer from automatic cancellation discovery, candidate ranking or a customer-runtime tool. The existing internal acceptance service is composed with the real poll/ACK code in tests, but the conversational routing and automatic end-to-end agent loop are still unfinished.

## Authority and business rules
- Communication Authority owns provider/account/outbound delivery; the existing Wacli queue/poll/ACK remain singular.
- Booking Authority remains the sole scheduling/capacity/lifecycle authority. The producer and claim never reserve or modify an appointment.
- `communicationCases` remains derived waiting-preference workflow, not a second schedule, customer directory or source of financial truth.
- Affected families: COMMS current-turn/ownership/no-invention; OPS-ROUTE/OPS-TEAM/OPS-SVC; canonical Customer/Property/message identity and source proof.
- No new collection, public endpoint, deployed Function, sender, queue, model provider, security rule or source of truth.
- The canonical provider remains configured Wacli. This change does not switch to Meta or claim compliance with a different provider's messaging policy.

## Verification evidence
Last source/test revision: `2ce90585c367c8163e6cc67ddd36d46866b1a9f2`.
The documentation commit is separate; the exact final delivery HEAD and its final run IDs are recorded in PR #491.

On that source/test revision, all five triggered PR workflows passed:
- Customer Agent Architecture: `34233964054`.
- WhatsApp wacli Connector: `34233964041`.
- Transactional WhatsApp: `34233964174`.
- ERP Next CI: `34233964132`.
- TypeScript/web build: `34233964082`.

The existing required command includes `mayaRecovery*.test.js`, so the three new suites run alongside all retained waiting/history/offer/matching regressions:
- `mayaRecoveryOutbound.test.js`: immutable/idempotent enqueue; actual Wacli claim; after-enqueue revocation; account/ownership/source/capacity changes; contact policy/cooldown/expiry; class/recipient/text/version mutation; uncertain-send retry denial; ordinary transport retry preservation; atomic rollback and transient storage errors.
- `mayaRecoveryTransport.test.js`: real exported HTTP ACK handler with mocked Firebase persistence, synthetic authenticated requests and clock; canonical IDs; queue/poll/ACK/binding/accepted earlier appointment composition; replay; invalid IDs/auth; conflicting messages; operator takeover/unread preservation; ACK lag; no fabricated provider timestamp; MIME regression.
- `mayaRecoveryDeliveryReview.test.js`: changed claimed payload/recipient/policy/chronology; removed ACK metadata cannot fall back to legacy proof; missing offer-to-queue pointer.

The retained canonical Booking Authority, Office, commercial, reservation, formatting, Customer Agent and single-router checks remain. Required tests were not disabled, waived or removed. The older delivery fixture was corrected to use the actual distinct canonical/provider ID fields, retaining its existing assertions.

Tests use real domain modules and the real Wacli poll/HTTP ACK code, but synthetic in-memory persistence, injected semantic results, fake token values, simulated clock and fake request/response objects. No actual provider/device/network delivery, live model interpretation, production-data, Firestore-emulator/index or true distributed-contention evidence is claimed. Local repository cloning could not resolve GitHub; no local full-repository verification is claimed. No UI changed, so this slice adds no browser-preview claim.

## Separate Solo Maintainer Adversarial Review
Review mode: Solo Maintainer Adversarial Review, NOT independent review. The same assistant implemented and then separately reviewed the changes.

The review re-read the request and inspected the final changed-file scope, gateway/service patches, producer and policy invariants, existing fixture contract, canonical ACK shape and affected callers. It challenged changed state between preparation/enqueue/claim/ACK/acceptance, payload mutation, failure atomicity, duplicate delivery and observer/operator ownership.

| Finding | Correction/evidence |
| --- | --- |
| #490 assumed a provider ID in queue.messageId, unlike the real ACK. | Distinct canonical/provider ID checks; existing fixture aligned; actual ACK-to-acceptance composition passes. |
| ACK-only records do not have an original provider timestamp. | Explicit server acknowledgement time basis; no fabricated provider time. Earlier-than-ACK replies remain a conservative reconciliation case. |
| A queue payload could change after claim and before ACK. | Claim fingerprint; ACK rejection and later proof validation; regression tests. |
| A recovery ACK arriving during operator work could clear unread/status state. | Recovery-only preservation of current status/unread; ownership remains untouched; negative takeover test. |
| Removed/changed ACK metadata could otherwise use an older proof path. | Governed offers require their claim, queue pointer and both ACK timestamps; dedicated fallback-denial test. |
| Full-file editing briefly altered an existing audio MIME accessor. | Original accessor restored; ingress MIME regression passes. |
| A cache return expression uses the compared input URL rather than the equal stored URL. | Verified equivalent under the enclosing strict equality condition; no cache behavior change or added provider call. |

Decision: implemented bounded transport slice with automated evidence; suitable for continued isolated development. **BLOCKED for main/parent merge, production activation and complete-Maya status.** Christian's explicit approval remains required for any merge and applicable production actions.

## Residual risks and required follow-up
1. Wire cancellation-triggered discovery/history review/candidate selection to the producer with approved ranking and contact policies. The internal producer is not an active autonomous scan.
2. Integrate offer response routing in the single Customer Runtime/orchestrator before ordinary Observer/dispatch-hold effects. Add final confirmation proof, clarification/multi-message responses and safe ACK-lag recovery. Current first-next-inbound binding intentionally fails closed.
3. The database claim is not physically atomic with delivery by the external bridge. Revocation, expiry or occupation after the bridge has received a command remains a rollout risk. No exactly-once external delivery or device-time revocation guarantee. Uncertain first attempts currently require reconciliation rather than automatic resend; later ACK recovery needs completion.
4. Complete/verify canonical remote-conversation materialization with actual devices, including alternate provider identifiers, webhook/ACK ordering, and duplicate outbound observations. Current tests do not establish this live identity parity.
5. Preserve bounded offer-generation history and complete reminder suppression/update, fulfilled waitlist presentation, unbooked service/workload capture, richer time preferences/subwindows and Papiamento offer rendering.
6. Reconcile the full parent stack with current main; run integrated emulator/security/index/concurrency and authorized live new-contact/voice/offer tests. Existing provider reads still include broad master/queue scans and need scalability validation before broad rollout.

Owner of remaining implementation: project maintainer; live business policy/merge/deployment approvals: Christian. No deadline or automatic activation is implied.

## Rollback
No production action occurred. Revert/discard the isolated slice to remove it. Future authorized rollout must keep outreach disabled until its policy and live boundaries pass. Turning it off must not delete source messages, delivery history or existing appointments.
