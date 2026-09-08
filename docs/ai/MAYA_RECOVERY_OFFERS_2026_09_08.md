# Maya recovery offers and acceptance — 2026-09-08

## Task and approval boundary

Christian requested continued construction and explicitly prohibited merging without his approval. This is PR #490, branch `feature/maya-recovery-offers-20260908`, based on #489 at `17fb3aca6a71ce582b0f8fd7e989904a5ddcef51`.

Delivery mode: Deep Review / Solo Maintainer Adversarial Review. Implementation and review are separate passes by the same assistant, not an independent review.

No merge to a parent branch or main, deployment, live customer message, production data/configuration/security/secret change, new collection, new public endpoint, live task or scheduled worker was performed. All new actions remain internal functions with no production caller. Owner approval is still required for merge and any separate rollout boundary. This delivery does not declare Maya ready to merge.

## Narrow implemented scope

An existing earlier-appointment preference can be used to prepare one exact canonical recovery offer for a cancelled opening. Transport delivery must be independently evidenced before a customer response may be interpreted. Explicit acceptance is applied through the existing Booking Authority lifecycle in one transaction; rejection or failure does not release the original appointment.

This is the internal service needed by a later runtime/transport integration, not an enabled proactive WhatsApp agent. `prepare`, `bindDelivery` and `respond` are not public APIs or Customer Runtime tools in this PR. No outbound producer is added.

## Authority / rule mapping

- Booking Authority remains the sole appointment/capacity owner. `createBookingAuthority` constructs the offer, the existing Scheduling Provider calculates and revalidates routes/crew/calendar/workload, and `createBookingAppointmentLifecycle` executes the accepted move.
- Existing `bookingOffers` carry offer state and versioned recovery metadata; existing `communicationCases` carry preference/fulfillment workflow; the existing conversation carries only the active-offer pointer. No parallel schedule, capacity ledger, identity, queue or sender is created.
- `COMMS-*`: exact current customer message, evidence-bound response, ownership/phone/account checks, no invented acceptance, no completion claim without canonical result.
- `OPS-ROUTE-*`, `OPS-SVC-*`, `OPS-TEAM-*`: WhatsApp/Maya route enforcement, exact former opening, full canonical workload, real crew/calendar availability and released target locks. No manual-office routing exception.
- `PRICE-*`: no new prices or duration guesses. Existing appointment work lines and catalog duration rules remain authoritative.

## Contract and behavior

### Preparing an offer

Preparation reads one selected earlier-booking Case and invokes the existing bounded compatibility inspection on its page. It rechecks the original booking, current pilot settings, canonical identity, current interest evidence and complete original Work Order/capacity ownership. It then obtains the exact option from the real Scheduling Provider in the same transaction.

The canonical Booking Authority constructs the offer through a staging adapter restricted to its exact `bookingOffers` destination. Only after reads finish is it stored as `recovery_pending`. Ordinary booking selection rejects this status: the offer is not generally available to create a second appointment or perform an unrelated reschedule.

There is one deterministic offer identity per cancellation/account. A live offer for another Case blocks a second preparation; a conversation's live offer also blocks another opening. Expired generations are replaced with a higher version; responses to the old version fail. This is logical offer exclusivity, not a capacity reservation. Automatic ranking, retry/cooldown and audited version-retention policy remain integration work.

`recoveryOffersEnabled === true` and an explicitly configured integer `recoveryOfferTtlMinutes` between 5 and 180 are required. There is no default chosen on the owner's behalf. Expiry is capped before the offered appointment starts. These settings were used only in synthetic tests; no production values were set.

The draft renderer supports English and Spanish, explicitly says the slot remains subject to availability, and preserves the original appointment until the move completes. It contains no cancelled-customer information. Papiamento rendering is intentionally rejected pending implementation and language validation. This restriction applies to this new internal offer renderer, not to the existing Maya conversation/voice capabilities.

### Delivery proof

No message is sent by this service. A future governed producer must use the existing queue/sender and record the exact offer ID/version/fingerprint and expected communication epochs. `bindDelivery` currently requires a sent/delivered/read queue item and its corresponding original outbound WhatsApp message, matching account, conversation, provider, text, provider message ID, offer identity and timestamps. Future timestamps, expired delivery and changed evidence fail closed.

A queued record is not delivery proof. Synthetic test fixtures create the transport records without calling WhatsApp. Real ACK/message materialization and producer/claim-time checks remain unverified integration work.

### Customer response

Only the first next customer input after the proven offer is eligible in this bounded implementation. Its current queue receipt, phone/account/ownership and active offer pointer must still match. The offer must be the latest outbound reference; a different intervening question prevents interpreting a bare affirmation as consent to move.

Response interpretation uses a single strict model tool with an exact customer quote, accept/decline/needs-review decision, numeric confidence and ambiguity flag. Questions, conditions and disagreement block acceptance. The full bounded message is inspected: a message exceeding the 8,000-character semantic window is rejected rather than accepting a truncated prefix. Completed voice transcripts can be semantic evidence; no audio download/transcription occurs here.

Model work is outside every Firestore transaction. The result is advisory semantic interpretation, not a scheduling authority. Schema/threshold checks do not establish real-model accuracy. The final transaction reloads current source and state and rejects changed inputs, ownership, flags or expired time. Live multilingual interpretation is still unverified.

Declining one offered opening marks that offer declined and retains the original appointment and broader waiting preference. Withdrawal from all waiting offers is a separate existing preference action.

### Atomic accepted move

Acceptance separately requires `autoRescheduleEnabled === true`. It rechecks unchanged preference/original/cancellation fingerprints, real CRM/property relationship, original Work Orders/active locks and the exact full newly revalidated option. Reoccupied target capacity prevents a move.

Only then does a transaction-local adapter expose the exact pending offer as open to the existing canonical lifecycle. No intermediate open state is written. New capacity acquisition, original capacity release, appointment/Work Order updates, accepted-offer receipt and derived Case fulfillment commit together or roll back together.

A guard around the canonical Work Order builder reads all generated destinations before lifecycle writes. An existing unlinked or foreign destination cannot be merged into. No new scheduling calculation is introduced by this guard.

Successful acceptance returns canonical lifecycle proof and `capacityReserved=true`. Preparation/delivery/decline do not reserve capacity and report false. No result authorizes proactive contact. Final customer-facing confirmation and reminder handling must be wired through existing authorities later.

### Replays

A completed replay checks the same exact response and its current fingerprint. Accepted replay additionally compares the current canonical appointment against the saved completion fingerprint. It never repeats the move or model analysis. A changed appointment or edited source is not replayed as unchanged success.

The canonical dispatch service returns `{}` for a nonexistent hold without persisting an empty map. Fingerprinting normalizes only absent/null/empty no-hold representation; populated hold data, dates, property, workload, assignments and capacity remain protected. This corrects a real mismatch exposed by the expanded replay tests.

## Acceptance evidence and exact verification

Last functional/test revision for this delivery: `9b2c01b390f52c67d920d2730522a650f63cc029`. Both triggered workflows passed on that revision:

- Customer Agent Architecture: run `34193449931`, SUCCESS.
- TypeScript and web build validation: run `34193449887`, SUCCESS.

The final documentation commit and its exact CI outcomes are recorded in PR #490. Prior green checks must not be substituted for final-head evidence.

The existing required command executes all new `mayaRecovery*.test.js` suites along with retained preference/history/matching suites. No existing test or gate was removed, weakened or waived. The architecture workflow also retains canonical Booking Authority, Office, commercial, reservation, formatting, customer runtime and single-router checks.

New tests cover preparation/no queue or capacity writes, pending-offer rejection by ordinary selection, proof of sending, stale/late/wrong-version replies, actual canonical Thursday-to-Tuesday rescheduling, old/new locks, original Work Order payment/recipient preservation, decline semantics, replay, model ambiguity/disagreement, changed source during analysis, pilot/takeover/capacity changes, genuine final-commit rollback, generated-record ownership, oversized input and safe model-transport failures.

These are real domain components composed with synthetic in-memory persistence, controlled model responses and fake transport. There was no real model invocation, WhatsApp phone, Firestore emulator/index test or distributed-contention test. Logical exclusivity and revalidation tests must not be described as real concurrent Firestore evidence. No UI files changed or visual preview was produced. No local full-repository tests are claimed because GitHub name resolution from the container was unavailable.

## Separate adversarial review findings

| Finding | Correction / disposition |
| --- | --- |
| A plain open offer could be consumed by an ordinary booking tool. | Recovery offers use a pending status and a narrowly scoped acceptance-only transaction view; generic selection rejection is tested. |
| A caller-provided decision plus a matching substring did not prove the meaning of consent. | Added bounded strict semantic interpretation outside transactions and final source/context revalidation. |
| Expanded replay checks failed after a valid move because returned and stored no-hold representations differed. | Inspected canonical dispatch behavior; normalized only absent/empty no-hold data, retaining workload/capacity and populated-hold assertions. Both previously failing tests were retained and pass. |
| A replay could ignore an edit of the accepted customer message or workload. | Bound complete response and canonical completion fingerprints; targeted rejection regressions added. |
| Generated Work Order IDs could hit unrelated preexisting records. | Added pre-write destination reads and ownership/linkage checks around the existing builder, with rollback tests. |
| Truncation could omit a contradictory suffix from a long response. | Oversized semantic messages fail closed before analysis. |
| Future message timestamps could look like completed delivery. | Reject future delivery evidence; acceptance still validates chronological source binding. |

Review decision: the bounded internal service and automated evidence support continued isolated development. This is not merge approval, live activation approval or full-product completion.

## Remaining merge / integration blockers

1. Connect a governed offer producer and final transport claim guard, including current-phone revocation, contact hours, provider rules, expiry, fresh availability, pending-offer exclusivity and verified ACK/materialization. No sends are implemented here.
2. Connect response handling to the single Maya runtime and current-turn orchestrator. Handle it before generic Observer behavior can incorrectly create a reschedule hold. Bind final conversation confirmation to canonical completion; safely handle two-part replies, clarification and failed/late ACK races.
3. Add automatic cancellation-triggered selection/history review, ranking, cooldown/no-repeat behavior, required offer generation retention/audit, and fulfillment display in the waiting-list read model/UI. Existing list projections do not yet have a dedicated FULFILLED presentation.
4. Confirm reminder suppression/update and legacy/new-support Work Order parity. Existing canonical builder behavior is preserved; generated new records do not silently inherit unrelated domain fields. Full notification/financial projection parity must be reviewed before live use.
5. Complete Papiamento offer rendering/linguistic acceptance, unbooked-candidate workload capture and booking, richer time windows and broader slot placement.
6. Reconcile the complete parent stack with current main, pass integrated/emulator/security/concurrency checks, verify real account/settings/selected phones and run authorized real voice/new-contact/offer acceptance tests.
7. Obtain Christian's explicit merge approval and separate required production deployment/activation approvals. Do not automatically merge even when CI is green.

## Rollback

No production change exists to undo. Before a future authorized rollout, abandoning/reverting this isolated branch removes the internal service. After a future rollout, disable offer production through the governed flag and use an explicit recovery procedure for any already sent offers; do not delete original messages, appointments, waiting evidence or accepted lifecycle records.
