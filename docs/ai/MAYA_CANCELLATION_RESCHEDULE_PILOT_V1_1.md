# Maya Cancellation & Reschedule Pilot V1.1

## Scope and implementation status

The lifecycle slice extends Maya's governed Communication Center with canonical appointment cancellation and rescheduling tools. PR #486 is the owner-authorized cancellation-recovery continuation of #440, itself based on #436. None of these dependencies is implicitly merged to main or activated by this document.

This backend slice does **not** mean that the complete Maya product, cancellation list, waitlist, proactive earlier-date offers, or live voice pilot is finished.

## Authority boundaries

- Communication Authority owns who may send to the customer.
- `businessSettings/customer-agent.autoCancelEnabled` and `autoRescheduleEnabled` independently gate appointment mutations.
- Booking Authority remains the only scheduling/capacity/lifecycle authority. Maya calls its lifecycle; it does not write appointment/work-order/capacity truth directly.
- Observer + Communication Case correlate one exact appointment. The context tool is not a broad appointment search.
- The exact inbound Customer Agent queue receipt supplies expected communication epochs.
- The transaction rechecks active communication account, Maya sender ownership, `ownershipVersion`, `customerInputVersion`, current reply permission, exact phone allowlist and the corresponding autonomy flag.
- Pilot reply exceptions for new contacts or appointment workflows cannot bypass the mutation phone allowlist.
- The actual `communicationCases` document and actual appointment are read transactionally. The conversation's projected insight alone is insufficient.

## Explicit cancellation recovery

A clear customer cancellation request does not require a second confirmation or a customer-provided reason. Uncertainty about cancellation versus moving the appointment, identity or the target appointment still requires clarification.

P0 places a correlated cancellation into `AWAITING_CUSTOMER_DECISION` when it protects dispatch. This state previously prevented the lifecycle tool from progressing. It is now acceptable for **cancellation only**, subject to all of the following:

- both the current conversation insight and actual Case identify cancellation with confidence at least the existing shared `DISPATCH_HOLD_CONFIDENCE` threshold;
- the actual Case matches account, conversation, current source message, appointment, customer, type and state;
- no attention reason requires clarification or human review;
- the canonical appointment is still open for customer change;
- an active dispatch hold belongs to this exact Case;
- all other current policy, ownership and transaction checks pass.

`APPOINTMENT_MATCHED` remains supported, with canonical Case checks. Clarification/escalation states remain denied. The held-state exception is deliberately **not** applied to pending reschedules: a desire to move is not acceptance of an offered replacement slot.

An explicit cancellation date/time is not ignored merely because only one future appointment exists. Conflicting values or an unresolved structured date/time produce a clarification case without a new dispatch hold or cancellation.

When the customer supplied no reason, the tool passes the internal audit category `customer_requested_cancellation` to the lifecycle. This is not a fabricated customer explanation; the original customer source message remains the evidence. Customer-facing language must not present this internal category as a quotation.

## Linked-record and capacity safety

Before the actual cancellation callback, the same transaction reads all referenced Work Orders and capacity locks.

- Reference arrays must be present and valid.
- Every Work Order must exist and still belong to this appointment, customer and property.
- Automatic cancellation accepts the canonical future-work status `Confirmada`. Unknown, started, completed or otherwise changed Work Order states require office review.
- Every referenced lock must exist, be active and still belong to this appointment and date.
- Foreign, missing or inconsistent links deny the operation instead of overwriting other work or freeing someone else's slot.

Successful cancellation delegates to the existing Booking Authority: it cancels the appointment and linked work, releases its locks and resolves its dispatch hold. The same transaction writes the deterministic execution receipt and resolves the existing Communication Case as `RESOLVED_CANCELLED`.

A dispatch hold by itself is **not** cancellation or newly available capacity. Cancellation records remain canonical appointments/history; the future cancellation-list UI must project that evidence rather than create another schedule or ledger.

## Reschedule scope preservation

The selected canonical booking offer must preserve customer, property and the complete work-line workload. Differences deny the reschedule. Existing final availability checks remain in Booking Authority.

After a successful governed reschedule, the same transaction may resolve the Case as `RESOLVED_RESCHEDULED`. The earlier-date proposal, customer-acceptance lifecycle, preserved original booking, offer expiry and proactive outreach are **not implemented by this recovery slice**.

## Replay, atomicity and customer-facing proof

`customerAgentMutationReceipts` are execution proof, not scheduling state.

- A valid deterministic receipt matching the current action/conversation/message/appointment is required; optional or altered proof cannot bypass completion checks.
- The receipt and Case resolution are committed only after exact canonical lifecycle success.
- A repeated material action can return prior execution proof only while canonical appointment state still proves that result. It makes no new mutation.
- The transaction checks an existing receipt before mutable Case state, so a concurrent retry after Case resolution can take the controlled replay path.
- A materially different appointment/offer/option on the same turn is an idempotency conflict.
- Harmless reason/note rewording does not change the material fingerprint.
- A failed transaction cannot persist partial appointment, Work Order, hold, lock, Case or receipt changes.
- Customer-facing completion still requires canonical same-turn tool proof and current outbound authorization; a prior request, a hold or a failed mutation is not success.

## Pilot and production boundary

No setting is activated here. The prepared initial rollout defaults remain:

- `autoCancelEnabled = false`
- `autoRescheduleEnabled = false`

The owner-approved business objective is autonomous handling of clear cancellations, not an operator approval for every request. Enabling that capability in production is a separate deployment/configuration decision after verification.

The stricter allowlist checks in this slice cover lifecycle mutations. P0 observation/dispatch-hold scope, voice processing and future proactive outreach must also be reconciled with the selected-phone test boundary before a broad pilot can be represented as safe.

Remaining rollout gates include reconciliation with current main, production account/configuration verification, Firestore authority/rules verification, emulator/provider/model acceptance and explicit activation approval. No production settings, secrets, security rules, customer data, messages or historical audio were changed.

See `MAYA_CANCELLATION_RECOVERY_2026_09_06.md` and PR #486 for task scope, test evidence, adversarial review and remaining work.
