# Maya Cancellation & Reschedule Pilot V1.1

## Scope

This slice extends Maya's already-governed Communication Center pilot with canonical appointment cancellation and rescheduling tools. It does **not** enable production autonomy by itself.

## Authority boundaries

- Communication ownership remains authoritative for who may send to the customer.
- `businessSettings/customer-agent.autoCancelEnabled` and `autoRescheduleEnabled` independently gate irreversible appointment mutations.
- Booking Authority remains the only scheduling/capacity/lifecycle authority.
- Maya never writes appointment/work-order/capacity state directly.
- Observer + Communication Case determine whether one exact appointment has been safely correlated.
- `get_appointment_change_context` exposes only that exact current case appointment to Customer Runtime; it is not a broad appointment search tool.
- The exact inbound Customer Agent queue receipt supplies the expected communication epochs for a mutation.
- Booking Authority commits only after the transactional guard revalidates the active communication account, Maya sender ownership, `ownershipVersion`, `customerInputVersion`, exact current Case appointment, and the relevant autonomy flag.
- Only a current `APPOINTMENT_MATCHED` Case may authorize an irreversible appointment mutation. Clarification/escalation states fail closed.

## Reschedule scope preservation

A Maya reschedule may move an appointment in time, but it may not silently change the work being performed.

Before commit, the guard verifies that the selected canonical booking offer preserves the appointment's:

- customer,
- property,
- complete work-line workload.

If any of those differ, the reschedule fails closed. This deliberately protects multi-line or multi-unit appointments even when the conversational availability tooling cannot reproduce their full scope.

## Replay and idempotency

Appointment mutations use a deterministic `customerAgentMutationReceipts` execution receipt scoped to the exact conversation, inbound turn, action and material mutation target.

- The receipt is written atomically inside the same Booking Authority transaction as the successful mutation.
- It is execution proof only; it is **not** appointment or scheduling state and never replaces Booking Authority.
- A retry of the same material action may replay only while the canonical appointment still proves the committed result.
- A materially different appointment/offer/option on the same turn fails with an idempotency conflict.
- Free-text reason/note wording is preserved for audit but is not part of the material mutation fingerprint, so harmless wording changes on retry do not create false conflicts.

## Customer-facing proof

Maya may not claim an appointment was cancelled or rescheduled merely because the customer asked for it or because a model inferred it.

- `appointment_cancelled` requires canonical proof from `cancel_appointment` for the exact appointment in that turn.
- `appointment_rescheduled` requires canonical proof from `reschedule_appointment` for the exact appointment in that turn.
- If the mutation is disabled, stale, denied, ambiguous, loses availability, or would change appointment scope, Maya must not claim completion.

## Pilot defaults

Initial safe rollout remains fail-closed:

- `autoCancelEnabled = false`
- `autoRescheduleEnabled = false`

Conversation-level cancellation/reschedule replies can remain enabled separately from these mutation flags.

## Race protection

The transactional mutation guard prevents a stale Maya decision from committing when:

- an operator takes over the conversation,
- an operator takes over and later returns it to Maya,
- a newer customer message changes the current turn,
- the communication account changes,
- the Case no longer matches the exact inbound message,
- the model supplies a different appointment than the Case correlated,
- the feature flag is disabled before commit.

## Non-goals

This slice does not:

- merge or deploy Maya to production,
- activate automatic cancellation/rescheduling,
- replace Communication Cases or dispatch holds,
- create another scheduling source of truth,
- perform a broad customer-appointment search from Maya,
- change historical-audio policy.
