# Task: Complete consecutive customer replies and reconcile delayed offer delivery proof

## Context
Christian authorized continued isolated development, not merge or deployment. Parent is PR #492 at e7f2ba6bda476f8e2cf5a8c30b2902e09b39c94c. Existing offer acceptance supports only one next message and requires delivery binding before that message arrives.

## Scope
In scope: bounded consecutive canonical customer messages for one unchanged offer; semantic analysis of the complete ordered response; transaction-time rereads and replay proof for all parts; read-only reconstruction of an already proven send when binding lagged; late ACK chronology only when verified canonical provider evidence proves the send preceded the reply. Integrate into existing service and scoped chat tools. No second runtime, sender, queue, source of truth or endpoint.
Out of scope: automatic cancellation discovery/ranking, arbitrary multi-turn clarification after an intervening outbound question, live sends/configuration, production rollout, main/parent merge, reminder and UI work.

## Authority and rules
Communication Authority owns original messages, account, queue/ACK and epochs. Booking Authority remains the only capacity/lifecycle authority. COMMS current-turn/context/no-invention, OPS-ROUTE/OPS-TEAM/OPS-SVC, selected-phone limits and human ownership remain protected. Model outputs cannot replace source messages or authorize stale state.

## Acceptance criteria
- Consecutive responses such as `Yes` followed by `Tuesday works` can be considered together without selecting only a favorable part.
- A reversal, condition, incomplete voice note, missing/duplicate/foreign source, excessive input, new inbound, takeover or lost capacity cannot silently become acceptance.
- Read every original source again after model analysis and on replay; a same-ID edit to any part invalidates the result.
- Missing delivery binding may be reconstructed only from the exact sent queue and canonical message; ACK is not a fabricated provider timestamp and a response that cannot be proven later than sending requires review.
- Neither context reads nor reconciliation inspections move an appointment, queue a message, reserve capacity or resend an offer.
- Failed final commits preserve the original appointment and all previous state.

## Design and risks
Use at most six version-specific equality queries (limit two each, rejecting duplicates) in the current conversation, not an archive scan or caller-provided source list. Total normalized response is capped at 8,000 characters without prefix truncation. All model work remains outside database transactions. Existing guards and ordinary single-message semantics remain required; old proof cannot be upgraded from caller assertions.

A later unrelated outbound question is not covered by this consecutive-response feature. Physical send exactly-once semantics, bridge clock/network races, live multilingual interpretation and emulator/index/concurrency evidence remain separate release gates. No production setting is changed.

## Verification and review
Run existing required Maya/recovery/booking suites plus new boundary and composition tests; inspect exact-head CI and deployment job status. Perform a separate Solo Maintainer Adversarial Review, not independent review. Final evidence to be recorded after implementation. Local git clone currently fails DNS resolution; no local full-repository verification is claimed.
