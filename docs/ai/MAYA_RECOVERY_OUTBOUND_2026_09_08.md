# Task: Govern recovery-offer queue production and transport claims

## Context
- Owner: Christian, continuation of Maya development; explicitly NO MERGE without his approval.
- Parent: PR #490 at 0f5ca7157ad6b68d5202528325d0169c95af84db.
- Surface: privileged Functions; existing WhatsApp queue, Wacli poll and recovery offer service. No new UI or runtime.
- Evidence: offer acceptance currently expects queue.messageId to equal the provider ID, while the real ACK stores a canonical message ID and a separate providerMessageId. ACK-only messages also lack provider timestamps. This mismatch must be fixed without inventing provider time.

## Scope
- In: deterministic existing-queue producer, explicit configured Aruba outreach windows/cooldown, second validation at the existing transport claim, correct canonical ACK/message proof, replay and no-auto-resend safety, focused composition tests.
- Out: live sends/deployment/configuration, merge, automatic cancellation discovery/ranking, runtime response routing, complete multilingual/live acceptance and production readiness.
- Expected files: recovery offer service/policy and new outbound module/tests; narrow hooks in the existing Wacli gateway. No new collection, queue, sender or endpoint.

## Governance
- Deep Review / Solo Maintainer Adversarial Review (not independent review).
- Communication Authority owns transport and account; Booking Authority owns scheduling/capacity; existing communicationCases own derived waiting workflow.
- Rules: COMMS current-turn/ownership/no-invention; OPS-ROUTE/OPS-TEAM/OPS-SVC; canonical identity and source-proof requirements.
- Privacy: derive recipient and immutable text from the stored offer, not caller parameters; validate current selected phones; no private data or credentials in fixtures or logs.
- Legacy parity: ordinary conversational/human/transactional messages retain their existing path. Recovery controls must not be bypassed by changing an outbound class or dropping offer metadata from a recovery-prefixed queue ID.
- New settings are read only, default closed: recoveryOutreachEnabled plus an explicit recoveryContactPolicy. Test values are NOT approved business hours or policy.

## Acceptance criteria
- A current prepared offer can enqueue once with identical retry results, without sending, reserving or changing its original appointment.
- Missing/changed policy, outside hours, cooldown, expired offer, revoked phone, takeover, changed input/source/property/work or reoccupied capacity prevents enqueue/claim.
- A recovery item with an uncertain prior transport attempt is not automatically retransmitted; it requires reconciliation. Ordinary queue retries are unaffected.
- Real canonical ACK identities are accepted as proof only with the matching provider ID, account, conversation, immutable text and sent queue; no synthetic provider timestamp is assigned.
- Failures leave appointments/capacity untouched; storage errors are not false successful empty results.

## Plan and risk
Reuse canonical selection and lifecycle helpers; validate all relevant state in the same transaction at enqueue and at claim. Use the existing queue and immutable offer identity/version. Keep all flags off in production. Discard/revert the isolated branch for rollback.

A Firestore claim is not physically atomic with network delivery. Changes after the bridge receives a claim remain a rollout risk; no claim of exactly-once external delivery or complete revocation at the device. Conservative uncertain-send handling prevents blind retries but may need manual reconciliation.

## Verification
Required syntax and focused tests plus retained Maya/booking/transport suites. CI must exercise the actual claim function and canonical acceptance composition. No live model, device, emulator or production work is authorized. Final results and separate review to be recorded after implementation.
