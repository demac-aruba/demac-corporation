# Task: Complete consecutive customer replies and reconcile delayed offer delivery proof

## Context and authority
Christian authorized continued isolated development, explicitly NO MERGE without his approval. Parent: PR #492 at e7f2ba6bda476f8e2cf5a8c30b2902e09b39c94c. Delivery branch: feature/maya-response-continuity-20260908, draft PR #493.

Communication Authority owns original messages, account, queue/ACK and epochs. Booking Authority remains the only capacity/lifecycle authority. COMMS current-turn/context/no-invention, OPS-ROUTE/OPS-TEAM/OPS-SVC, selected-phone limits and human ownership remain protected. Model outputs cannot replace source messages or authorize stale state.

No main/parent merge, deployment, real customer message, production data/configuration/security/secret change or operational demo data insertion. Existing routing/offer/reply/mutation flags remain unchanged in production. No new runtime, sender, queue, collection, model provider or public endpoint.

## Implemented bounded scope
- Current earlier-offer responses may consist of 1–6 consecutive canonical inbound messages after the offer's recorded input version. Read one equality query per exact conversation/input version, limited to two documents to detect ambiguity. Missing, duplicate, foreign, unordered, incomplete audio or unsupported-media evidence fails closed.
- The entire chronological normalized response, up to 8,000 characters in total, is sent through the existing analysis adapter's customerText protocol. Input is not truncated into consent. This slice does not change the model adapter, its instructions, provider or request protocol. An offline transport composition test verifies the full joined response reaches its existing customerResponse field.
- Every part is reread after external model interpretation and on completed replay. The persisted response-window proof binds IDs, versions, full content/transcript, type, timestamps, offer version and delivery. Editing an earlier fragment cannot silently replay or commit a different decision.
- Semantic analysis stays outside retried database transactions. An interpretation must match the requested accept/decline action and quote one actual source fragment. Conditions, reversals or uncertainty cannot be replaced with caller-supplied note/reason. The live model's semantic accuracy is still unverified; synthetic decisions demonstrate the enforced contract, not perfect interpretation.
- A missing offer-delivery binding can be reconstructed read-only from the exact existing sent queue and canonical original message. A successful accepted/declined transaction persists that same proof with its result; inspection alone never writes binding, resends, reserves capacity or changes an appointment.
- A reply that predates the server-observed ACK may be considered only when an earlier canonical provider echo with a processed, authenticated, same-account webhook proves the offer preceded the reply. Provider/ingress/attempt/ACK chronology is checked; no provider timestamp is invented. ACK-only early replies remain review cases. Existing bound proof retains its original time basis rather than changing silently when metadata later appears.
- Existing scoped chat tools expose response-evidence readiness/count and read-only reconciliation status. Existing read/reschedule/decline capabilities and all identity/pilot/transactional controls remain in use.
- An intervening outbound question remains outside this bounded feature. A delayed ACK can reorder the cached preview, so pending-response validation also dereferences original outbound messages from the bounded recent-message index (maximum 120 entries). Another outbound at/after preparation, missing originals or uncertain chronology requires review. Cached text/time alone cannot authorize acceptance.

## Acceptance criteria and evidence
- PASS: Yes followed by Tuesday works is interpreted together and accepted through the real canonical reschedule; the Thursday appointment stays intact until commit.
- PASS: a later refusal blocks an attempted acceptance; explicit rejection of that offer retains Thursday and the general WAITING preference.
- PASS: an earlier condition is present in analysis even when the last fragment is affirmative.
- PASS: current full transcripts may participate; pending historical/unreadable audio is never transcribed or guessed by this feature.
- PASS: missing/duplicate/cross-account/cross-conversation sources, version gaps, excess length/count, timestamp reversal, intervening question and changed route proof cannot become acceptance.
- PASS: edits to an earlier source during analysis and after acceptance invalidate stale commit/replay; exact replay does not move twice or repeat model analysis.
- PASS: final transaction failure leaves original appointment, offer, waiting case and old/new capacity unchanged.
- PASS: real exported queue poll/HTTP ACK code plus simulated provider evidence supports lagging-binding reconstruction without a resend; missing/foreign/unprocessed evidence and revoked phones prevent acceptance.
- PASS: existing Runtime + registry + scoped recovery tools + canonical lifecycle compose for a split response; this is not full live session/final-confirmation transport evidence.

## Verification
Source/test revision: **7dc97887781cd38f3f2278e571c5d73e3e234b3f**.
Both triggered workflows SUCCESS on that exact revision:
- Customer Agent Architecture: 34268062725, job 102202366974 explicitly inspected.
- TypeScript and web build validation: 34268062756.

The architecture job's focused waiting/history/recovery command and retained Booking Authority, Office, commercial, reservation, formatting, Customer Agent and single-router checks all passed. Three new suites contain 38 tests: 22 response-window tests, 11 delayed-response tests and 5 separate review tests. All execute under the existing required mayaRecovery*.test.js command. No required test was disabled, waived or deleted.

One earlier run failed the retained early-reply test because its injected source clock was +120s but the gateway ACK clock remained at +60s despite the test intending an ACK after the reply. The fixture now advances the actual gateway clock to +180s, asserts that chronology, retains the rejection and original-appointment assertions, and checks the specific denial code. A transient unrelated HTTP-status expectation typo during that edit was restored immediately; the final existing-test diff contains only the intended clock correction and stronger early-reply assertions.

No deployment workflow/job was triggered by this slice's changed paths; no extra ERP Next, production, transport deployment or actual provider run is claimed. The documentation-only final HEAD receives its own fresh PR checks; final status is recorded in the PR after inspection rather than inferred from this source revision.

Tests use real domain modules, existing analysis request code, Runtime/registry and poll/ACK handlers with synthetic in-memory persistence, injected semantic output/fake model transport and controlled clocks. Not live model accuracy, physical bridge/provider delivery, real phones, Firebase emulator/index/security, distributed-contention or browser evidence. Local git cloning could not resolve GitHub; no local whole-repository test result is claimed.

## Separate Solo Maintainer Adversarial Review
Builder and reviewer: same assistant in a fresh separate review pass, NOT independent review. The user request, no-merge constraint, authority/business/quality documents, complete existing-file diffs, new modules and affected callers were reread. No unrelated production path was modified.

Findings and resolutions:
1. Earlier fragments could contain the qualifying or reversing text while a latest-only check saw an affirmative. Full bounded source-window interpretation and commit/replay fingerprints replace latest-only evidence for this path; single-message guards remain.
2. A provider ACK can lag a client response, but using server ACK as an invented provider time would be incorrect. Read-only reconstruction requires actual existing transport and canonical echo evidence, and retains conservative denial where chronology is unproven.
3. A delayed ACK can make the offer the last cached outbound despite an intervening question. Original outbound records are now checked, and review regressions cover reordered cache and false old preview timestamps.
4. Existing test clocks contradicted the early-response scenario. Corrected the simulated chronology without dropping or weakening its denial assertion.
5. A fake analyzer alone could hide a request-contract mismatch. A new test composes the unchanged production analysis adapter with a fake HTTP response and verifies full chronological text reaches the existing request body.

## Decision and residual risks
PASS for the bounded implementation and continued isolated development. Keep PR DRAFT: **NOT READY FOR MAIN MERGE OR LIVE ACTIVATION**.

Remaining limitations owned by the Maya integration work:
- Arbitrary multi-turn clarification, changes of topic during an offer, and clarification completion after another outbound question remain blocked/reviewed rather than guessed.
- Recovery from an ACK that has not yet arrived, an echo arriving only after the ACK-only record, queue retry/reawakening after earlier handoff, physical clock granularity/skew and post-claim network races remain separate release work. No exactly-once physical delivery claim.
- Recent outbound IDs still rely on the canonical gateway-maintained bounded index; malformed/incomplete entries fail closed. Live source materialization, security and index parity must be verified before activation. Conservative original-outbound checks may hand off legitimate but temporally unclear conversations and add up to 120 bounded original-message reads; broad-scale cost/performance is not validated.
- Final confirmation rendering/proof/enqueue/claim and recovery after a committed move with a model/send failure remain unfinished.
- Automatic cancellation-triggered discovery/review/ranking, approved contact policies, unbooked workload/new booking, reminder suppression/update, fulfilled waitlist UI, broader offer audit retention, richer subwindows and Papiamento offer renderer remain open.
- Full stack/main reconciliation, integrated emulator/security/concurrency, actual account/selected-phone validation and authorized live new-contact/voice/offer acceptance remain open.

Rollback is removal/reversion of this isolated change before deployment, not any production migration. Christian's explicit merge approval and separate applicable rollout approvals remain mandatory.
