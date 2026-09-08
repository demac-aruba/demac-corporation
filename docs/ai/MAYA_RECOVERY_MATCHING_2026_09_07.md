# Maya recovery matching — 2026-09-07

## Task and authorization

Christian requested continued development after PR #487. PR #488 is a child of `feature/maya-operations-workspace-20260906` at `f1c77773ad68869e75a20ce02612618b6f0232a4`. It does not reconcile the parent lineage with main or authorize deployment, customer sends, configuration/security changes or live appointment mutations.

Delivery mode: Deep Review / **Solo Maintainer Adversarial Review**. Builder and reviewer are the same assistant performing separate implementation and review passes. No independent engineer reviewed this slice. One workflow commit message used the phrase "independent review-pass cases"; it refers to separation of the pass, not to an independent reviewer, and is not independent-review evidence.

## Implemented slice

- `inspect_maya_recovery_candidates` is a new read action on the existing Office Booking Authority facade. It is not a new endpoint or deployed Function.
- The request accepts only a canonical cancelled Appointment ID and bounded pagination. The server derives the former date, start, primary Van, end and capacity references. Caller-supplied route, slot and office/manual-move overrides are rejected.
- Only actual cancellations with recorded provenance and a future valid former interval can be inspected. Pending dispatch holds are not cancellations. An ambiguous primary assignment is rejected.
- Waiting preferences are read from the configured communication account, at most ten records per page plus one lookahead. Cursors must belong to the same account and case type. Page order is not a contact priority or a ranking decision.
- Candidate evidence is checked again: current selected-phone allowlist, Maya reply permission/ownership, source message/transcript, recorded source quotation, customer/ownership input versions, unambiguous CRM party, active property/address/sector and the exact stored preference identity.
- Any later customer message or changed ownership requires review/reconfirmation in this slice. It does not claim to have interpreted later conversation history. Withdrawn, expired or incompatible date preferences are excluded.
- Earlier-appointment requests use the complete current canonical Appointment workload and linked Work Orders, not a guessed duration. Changed original date/time, ownership, dispatch restrictions, started/non-open work or missing workload prevent a compatible result.
- The real Scheduling Provider checks the exact former primary start and Van under `channel=whatsapp`, never the office route-advisory/manual-move exception. Canonical route, operating-calendar, crew, duration and capacity decisions remain there.
- Every required capacity key must fit within the cancelled appointment's former keys. Actual stored capacity records must explicitly be released and match the exact key/date/Van/slot; missing records are not release proof. Reoccupied slots or active locks are rejected.
- Original appointments are excluded only from the hypothetical availability calculation. No existing Appointment, Work Order, capacity lock, offer, message or Communication Case is written.
- Unbooked waiting records from #487 do not contain a verified workload. They are reported as `needs_work_details`; this slice does not guess their service, quantity or duration.
- `compatible_for_review` is a scheduling snapshot, not customer acceptance, a booking offer, a reservation, consent to contact or a guaranteed future opening. Results explicitly carry `capacityReserved=false`, `proactiveContactAuthorized=false`, `requiresFreshBookingOffer=true` and `rankingPolicyApplied=false`.

## UI and unchanged behavior

Each cancellation card gains an on-demand `Check waiting-list compatibility` section. It shows a page of candidates, human-readable reasons, an Aruba-time check timestamp and any compatible earlier date/time. It offers refresh and next-page controls, but no send/reserve/reschedule control.

The existing operations component changes only through one import and the inspection component insertion. Its existing cancellation details, waiting list, date filters, search, pagination and navigation are preserved. Existing theme variables and typography are reused. Requests are not automatically started by rendering a cancellation card. A serial request guard suppresses obsolete responses when the target/component changes. Each page is a separate snapshot rather than a misleading accumulated all-time match list.

## Authority and security

- Booking Authority / Scheduling Provider remains responsible for routes, crew, full workload, operating calendar and capacity.
- Canonical appointments remain the source of cancellation and original-booking identity.
- Existing Communication Cases carry waiting preference workflow state only.
- The existing Office Booking Authority authenticates requests. The new cross-customer inspection additionally requires an explicitly active canonical office profile rather than accepting an absent profile through the older token-role fallback. Existing unrelated actions are unchanged.
- Expected inspection errors retain safe actionable codes and fixed public messages. Unexpected storage/provider diagnostics are not exposed as customer IDs, stack traces or raw index links through this new action.
- `OPS-ROUTE-*`, `OPS-TEAM-*`, `OPS-SVC-*`, `PRICE-*` and `COMMS-*` are unchanged. No new priority, response deadline, contact-hours or outreach policy is invented.
- No new collection, WhatsApp queue, runtime, endpoint, secret, security rule, production setting or scheduling source of truth.

## Snapshot/read behavior

One evaluation page uses a Firestore read-only transaction. The Scheduling Provider receives a restricted cached reader with no writes or nested transaction method. Provider capacity validation dereferences those wrappers through the reader; wrappers are never passed to Firestore as if they were native references.

Identical master-data/scheduling queries share their snapshot within a page. This avoids repeating the same queries for every candidate, but the existing Scheduling Provider still scans several master collections. This is not an assertion that all underlying dataset reads are bounded. Review volume/cost and indexed query strategy before broad scale.

A read-only transaction provides a consistent point-in-time view, not a capacity lock or a guarantee that permissions/capacity remain unchanged after the check. It may read an earlier consistent snapshot. The UI check timestamp is not proof of a successful booking or exact provider snapshot timestamp. A later offer and commit must revalidate current permissions and scheduling state.

## Automated evidence

Last implementation/test/workflow revision: `b5e546e1a1c310208112b9e6e05fb295a3cd7f8e`.

The required workflow executes:

```sh
node --check mayaOperationsReadModel.js && node --check demacCustomerBookingInterest.js && node --check mayaRecoveryMatching.js
node --test demacCustomerBookingInterest.test.js officeMayaOperations.test.js mayaOperationsReview.test.js mayaRecovery*.test.js
```

The four new suites contain 52 tests: 30 matching, 9 separate-review, 9 office-access/error and 4 capacity-proof tests. Together with the three retained workspace/preference suites, the focused command contains 105 tests. Existing Booking Authority, Office, commercial sales, product reservation, formatting, Customer Agent and single-runtime assertions remain in the required path; none were disabled or waived.

The Customer Agent Architecture workflow on this implementation revision (`34179248648`) completed successfully, including the new focused command and every retained downstream test step. The exact final delivery SHA, all triggered workflow outcomes and explicitly skipped production jobs are recorded in PR #488 after verification. Earlier passing revisions are not substituted for final-head evidence.

Test examples include the real Scheduling Provider finding Tuesday for a Thursday booking while preserving Thursday, reoccupied Work Orders/locks, oversized work, complete source/identity validation, selected-phone removal, newer messages and takeover, unbooked missing workload, impossible source dates, bounded pagination, query reuse and failure propagation. A real office advisory control can accept a physical target that the Maya route-enforced path correctly rejects. Sunday closure and Van half-day exclusions are exercised.

Persistence is synthetic in-memory data with read-before-write checks. These tests are not a Firestore emulator, distributed contention, production dataset, real model/transcription/WhatsApp or browser-rendering result. Typecheck/build does not establish browser/mobile/accessibility correctness. No live customer data or test/demo records were inserted into the operational ERP.

## Separate adversarial review findings

| Finding | Evidence and resolution |
| --- | --- |
| Provider validation builds references from the restricted reader. | Added a read-only transaction adapter that invokes the wrapped snapshot getter; real-provider composition tests pass. |
| A valid business rejection was translated into `internal_error`. | The first review suite failed on HTTP inspection of a missing cancellation. Added scoped fixed-message error mapping; the original assertion is retained and passes. Unknown failures remain failures, not empty healthy results. |
| Existing Office authentication can fall back to a token role for a missing profile. | New inspection requires an explicitly active canonical office profile. Missing/inactive/no-role/technician cases are denied before candidate reads. Unrelated office actions are unchanged. |
| Absent capacity records could be treated as proof of a free former slot. | Now require explicit release plus exact lock/date/Van/slot identity, with negative regression coverage. |
| Multiple former primary assignments could cause an arbitrary choice. | Require exactly one primary. Support assignments remain supported within the former capacity bounds. |
| A compatibility result could be mistaken for contact priority or a reservation. | API and UI explicitly state no contact authorization, no reservation, no priority policy and fresh offer/commit checks required. |

The review inspected the final matcher, provider callers, facade/auth/error handling, UI integration, changed-file scope and required test path separately from the first implementation. No independent-review claim is made.

Decision: this bounded read-only slice supports continued isolated development after the final checks. Keep the PR draft. It is not approval for main merge, production activation, autonomous outreach or full Maya completion.

## Remaining product and rollout work

- Recover and reconcile requests from recent conversations, including harmless follow-up messages versus genuine changes of mind. Current exact-version checks are intentionally conservative.
- Capture and verify complete work details for customers without an appointment; structure more detailed time-of-day preferences where necessary.
- Consider later subwindows within larger cancelled appointments. The implemented matcher targets the exact former primary start, not every possible placement in the day.
- Define approved ranking, contact-hours/provider policy, offer expiry and any real temporary hold; implement governed proactive offers and customer acceptance.
- Atomically rebook/reschedule through Booking Authority, preserving the original booking on failure, with new current permission/capacity validation.
- Browser/mobile/accessibility verification and isolated visual preview; real contact/voice/model/provider end-to-end tests.
- Main/parent branch reconciliation, Firestore emulator/index/security evidence, production account/settings/phone checks, reminder suppression and all explicit rollout approvals.

## Rollback

Discard or revert this isolated child branch. Nothing is activated by the development work. No production merge, dispatch, message, appointment change or settings/security update was performed.
