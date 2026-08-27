# Maya Cancellation & Reschedule Pilot V1.1

## Scope

This slice extends Maya's already-governed Communication Center pilot with canonical appointment cancellation and rescheduling tools. It does **not** enable production autonomy by itself.

## Authority boundaries

- Communication ownership remains authoritative for who may send to the customer.
- `businessSettings/customer-agent.autoCancelEnabled` and `autoRescheduleEnabled` independently gate irreversible appointment mutations.
- Booking Authority remains the only scheduling/capacity/lifecycle authority.
- Maya never writes appointment/work-order/capacity state directly.
- The exact inbound Customer Agent queue receipt supplies the expected communication epochs for a mutation.
- Booking Authority commits only after the transactional guard revalidates the active communication account, Maya sender ownership, `ownershipVersion`, `customerInputVersion`, and the relevant autonomy flag.

## Customer-facing proof

Maya may not claim an appointment was cancelled or rescheduled merely because the customer asked for it or because a model inferred it.

- `appointment_cancelled` requires canonical proof from `cancel_appointment` for the exact appointment in that turn.
- `appointment_rescheduled` requires canonical proof from `reschedule_appointment` for the exact appointment in that turn.
- If the mutation is disabled, stale, denied, ambiguous, or loses availability, Maya must not claim completion.

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
- the feature flag is disabled before commit.

## Non-goals

This slice does not:

- merge or deploy Maya to production,
- activate automatic cancellation/rescheduling,
- replace Communication Cases or dispatch holds,
- create another scheduling source of truth,
- change historical-audio policy.
