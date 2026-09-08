# Maya recovery matching — 2026-09-07

## Task / owner authorization

Christian requested continued development after PR #487. This child branch starts at `f1c77773ad68869e75a20ce02612618b6f0232a4`. It does not reconcile the parent lineage with main or authorize deployment, customer sends, configuration changes or live appointment mutations.

Delivery mode: Deep Review / Solo Maintainer Adversarial Review. The implementation and separate review passes are performed by the same assistant; not independent review.

## Scope

Connect canonical cancellations and recorded waiting preferences to the existing Scheduling Provider through a read-only office action. Inspect a bounded page of the active account's waiting preferences. A compatible result is a reviewable snapshot, never a booking offer, capacity hold, contact authorization or guarantee of later availability.

Existing earlier-appointment requests supply their complete workload through their canonical Appointment. Unbooked waiting records from #487 have no verified workload; they must be reported as needing work details instead of guessing quantities, service or duration. Capturing that workload, recovering historic conversations and sending/accepting proactive offers remain follow-on work.

## Authority and business rules

- Booking Authority / Scheduling Provider: routes, crew, workload, operating calendar and capacity. Never invoke the office route-advisory or manual-move exception for Maya.
- Canonical appointments: true cancellation, original booking identity, workload, former assignment and released capacity IDs.
- Communication Cases: existing waiting preference only. Current conversation, source message, party resolution and phone allowlist are revalidated for candidate use.
- Office Booking Authority: existing authentication/role boundary before read action.
- `OPS-ROUTE-*`, `OPS-TEAM-*`, `OPS-SVC-*`, `PRICE-*`, `COMMS-*` remain unchanged. No new priority/response-deadline/contact-hour policy is invented.
- No new collection, queue, endpoint, secret, security rule, production setting or scheduling source of truth.

## Acceptance

1. A future actual cancellation may be inspected; a dispatch hold, elapsed target or malformed source may not.
2. A recorded earlier-date interest with current evidence and unchanged original booking can match only an exact provider-issued option within the cancelled appointment's former capacity.
3. Existing route, crew, calendar, complete workload and capacity checks remain enforced. Reoccupied locks cannot be treated as available.
4. Withdrawn, expired, changed identity/booking, newer unread customer input and non-allowlisted requests are not compatible candidates.
5. New unbooked requests without verified work details remain `needs_work_details`.
6. Reads are snapshot-consistent and expose no write capability to the Scheduling Provider. Repeated schedule queries share their snapshot within one evaluation page.
7. No appointment, work order, capacity lock, offer, message or Case is written. Original appointment is untouched, including on errors.
8. The UI distinguishes compatibility for review from customer acceptance or a capacity reservation.

## Verification and review

To be completed against the exact implementation revision. Required: focused matching tests with real Scheduling Provider, office authentication/denial tests, existing Maya/workspace/cancellation and scheduling tests, relevant types/build, separate adversarial diff review. No real model, provider phone or production data may be used. In-memory tests must not be described as Firestore-emulator or distributed-contention evidence.

## Rollback / remaining boundary

Discard or revert the isolated child branch. Nothing is activated. All main reconciliation, emulator/index/security evidence, production approval, proactive offers, current customer confirmation, and commit-time scheduling revalidation remain required before live autonomy.
