# Task: Route an earlier-offer response through the existing Customer Runtime tools

## Context
Christian authorized continued development and explicitly prohibits any merge without his approval. Parent is PR #491 at `5672eb8f8cbde065e541ac8f1782b6f06914d75a`. No production access, settings, real messages, appointments, deployments or merges are authorized by this task.

## Scope
Connect the current single Customer Runtime registry to the existing recovery acceptance service, retaining the existing tool names and lifecycle confirmation proof. `get_appointment_change_context` reads a scoped earlier offer; `reschedule_appointment` accepts only that exact offer; `record_booking_interest` gains an explicit decline-one-offer action. Prevent an offer response from going through the ordinary Observer dispatch-hold/cancellation path first, and prevent fallback business mutations during a scoped offer response.

This bounded slice supports an unequivocal next current inbound response to an already bound delivery. It does not promise multi-message clarification completion, ACK-lag reconciliation, automatic candidate discovery, proactive trigger activation, live semantic accuracy, finalized customer-message delivery proof, reminder parity or full Maya completion.

## Authorities and invariants
- Customer Runtime V1 remains the only customer model/tool loop. There is no new agent, endpoint, trigger, outbound queue or collection.
- Booking Authority remains the scheduling/capacity authority; reuse the recovery offer service's atomic lifecycle.
- Communication Authority owns identity, phone permissions, current-turn receipts and delivery evidence.
- Business families: COMMS current-turn/ownership/confirmation proof/no invention; OPS-ROUTE, OPS-TEAM and OPS-SVC.
- `recoveryResponseRoutingEnabled` is an explicit new permission, default closed. It must be rechecked inside the transaction that performs any acceptance/decline, including after semantic interpretation. No production value is set.
- Declining one offered time does not withdraw the general waiting preference or cancel the current appointment.
- In a pending offer response, ordinary create/cancel/reschedule fallback tools must not create a duplicate or target another appointment. Ambiguity or unsupported changes require clarification/handoff, not inference of authorization.
- Prior completed responses may replay only for their exact current source. Later unrelated turns resume the normal pipeline.

## Acceptance criteria
1. Actual registry + actual Runtime + injected model calls can read an offered Tuesday time, accept through canonical recovery service, prove `appointment_rescheduled`, and retain the original Thursday booking on every rejected/failed mutation.
2. Actual registry can decline only the offered time; no general preference withdrawal and no appointment change.
3. Current queue identity, selected phone, account, ownership, flags, delivery and exact offer/version/option are checked; changes during interpretation block commit.
4. Ordinary conversations retain existing tool dispatch and Observer behavior.
5. A scoped response is not classified into a new Observer dispatch hold before recovery tools process it.
6. Wrong/missing/stale evidence and unavailable storage never become a successful action or an unrestricted fallback.

## Verification and review
Run retained architecture/booking/runtime tests plus new `mayaRecovery*.test.js` suites, full applicable syntax/type/build gates. Separate Solo Maintainer Adversarial Review (not independent review) must record findings and limitations. Synthetic fixtures only; no demo records in the ERP. Keep draft and not merge-ready until broader stack integration and all applicable gates are satisfied.
