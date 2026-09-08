# Maya recent-interest recovery — 2026-09-08

## Task / scope

Owner request: continue Maya construction after PR #488, including recovering earlier-date requests from recent conversations and reconciling subsequent messages. Implementation branch: `feature/maya-interest-history-20260908`, based on `a0324883ad2a7173ecacd9670b1d448b2f20548a` (`feature/maya-recovery-matching-20260907`). PR #489 is a child PR, not a main-line merge.

Delivery mode: **Deep Review / Solo Maintainer Adversarial Review**. Implementation and the subsequent adversarial review were performed by the same assistant in separate passes. This is not independent review. No production deployment, parent/main merge, settings/security/secret changes, real customer message, live appointment change, or demo data insertion was performed.

This slice implements backend recent-history recovery, current-interest reconciliation and integration into the existing compatibility checker. It does not implement proactive offers, customer acceptance, automatic cancellation-triggered orchestration or live activation.

## Entry points and ownership

- The existing `record_booking_interest` capability gains `action=recover_recent`. The other seven required arguments must all be empty strings. Canonical conversation and current inbound message identity come from runtime context, never model-selected customer/chat arguments.
- Existing register/withdraw operations retain their validation and clear obsolete `interestReview` proof on a new direct write. The registry remains one registry with **18 capabilities**; no additional customer runtime or public tool is registered.
- Internal `createCustomerInterestRecovery().recoverMany()` processes at most five explicitly supplied distinct canonical conversation IDs, independently. This is a service entry for later orchestration, not a public endpoint, discovery scan, queue worker or enabled scheduler. It does not combine customers in one model prompt.
- Capture requires both `bookingInterestEnabled === true` and `bookingInterestRecoveryEnabled === true`. Neither value has been set in production by this task. The active account, current exact phone allowlist, reply policy, AI ownership and current queue-backed communication epochs are checked before analysis and again before persistence.
- Existing `communicationCases` remain derived preference workflow state. The original customer messages remain evidence. A bounded review receipt is stored on the existing conversation; it is not another CRM, schedule, ledger, queue or source of capacity.
- Existing Booking Authority remains the only scheduling/capacity/lifecycle authority. No recovery function writes appointments, Work Orders, capacity locks, booking offers or outbound queues.

Relevant protected boundaries: canonical Customer/Property identity, `COMMS-*` current-turn/ownership/evidence/no-invention behavior and existing `OPS-ROUTE-*` routing/capacity ownership. The recovery layer does not define service prices, workload duration, operating hours or customer-contact policy.

## Evidence and bounded coverage

The recovery reader uses the last **40 recent canonical message references** and reads their original `whatsappMessages` documents. Cached preview text is not trusted. A message must belong to the exact account and conversation, have verifiable provider and first-ingested timestamps, and fit the bounded review context.

The window covers at most **30 days**, at most 6,000 normalized characters per message and 24,000 total characters. This is an engineering review-coverage bound, **not a policy expiring all customer waiting requests after 30 days**. Full archive scanning, pagination over older conversation history and operator-driven recovery screens are not implemented here.

The inbound sequence must be contiguous and reach the conversation's current customer-input version. Missing messages, reordered/gapped input, uncertain chronology, incomplete voice transcripts, opaque media or oversized context fail closed. Already completed inbound transcripts can be used; this recovery never downloads or transcribes historical audio.

The structured semantic reviewer considers the whole supplied window. Its contract distinguishes a preserved earlier-date request followed by thanks from an explicit later withdrawal, handles Spanish/English/Papiamento di Aruba, and treats all conversation content as untrusted data rather than executable instructions. Exact normalized inbound quotations and verified target IDs are required by server validation. Low confidence or ambiguity produces `NEEDS_REVIEW`, never an active compatible candidate.

The code cannot deterministically prove the linguistic meaning of every quotation. Exact evidence binding is not a claim of perfect semantic inference. Real model evaluation, including adversarial multilingual examples and actual runtime tool selection, remains required before activation.

## Persistence, races and replay

1. Read a bounded canonical context in a read-only transaction.
2. Analyze outside any Firestore transaction. A Firestore retry must not repeat an external model call inside its callback.
3. Validate the structured decision against customer evidence, canonical property and the unchanged future appointment when applicable.
4. Re-read account, pilot permissions, ownership, current input, original messages, CRM, relevant appointments and existing preferences before writing.
5. Require the context fingerprints to remain equal and re-evaluate time-dependent eligibility at commit time.
6. Commit only derived preference Cases and the review receipt atomically.

A changed customer input, operator takeover, removed pilot phone, edited source, changed property or moved appointment aborts the stale decision. Exact completed replays do not duplicate preference history or re-run analysis when the same context and resulting Cases remain current. A later positive decision cannot revive a withdrawn preference using older customer evidence.

Fingerprints recursively canonicalize object keys because Firestore map ordering must not affect equality. Arrays retain their semantic order.

## Integration with cancellation matching

A recovered preference retains the original request message as its source, and separately records through which customer-input version the conversation was reviewed. The checker re-reads the exact reviewed original message set and validates its fingerprint, current epochs and material preference fingerprint.

Later outbound acknowledgments do not themselves create a new customer preference or discard that reviewed request. A new inbound message or ownership change still invalidates it until a fresh reconciliation. This depends on the existing communication-ownership authority representing operator takeover correctly; device/provider ownership end-to-end behavior is not proven by synthetic tests.

A present but invalid review cannot fall back to the older same-turn path. Direct new register/withdraw commands clear stale review proof. All existing CRM, property/sector, unchanged original booking, full workload, real Scheduling Provider, route enforcement and released-capacity checks remain required.

The result is still `compatible_for_review`, not a customer offer or accepted reservation. `capacityReserved` and `proactiveContactAuthorized` remain false. Unbooked customers without verified workload remain `needs_work_details`.

## Separate adversarial review

Reviewed the implementation, the existing interest-tool caller, queue receipt contract, canonical ingress/message shape, matching caller and retained CI commands after the initial implementation. The pass specifically challenged later messages, map ordering, time changes, evidence tampering, target identity and cross-customer isolation.

| Finding | Correction / evidence |
| --- | --- |
| The existing queue-receipt loader always requires a transaction reader. | Use an explicit `get` adapter for already transaction-wrapped references; caller-provided epochs never replace stored proof. |
| Firestore map-key order could invalidate raw JSON fingerprints. | Recursively sorted map hashing and an integration/replay regression. |
| Comparing the evolving recent-message list would invalidate review after an outbound acknowledgment. | Store and re-read exact reviewed message IDs while checking current inbound/ownership epochs and the live appointment. |
| Clock time may pass an appointment start while analysis is in flight. | Rebuild the validated plan against the final transaction's clock; regression proves no write. |
| An invalid historical review must not regain authority through a same-turn fallback. | Require the review when present; regression exercises a corrupt fingerprint. |
| Updating a preference directly could retain unrelated old review metadata. | Direct register/withdraw clears `interestReview`; composition test verifies the new current-turn path. |
| JSON schema alone does not enforce correctness in all injected/provider outputs. | Server checks exact keys, types, IDs, quotes, date syntax and confidence/ambiguity; malformed/incomplete/multiple-call response tests. |

Decision: the bounded slice supports continued isolated development subject to exact final CI evidence. Keep draft. It is not main-merge approval, deployment approval, outreach authorization or evidence of full Maya product completion.

## Verification

Three new test files are explicitly included in the existing required CI command through `demacCustomerInterest*.test.js`:

- `demacCustomerInterestRecovery.test.js`: capture/reconciliation, withdrawal, replay, stale/racing decisions, pilot/ownership/account/CRM denials, evidence rejection, failed commit, completed transcript provenance and bounded internal batch behavior.
- `demacCustomerInterestIntegration.test.js`: legacy current request -> thanks -> history review -> actual Scheduling Provider compatibility; outbound acknowledgment; map-key order; changed reviewed content; new input/takeover; live original-booking checks; reoccupied capacity; invalid-proof fallback denial; direct recapture; elapsed time; separate customer contexts.
- `demacCustomerInterestAnalysis.test.js`: forced strict single-tool request, no model storage, bounded output/timeout, malformed/incomplete/failed provider results, safe diagnostics and prompt contract.

The source/test revision `61a0aa8b34f773e5164a64d290fa595939775280` passed the complete Customer Agent Architecture job, including focused tests and the retained Booking Authority, Office, commercial, product-reservation, formatting, Customer Agent and single-router regressions. The exact delivery HEAD and final workflow/job outcomes are recorded in PR #489; do not infer final checks from an earlier revision.

Tests run in GitHub Actions, using real domain modules with synthetic in-memory persistence and controlled semantic outputs. Adapter tests use fake fetch. There were no live OpenAI/model/transcription calls, real WhatsApp sends or real customer reads. The local container could not clone the repository because external DNS was unavailable; no local full-repository test result is claimed.

Not verified: Firestore emulator/index requirements, true distributed contention, real provider message materialization, live model accuracy, natural runtime selection of `recover_recent`, actual feature settings/allowlisted phones, mobile/browser UI, or production rollout. No UI is modified in this slice.

## Remaining work and rollout

- Automatic discovery/selection of recent conversations and cancellation-triggered orchestration; the internal batch is not an activated scan.
- More complete history/media coverage and explicit current-interest/contact-consent policies before outreach.
- Verified complete workload for unbooked waiters; richer customer time-of-day preferences and subwindow matching.
- Ranking, approved contact hours, transport/provider policy, offer expiry or real temporary holds, customer acceptance, and canonical atomic earlier rescheduling preserving the original booking on failure.
- Integration of all Maya parent branches with current main, emulator/security/index and live voice/new-contact acceptance, cancellation reminder suppression and explicit activation approval.

Rollback for this delivery is discarding/reverting the isolated branch. A later approved deployment must retain recovery disabled until pilot validation. Disabling recovery must not erase historical evidence or affect existing appointments. Do not activate outreach merely because recovery or compatibility checks have passed.
