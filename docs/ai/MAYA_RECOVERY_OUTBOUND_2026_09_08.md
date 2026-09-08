# Task: Govern recovery-offer queue production and transport claims

## Context and authorization
- Owner: Christian, continued Maya development; explicitly NO MERGE without his approval.
- Parent: PR #490 at `0f5ca7157ad6b68d5202528325d0169c95af84db`.
- Delivery: PR #491, `feature/maya-recovery-outbound-20260908`.
- Surface: privileged Functions, existing WhatsApp queue, Wacli poll/ACK, waiting-source evidence and recovery offer service. No new UI or runtime.
- No merge, deployment, production configuration/security/secret changes, customer messages, live appointments or operational demo data were performed.

## Implemented scope
1. A deterministic offer-version producer writes only the existing `whatsappOutboundQueue`, mutable delivery metadata on `bookingOffers`, and a cooldown timestamp on the canonical conversation. It accepts offer ID/version only; recipient and message come from the verified immutable offer.
2. Outreach requires `recoveryOutreachEnabled=true` and an explicit `recoveryContactPolicy`: version, Wacli provider, `America/Aruba` timezone, weekly contact windows, cooldown and minimum remaining response time. Missing/invalid policy fails closed. No production values were changed; fixture values are not approved business policy.
3. Current reply/selected-phone/ownership/account/offer controls remain. Original-message evidence, reviewed history, CRM/property, unchanged original appointment, full work, routes, crew and released capacity are checked before enqueue and again in the existing Wacli claim transaction.
4. Recovery queue IDs use `MRO-`. That prefix OR recovery metadata invokes the stricter claim boundary, including items relabeled as transactional or stripped of recovery fields while retaining their recovery ID.
5. The claim fingerprints the exact payload. ACK validation and later delivery proof reject post-claim changes. A lost/expired first recovery claim is not blindly retransmitted; uncertain physical delivery requires reconciliation. Ordinary message retry policy is preserved.
6. Delivery proof matches the real gateway contract: canonical `queue.messageId` plus separate `queue.providerMessageId`. A governed ACK stores matching server-observed `recoveryAcknowledgedAtIso` on message and queue. This is acknowledgement time, never an invented provider timestamp.
7. The existing ACK handler materializes the canonical message and then attempts to bind its exact delivery to the offer. Failed/stale binding does not turn a successful transport ACK into an error that encourages a resend. Operator ownership/status and unread count are preserved for recovery ACKs; conflicting original messages are not overwritten.
8. Governed delivery proof cannot fall back to an older timestamp path when ACK/claim metadata is missing. It remains bound to the offer-to-queue pointer, recipient, policy, payload and valid claim/ACK chronology.
9. Direct waiting capture now stores a fingerprint of the COMPLETE normalized original message/transcript, not merely the quoted prefix. Replay cannot refresh this proof silently after an edit. The outbound checks compare the complete source fingerprint at enqueue and claim; an edited suffix such as 'actually no' invalidates the request even when the earlier positive quote remains. The immutable offer preference fingerprint includes this proof.
10. A direct preference without this new source proof cannot authorize outreach. It needs fresh evidenced capture or the existing full historical review, not automatic backfill. Reviewed historical interests continue to use the existing complete reviewed-message window proof. No source text is duplicated by the new fingerprint.

The producer is an internal service, not yet invoked by automatic cancellation discovery/ranking or the Customer Runtime. Tests compose the real poll/ACK code and internal acceptance service; conversational routing and the autonomous loop remain unfinished.

## Authority and rules
Communication Authority owns the one provider/account/queue/poll/ACK path. Booking Authority remains the only scheduling/capacity/lifecycle authority. Enqueue and claim never reserve or change appointments. Existing `communicationCases` remain derived waiting workflow. Affected families: COMMS current-turn/ownership/no-invention, OPS-ROUTE/OPS-TEAM/OPS-SVC, canonical Customer/Property/message identity.

There is no new collection, public endpoint, deployed Function, sender, queue, model provider, security rule or source of truth. The direct-capture addition is evidence metadata, not another customer or scheduling model. Wacli remains the configured transport; this code does not switch to Meta or claim a different provider's messaging compliance.

## Acceptance and exact verification
Last source/test revision: `4dbee657b52a45c4a2c34ce5105caa686c1639d4`.
The final documentation commit is separate; its exact HEAD and final CI run results are recorded in PR #491.

All six triggered PR workflows on the source/test revision passed:
- Customer Agent Architecture: `34235091819`.
- WhatsApp wacli Connector: `34235091898`.
- Transactional WhatsApp: `34235091849`.
- Customer Agent Production validation: `34235091855`.
- ERP Next CI: `34235091906`.
- TypeScript/web build: `34235091839`.

Four new suites run through the retained required `mayaRecovery*.test.js` command:
- `mayaRecoveryOutbound.test.js`: immutable/idempotent enqueue; real poll; revocation after enqueue; account/ownership/source/capacity changes; contact policy/cooldown/expiry; class/recipient/text/version mutation; uncertain-send retry denial; ordinary retry preservation; atomic rollback and transient storage error behavior.
- `mayaRecoveryTransport.test.js`: actual exported HTTP ACK with mocked Firebase persistence, synthetic authenticated requests and clock; real canonical ID shape; queue/poll/ACK/binding/accepted earlier appointment; replay; invalid IDs/auth; conflicting messages; takeover/unread preservation; ACK lag; no fabricated provider time; ingress MIME regression.
- `mayaRecoveryDeliveryReview.test.js`: altered claimed payload/recipient/policy/chronology; no fallback after removal of ACK metadata; missing offer-to-queue pointer.
- `mayaRecoverySourceReview.test.js`: edited request suffix before enqueue and before real claim, including beyond a short-content prefix; replay cannot replace old proof; older unproven cases require review; immutable source basis; changed transcripts.

All retained Booking Authority, Office, commercial, reservation, formatting, Customer Agent and single-router assertions remain required. No assertion was waived, disabled or removed. The older delivery fixture was corrected to use the actual distinct canonical/provider fields while retaining its original assertions.

Tests use real domain modules and Wacli poll/HTTP ACK code, but synthetic in-memory transactions, injected semantic decisions, fake token values and request/response objects, and simulated time. They are NOT actual provider/device/network delivery, live model interpretation, production-data, Firestore-emulator/index or distributed-contention evidence. Local cloning could not resolve GitHub; no local full-repository test claim. No UI changed and no browser-preview claim is made.

## Separate Solo Maintainer Adversarial Review
Mode: Solo Maintainer Adversarial Review, NOT independent review. Builder and reviewer are the same assistant in explicitly separate passes.

After implementation, the review re-read the user constraints, root guide, authority/rule/gate and review contracts; inspected final scope and gateway/service/capture/fixture patches; and challenged races across preparation/enqueue/claim/ACK/acceptance, payload and source edits, proof fallback, duplicate delivery, failures and operator ownership.

| Finding | Resolution/evidence |
| --- | --- |
| #490 conflated canonical queue message ID and provider message ID. | Separate ID checks; corrected fixture and actual ACK-to-acceptance composition. |
| ACK-only records lack a provider timestamp. | Explicit server acknowledgement time basis; no fabricated timestamp. ACK-lag remains a conservative reconciliation case. |
| Queue payload could change after claim. | Fingerprint at claim, verified at ACK and later delivery proof; negative tests. |
| ACK could clear status/unread during operator work. | Recovery-only preservation; owner untouched; takeover regression. |
| Removed ACK metadata could use legacy proof. | Governed offers require claim, queue pointer and both ACK timestamps; fallback-denial test. |
| A customer edit could retain the positive quoted prefix but reverse intent later. | Full direct-source fingerprint captured transactionally, replay guard, immutable offer basis and enqueue/claim verification; edited-suffix and long-message regressions. |
| Full-file editing briefly changed an existing audio MIME accessor. | Original accessor restored; ingress MIME regression passes. |
| Cache return uses the compared input URL instead of the equal stored URL. | Equivalent under the enclosing strict equality; no cache behavior or provider-call change. |

Decision: this bounded transport/evidence slice has automated verification and supports continued isolated development. **BLOCKED for main/parent merge, production activation and full Maya completion.** Christian's explicit merge approval and applicable rollout approvals remain required. Green CI is not approval.

## Residual risks / required follow-up
1. Connect cancellation discovery, historical review, compatible candidate selection and the internal producer using approved ranking/contact policy. No automatic scan is active.
2. Integrate acceptance/decline/clarification into the one Customer Runtime/orchestrator, ordered before conflicting Observer/dispatch effects. Add final confirmation proof, multi-message responses and ACK-lag recovery. Current first-next-inbound binding remains intentionally strict.
3. A database claim is not physically atomic with network/device delivery. Revocation, expiry or occupation after the bridge receives the command remains a rollout risk. No exactly-once delivery or device-time revocation guarantee. Uncertain first attempts currently require reconciliation; delayed ACK recovery needs completion.
4. Verify actual remote-conversation/device identity, alternate provider IDs, webhook/ACK ordering and duplicate observations. Current synthetic tests do not establish this live parity.
5. Complete bounded offer-generation history, reminder suppression/update, fulfilled waitlist presentation, unbooked service/workload capture, richer times/subwindows and Papiamento offer rendering.
6. Reconcile all parent branches with current main; integrated emulator/index/security/concurrency and authorized live new-contact/voice/offer tests remain. Existing broad master/queue scans still require scale validation.
7. Older prepared offers may require regeneration because preference identity now includes complete source proof. No production offers were migrated or changed; unproven legacy direct interests must not be silently treated as contact authorization.

Implementation follow-up: project maintainer. Business contact policy and merge/deployment approval: Christian. No deadline or future automatic activation is implied.

## Rollback
No production action occurred. Revert/discard the isolated slice to remove it. A later approved rollout must keep outreach off until policy and live checks pass. Turning outreach off must not delete source messages, delivery evidence or appointments.
