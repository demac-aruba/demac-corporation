# Task: Route an earlier-offer response through the existing Customer Runtime tools

## Context
Christian authorized continued development and explicitly prohibits any merge without his approval. Parent is PR #491 at `5672eb8f8cbde065e541ac8f1782b6f06914d75a`. No production access, settings, real messages, appointments, deployments or merges are authorized by this task. Delivery PR: #492, branch `feature/maya-recovery-chat-routing-20260908`.

## Scope
Connect the current single Customer Runtime registry to the existing recovery acceptance service, retaining the existing tool names and lifecycle confirmation proof. `get_appointment_change_context` reads a scoped earlier offer; `reschedule_appointment` accepts only that exact offer; `record_booking_interest` gains the explicit `decline_offer` action with every other argument empty. Prevent an offer response from going through the ordinary Observer dispatch-hold/cancellation path first, and prevent fallback business mutations during a scoped offer response.

This bounded slice supports an unequivocal next current inbound response to an already bound delivery. It does not promise multi-message clarification completion, ACK-lag reconciliation, automatic candidate discovery, proactive trigger activation, live semantic accuracy, finalized customer-message delivery proof, reminder parity or full Maya completion.

## Authorities and invariants
- Customer Runtime V1 remains the only customer model/tool loop, with the same eighteen capability names. Registry version advances from 8 to 9. There is no new agent, endpoint, trigger, outbound queue or collection.
- Booking Authority remains the scheduling/capacity authority; reuse the recovery offer service's atomic lifecycle.
- Communication Authority owns identity, phone permissions, current-turn receipts and delivery evidence.
- Business families: COMMS current-turn/ownership/confirmation proof/no invention; OPS-ROUTE, OPS-TEAM and OPS-SVC.
- `recoveryResponseRoutingEnabled` is an explicit permission, default closed. It is rechecked inside every recovery action transaction, including after semantic interpretation. No production value was set.
- The Observer records a small `mayaRecoveryResponseRoute` receipt on the existing current inbound message. It binds the offer/version and input/ownership epochs; it is derived routing evidence, not consent or scheduling authority. Removing/replacing the conversation's offer pointer cannot reopen ordinary tools for that already-scoped message.
- Declining one offered time does not withdraw the general waiting preference or cancel the current appointment.
- In a pending offer response, ordinary create/cancel/availability/other business tools cannot create a duplicate or target another appointment. Ambiguity or unsupported changes require clarification/handoff, not inferred authorization.
- Prior completed responses may replay only for their exact current source. Later unrelated turns resume the normal pipeline.

## Acceptance and implementation evidence
1. The actual registry and actual existing Runtime execute scripted model calls to read an offered Tuesday time, accept through canonical recovery service, prove `appointment_rescheduled`, release Thursday capacity only after successful commit, and fulfill the waiting case.
2. The actual Runtime can decline only that offered time; the general waiting preference and Thursday appointment remain unchanged.
3. Current queue identity, selected phone, account, ownership, flags, exact offer/version/option and delivery remain checked. Revoking the new routing flag during interpretation prevents the final commit.
4. Ordinary messages without a pending offer keep the original Observer and registry dispatch.
5. Actual Observer service routes a scoped response without invoking ordinary observation/Case effects or creating a new dispatch hold. Duplicate routing detection is idempotent.
6. Actual debounce orchestrator, actual Observer gate, actual Runtime, actual registry and canonical lifecycle compose in a controlled integration test. The communication dispatcher is injected to invoke the real Runtime; final reply transport/session persistence is not claimed by this test.
7. Read-only tool/context lookups do not write a routing receipt. Only the Observer's explicit recording path may do so, after current account/message/epoch proof.

## Automated verification
Last source/test revision: `203c9bf1141a19a091ec41ea758c8da8c1b34125`.

All three triggered workflows passed on that source/test revision:
- Customer Agent Architecture: `34254289376`; job `102156066243` explicitly inspected. Focused waiting/history/recovery tests plus retained Booking Authority, Office, commercial, reservation, formatting, Customer Agent and single-runtime/router checks all succeeded.
- Customer Agent Production validation: `34254289235`; validation succeeded and `deploy-customer-agent-production` was explicitly SKIPPED.
- TypeScript and web build validation: `34254289206`; typecheck and Expo web build steps explicitly inspected and successful.

The two new suites contain 47 tests (34 routing/runtime, 13 adversarial/Observer/orchestrator cases), and execute via the retained `mayaRecovery*.test.js` command. No required tests/assertions were deleted, weakened, disabled or waived. This documentation-only commit follows the verified source/test revision; exact delivery-HEAD workflow status is reported separately in the PR metadata rather than inferred from these runs. No additional ERP Next, Office production or transport production workflow is claimed for this slice.

## Separate Solo Maintainer Adversarial Review
Mode: Solo Maintainer Adversarial Review, NOT independent review. Builder and reviewer are the same assistant in separate implementation/review passes.

Review re-read the request, root guidance, authority/rule/gate contracts and relevant existing Runtime, registry, Observer, orchestrator, offer/lifecycle and reply-policy callers. Complete changed-file list and patches for both preexisting files were inspected. No unrelated change is present in those patches.

| Finding | Risk | Correction/evidence |
| --- | --- | --- |
| Removing an offer pointer after Observer routing could allow the same input to fall back into ordinary business tools | Duplicate or wrong-path scheduling attempt | Bind a routing receipt to the original current message, recheck it in the adapter; removal/version replacement regressions pass |
| A completed response replay could disclose earlier customer data after CRM reassignment, or confirm a booking whose work/capacity ownership changed | Cross-customer disclosure or obsolete confirmation | Re-resolve canonical party/property and verify accepted appointment fingerprint plus current linked Work Order/capacity ownership inside the guarded transaction; four explicit regressions pass |
| Routing permission could be revoked during external semantic interpretation | A preflight-only permission would be stale | Guard every parent service transaction, not only initial tool dispatch; mutation-during-analysis regression passes |
| Mutable/invalid terminal-response metadata could release routing prematurely | Unsafe fallback | Validate terminal decision/status/source-version structure before returning to the ordinary path |

### Residual risks and release blockers
- This is a deliberately bounded offer-response mode. While an offer is pending, unrelated operational changes (including a new cancellation request), complex questions or multi-message replies are not automatically routed to another mutation. They require explicit clarification/scheduling handoff. Semantic mode transitions must be completed before the full autonomous product is declared ready.
- A reply received before delivery binding or outside the first eligible input remains fail-closed; late-ACK reconciliation and safe multi-message follow-up are not implemented here.
- The Runtime's existing verified `reschedule_appointment` result enables its existing structured confirmation outcome. Revalidation/rendering of the final confirmation at outbound enqueue/claim, recovery after a model failure following a committed move, and the actual confirmation message's physical delivery still require integration evidence.
- Natural model selection of the tools, true multilingual interpretation, voice-device delivery, physical WhatsApp, Firebase emulator/index/security/distributed-contention and browser behavior remain unverified.
- Tests use synthetic in-memory persistence, fake transport/input records, scripted model calls and controlled semantic results. They exercise real domain/Runtime modules; they are not live-provider or production evidence. Local network could not resolve GitHub, so no local whole-repository clone/test result is claimed.
- Automatic cancellation-triggered discovery/ranking, unbooked-customer work details, reminders, fulfilled-state UI, complete offer audit history, richer time windows and Papiamento offer rendering remain unfinished, as does parent/main reconciliation.

Decision: implementation plus automated evidence supports continued isolated development of this bounded integration. KEEP DRAFT; NOT READY FOR MERGE, deployment, outreach activation or full Maya completion. Christian's explicit merge approval and separate applicable rollout approvals remain mandatory.
