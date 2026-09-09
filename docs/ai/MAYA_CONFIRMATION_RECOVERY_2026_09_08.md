# Task: Confirm a committed earlier-appointment move without repeating it

## Context and authorization
Christian authorized continued Maya development, explicitly not merge or production activation. Parent: PR #493, commit `693ee785175e875f5cd0376fe56d12ce6f2205c6`. Work is isolated on `feature/maya-confirmation-recovery-20260908`, PR #495. No main/parent merge, production read/write, deployment, secret/rules/settings change, physical customer message or operational demo insertion was performed.

## Scope and authority
The slice recovers an exact committed earlier-offer acceptance before another model attempt and after a model failure; renders the final confirmation from canonical appointment/source evidence; and publishes through the existing Communication Authority queue and Wacli claim/ACK. It does not implement another model loop, sender, queue, endpoint, collection or scheduling authority.

Booking Authority remains the only appointment/capacity writer. Original WhatsApp messages and existing offer completion receipts are evidence. Completion/publication pointers on the existing source message are derived idempotency metadata, not a second appointment state. Sessions are updated through the existing session service contracts in the same publication transaction. Protected COMMS current-turn/one-confirmation/no-invention and OPS-ROUTE/OPS-TEAM/OPS-SVC rules remain.

Out of scope: automatic cancellation discovery/ranking/orchestration, arbitrary clarification conversations, unbooked workloads, reminder lifecycle, full main reconciliation and live pilot activation. This slice's deterministic confirmation renderer supports English and Spanish only; Papiamento requires the remaining reviewed language work.

## Implemented behavior
1. Acceptance records an exact completion pointer atomically with the canonical move. The accepting source, offer/version, accepted response fingerprint and final appointment are linked.
2. The existing current-turn processor checks that receipt before model execution and session reactivation. A successfully committed move can be recovered after the model, state-update or final-response path fails, without calling scheduling again. Current human session state is checked before reactivation.
3. Confirmation text comes from the currently verified appointment date/start time, not model-supplied prose. No successful appointment statement is reconstructed from a missing, malformed or changed completion receipt.
4. Publication rechecks the selected-phone pilot, account, ownership, current input, exact full response-window evidence, original offer delivery proof, Customer/Property identity, canonical appointment fingerprint, existing Work Order/capacity ownership and fulfilled preference.
5. The existing queue uses one deterministic `MRC-` identity per conversation/source for this confirmation class. A source publication receipt prevents deleted queue records from being interpreted as permission to resend. An ordinary reply already published for the source requires reconciliation.
6. Both ordering races are guarded: the ordinary reply transaction reads the original completion/publication and reserved confirmation identity, while a first acceptance checks the existing queue for any already-published reply to its source inside the canonical mutation transaction. Completed acceptance replay remains idempotent after confirmation publication.
7. Publication, source receipt, conversation outcome and updates through the existing session services share one transaction. No reads occur after writes. Failed publication does not roll back or repeat the already committed appointment move.
8. The existing Wacli claim revalidates canonical proof immediately before returning the command. Removing metadata or relabeling the message class does not escape the reserved confirmation identity. The claimed payload fingerprint includes immutable recipient, remote conversation identity, text, proof and epochs.
9. The existing authenticated ACK requires a real provider message ID and unchanged claimed content, checks original-message conflicts, retains the claimed remote identity, and records server-observed confirmation acknowledgement separately from provider time. Duplicate matching ACKs do not create a second original message.
10. A late ACK does not erase unread counts or operator state. An uncertain prior transport attempt is not automatically reclaimed after lease expiry; it requires reconciliation rather than a blind resend.

## Activation controls
`recoveryConfirmationEnabled` is an additional default-closed permission. It is rechecked at recovery/publication/claim together with the existing routing, offer and reply/pilot/account/ownership controls. No production setting was changed. Disabling reschedule autonomy after a committed move does not undo that move; reporting an already verified outcome is distinct from permission to perform another mutation. Global reply/pilot revocation can still suppress contact.

This renderer is a response to accepted action, not a new proactive offer; it does not set or bypass outreach policy values. Existing contact policy fixture values remain unapproved test data.

## Acceptance and automated verification
Source/test revision: **`76e2e5647b04fbb9d99e4809716aa40263cd0c8f`**.
All **6 triggered PR workflows succeeded** on that exact source/test revision:
- Customer Agent Architecture: `34295303379`; job `102290515619` explicitly inspected.
- Customer Agent Production validation: `34295303435`.
- WhatsApp wacli Connector validation: `34295303334`.
- Transactional WhatsApp validation: `34295303385`.
- ERP Next CI: `34295303310`.
- TypeScript and web build validation: `34295303287`.

The architecture job explicitly ran the retained waiting/history/recovery command, Booking Authority, Office, commercial, reservation, formatting, Customer Agent and single-runtime/router checks successfully. The final documentation-only commit receives its own CI; the PR description records the exact final head and independently observed results. A green workflow with a production name is not a deployment.

Five new suites execute through the existing mandatory `mayaRecovery*.test.js` command:
- `mayaRecoveryConfirmation.test.js`: canonical recovery, model failure, atomic publication and authorization/provenance denials.
- `mayaRecoveryConfirmationIntegration.test.js`: actual current-turn processor, real Runtime/registry/semantic-adapter request, queue, actual Wacli poll and exported HTTP ACK code with controlled inputs.
- `mayaRecoveryConfirmationReview.test.js`: ordinary-reply ordering, human-session preservation, publication loss, source/queue conflicts and failure propagation.
- `mayaRecoveryConfirmationProof.test.js`: malformed completion and recorded transport identity.
- `mayaRecoveryConfirmationPublication.test.js`: already-published source reply prevents a delayed new mutation; valid completed replay remains available.

Tests demonstrate an actual canonical Thursday-to-Tuesday move followed by injected final-model failure, recovery through the existing processor, one factual queued confirmation, final claim and ACK materialization. Other cases cover pre-commit failure, overwritten draft prose, queue rollback, duplicate publication, stale/edited/missing proof, permission revocation, changed CRM/work/capacity, uncertain send and operator takeover. Existing tests were not weakened, removed, skipped or waived.

## Separate Solo Maintainer Adversarial Review
Review mode: **Solo Maintainer Adversarial Review**, not independent review. A fresh pass re-read the owner constraints and authority/rule/gate contracts, inspected the full existing-file diffs and new composition paths, and challenged both ordering races, idempotency, source edits, human control, incomplete proof, transport uncertainty and write atomicity. Builder and reviewer roles were performed by the same assistant; no independent human approval is claimed.

| Severity | Finding | Correction and evidence |
| --- | --- | --- |
| High | Completion after a preliminary lookup could enter the ordinary reply transaction and publish stale text. The reverse ordering could allow a late worker to move a booking after a response was published. | Transaction-time source/confirmation reads and an acceptance-side bounded publication query; both orderings have regressions. |
| High | Missing queue after prior publication could be treated as a new send; malformed or cleared source proof could reopen fallback. | Persistent source publication and completion pointers are validated; missing/changed proof blocks; malformed metadata is rejected before the model. |
| Medium | Session reactivation could clear a prior human session before recovering the accepted result. | Recovery/human-session verification precedes reactivation for a committed result. Actual processor regression passes. |
| Medium | A changed remote conversation address after claim could change the ACK's historical message identity. | Immutable remote identity is part of queued/claimed material; ACK uses that recorded identity, without rewriting the conversation's later address. |
| Medium | Removing confirmation metadata or mixing it with offer fields could select an inappropriate transport path. | Reserved ID detection and strict queue material reject removal, relabeling and mixed fields. |
| Low | A manual full-file edit temporarily omitted existing no-content completion audit metadata. | Restored the original `completedAt` field; final ordinary no-content path has no functional diff. |

Decision: implementation and automated evidence support continued isolated development. **NOT READY FOR FULL MODULE MERGE OR LIVE ACTIVATION.**

## Explicit limitations and remaining release work
- Evidence uses real domain/runtime/queue/HTTP-handler code with synthetic in-memory persistence, scripted model calls, fake authenticated HTTP responses and simulated clocks. No live model interpretation, physical bridge/WhatsApp delivery, production data, browser, Firebase emulator/index/security or distributed-contention verification is claimed.
- A Firestore transaction is not physically atomic with network delivery. A changed state after bridge claim, a lost ACK, expired processing lease or terminal uncertain send still needs an operator-safe reconciliation path. No exactly-once external delivery or automatic recovery from every failed send is claimed.
- Recovery deliberately requires the same current source and unchanged authorization/canonical proof. New customer input, takeover, a changed appointment or missing evidence may suppress automatic confirmation and require reconciliation; this is not a generic historical resend mechanism.
- The publication query is bounded but requires integrated Firebase index/query/security verification. In-memory tests enforce read-before-write and rollback, not real lock contention or deployed indexes. The additional ordinary reply reads and existing queue scan need pilot cost/performance validation.
- Work Order/capacity checks reuse the existing ownership contract; exhaustive Legacy/new-support Work Order projection parity remains part of integrated release work, not a newly claimed guarantee.
- Automatic cancellation-triggered search/review/selection/offers, arbitrary clarification completion, late-ACK wake-up, unbooked workloads/new booking, reminder updates, fulfilled waitlist presentation, complete offer history, richer slot subwindows and Papiamento rendering remain open.
- Reconcile the full parent stack with current main and run integrated regression/emulator/security/concurrency checks. Verify actual settings/account/selected phones and complete authorized real new-contact/voice/offer testing before activation.
- Christian's explicit merge approval and separate applicable production rollout approvals remain mandatory.

## Reversibility and supporting contract
No data migration or production change was performed. Keep this PR in draft; branch code can be revised without touching operational records. Do not deploy or change rules/settings as a test.

Local clone failed DNS resolution, so no local whole-repository or emulator test result is claimed. The Firebase transaction contract was consulted for read-before-write and retry-safe callbacks: https://firebase.google.com/docs/firestore/manage-data/transactions.
