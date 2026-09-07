# Maya operations workspace and waiting preferences — 2026-09-07

## Task and delivery boundary

Owner request: continue the already-authorized Maya construction, following explicit cancellation recovery in PR #486. PR #487 is a child of `feature/maya-cancellation-recovery-20260906` at `8207fa78457d75c4f8f0de57a0f60ce768137676`, not a merge to main.

Delivery mode: Deep Review / Solo Maintainer Adversarial Review. Builder and reviewer are the same assistant in separate implementation and review passes; this is not independent review.

This bounded slice implements a read-only operations screen and current-turn preference capture. It does not complete proactive capacity recovery, activate production, or reconcile the older Maya lineage with current main.

## Implemented behavior

- `/customer-ai/operations` provides cancellation history and waiting/earlier-date preferences. The existing Maya page keeps its Communication Center and gains a navigation link; its chat implementation is not replaced.
- Cancellation history reads canonical `appointments` with a recorded `cancelledAtIso`, actual cancelled state, and canonical Customer/Property enrichment. A dispatch hold is not a cancellation. A past cancellation never proves the slot is still available today.
- Cancellation date filters use Aruba day boundaries, at most 31 calendar days. Queries are paginated, default 25 and maximum 50 records plus one lookahead. Cursors are validated against the selected scope. Records without a canonical cancellation timestamp are explicitly outside this view's coverage; no historical migration is performed.
- Waiting preferences distinguish `new_appointment` from `earlier_appointment`. Read projections flag withdrawn, expired and changed/invalid original-booking records instead of silently treating them as candidates.
- The single Customer Runtime registry exposes `record_booking_interest`. It can register or withdraw a preference from the current customer's exact quoted text or completed transcript. This is not historical conversation extraction.
- Capture remains disabled unless `businessSettings/customer-agent.bookingInterestEnabled === true`. Every write rechecks active account, current selected-phone allowlist, reply permission, Maya ownership, queue-backed ownership/customer-turn epochs, source-message identity, canonical party resolution and property relationship in the same transaction.
- An earlier-date request must reference a current open appointment with valid date/time; the original appointment is never moved, cancelled or temporarily released by this tool. Withdrawal preserves prior evidence without reading a potentially reassigned appointment.
- Waiting records have deterministic identities, material same-turn fingerprints and bounded source history. The complete Customer/Property/kind/Appointment identity is hashed before passing through the existing case-identity helper, avoiding its case-type length truncation.
- Neither capture nor the read projections reserves capacity, claims route compatibility, authorizes contact, or queues a WhatsApp message. Proactive-contact and capacity-reservation result flags remain false.

## Authority decision

Reuse existing `communicationCases` for `booking_interest` workflow state and the existing Office Booking Authority facade for authenticated list reads. Booking Authority remains the only appointment/capacity authority. Existing canonical CRM records remain the only Customer/Property authority. Original messages/transcripts are evidence; a waiting preference is derived workflow state, not a new appointment, offer, contact ledger or sender.

No new Firestore collection, backend endpoint, deployed Function, queue, sender, security rule, credential or production setting is introduced by this slice. The existing runtime tool registry is extended rather than forked. The existing office role check is preserved before either new list action.

Relevant boundaries: `COMMS-*` current-turn/ownership/no-invention behavior; `OPS-ROUTE-*` canonical routing; `PRICE-*` no inferred price/duration; protected scheduling identity and capacity rules. No route, price, crew or duration decision is made by this preference layer.

## Acceptance and verification

The required Customer Agent Architecture workflow now explicitly checks syntax and runs:

```sh
node --test demacCustomerBookingInterest.test.js officeMayaOperations.test.js mayaOperationsReview.test.js
```

Existing Booking Authority, office, commercial, reservation, customer-agent and single-runtime assertions remain in the validation path. Registry-count assertions were updated from 17 to 18 and extended with the new dispatch capability; no prior business assertions were removed or waived.

Focused coverage includes register/withdraw/replay, original-booking preservation, no capacity or outbound writes, exact source quotation, wrong customer/property/account, missing/disabled pilot configuration, allowlist revocation, stale customer input, human ownership, failed audio content, transactional rollback, authentication/role rejection, pagination/date/cursor scope, incomplete data, elapsed appointments, foreign-booking withdrawal and long-identity separation.

The earlier complete UI revision `d17a09ca8ae4724e110dd516708f5bec333ea1a8` passed six PR workflows. That is baseline evidence only. Final source/review-test revision is `c9e7484452236f298eb313e639afbc26c7088dbd`; the final delivery HEAD and exact CI run outcomes are recorded in PR #487, not inferred from the earlier baseline.

Persistence tests use real domain modules and synthetic in-memory data with read-before-write and rollback enforcement. They do not exercise Firestore emulator indexes, actual provider/model/transcription output, true distributed Firestore contention, production accounts, or live WhatsApp phones. Typecheck/build evidence is not a browser visual inspection.

## Separate review findings

| Finding | Resolution |
| --- | --- |
| Missing CRM references or malformed work lines could break read projections. | Null/type guards and regression coverage added; invalid identity remains explicitly reviewable. |
| A same-day appointment could already be past or have invalid time. | Strict date/time checks and elapsed-slot projection added. |
| Withdrawal could read a now-foreign original appointment. | Withdrawal keeps the prior snapshot and does not read that appointment. |
| Long property IDs could truncate appointment identity inside the shared case helper. | Hash the complete identity first; validate stored appointment and kind; regression tests added. |
| The review regression file was not initially in the required CI command. | Added to the command and workflow path coverage; final validation must execute it. |
| Existing router capability count still expected 17 after adding the tool. | Updated the count to 18 while retaining the single-runtime/export assertions. |

Decision: suitable for continued isolated-branch development once the final required checks pass. NOT approved for main merge, production deployment, autonomous outreach, or complete-product status. The draft must remain open until the broader integration and human approval boundaries are met.

## Explicit unfinished work

- Recent/historical conversation recovery with current-interest confirmation, not blind backfill.
- Complete service/workload details for unbooked waiting requests, candidate ranking and current property/sector/route/crew/duration matching through Booking Authority.
- Governed proactive offers, contact-time policy, provider messaging eligibility, offer expiry or real temporary holds, customer acceptance and atomic earlier rescheduling that preserves the original booking on failure.
- End-to-end model behavior and proof of natural-language claims, new-contact/voice testing, frontend browser/accessibility/mobile validation and an isolated preview for owner review.
- Main-line reconciliation, deployed-account/settings verification, Firestore emulator/index/security evidence, reminder suppression and the original P0 rollout approvals.

## Rollback and production safety

No production action was taken. Discarding/reverting this isolated branch removes the slice. A later approved rollout must retain `bookingInterestEnabled=false` until pilot acceptance, plus the existing reply/ownership and separate appointment-action controls. No test/demo data may be inserted into the operational ERP. Turning capture off must not delete historical customer evidence or alter existing appointments.
