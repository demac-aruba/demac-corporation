# ADR-SCHED-MOVE-OT-001: bounded possible overtime in the manual move authority

- Status: Proposed; implemented in an isolated preview, awaiting owner acceptance and release approval.
- Date: 2026-09-21
- Owner: DEMAC Operations / ERP maintainer
- Related rule/task: OPS-SCHED-MOVE-OT-001; ../tasks/manual-move-overtime-20260921.md
- Supersedes: none. A later approved ADR must explicitly supersede this decision.

## Context

The existing manual destination calculation discards incomplete ordinary tails. The
requested three-slot transfer at 14:30 must stay selectable with two ordinary spots.
Booking Authority already owns atomic moves; after-hours owns open-ended emergencies.
An estimate must not create worked overtime, new booking authority, or extra ordinary slots.

## Decision

Extend the existing operational move transaction with a read-only preparation mode.
Use the canonical slot schedule, crew/calendar resolvers and work-order duration.
The returned proposal binds the displayed calculation to the request, authenticated
operator, source Appointment/Work Orders and resolved crew. Confirmation must explicitly
accept that proposal; every constraint is recalculated in the write transaction.

Preserve the full fixed duration and slot count. Atomically update the same Appointment,
linked Work Orders, owned locks, lifecycle audit and a receipt in bookingIdempotency.
Store additive operationalMoveOvertime metadata on the existing documents. Reuse the
after-hours BAH document to serialize with emergency creation without turning the move
into open-ended work. Existing readers protect its bounded capacity tail. A later normal
move/reschedule clears the current estimate while historical acceptance remains in audit.

The normal automatic/Maya candidate schedule is unchanged. Multi-assignment support
bookings remain on the existing coordinated workflow. No direct client writes, new
collection, migration, security-rule change or notification producer is introduced.

## Alternatives considered

| Alternative | Benefit | Reason rejected |
| --- | --- | --- |
| Increase ordinary slots | Simple UI | Would expand automatic/Maya availability |
| Convert to an after-hours emergency | Existing feature | Would lose bounded duration/identity semantics |
| Browser-only override | Minimal backend work | Cannot protect races, permissions or audit |
| New reservation service | Isolated implementation | Creates competing booking authority |

## Consequences

- Full ownership survives refresh and retries, including a capacity tail longer than work effort.
- Read-only preparation adds a network round trip for the warning path. The move transaction
  reads canonical staff/calendar metadata and stores a receipt; production contention/latency
  needs observation before broad release. No synthetic load test represents production scale.
- The fingerprint intentionally rejects changed source data or crew, even if placement might
  still fit; the operator selects the destination again to review the new proposal.
- Estimated overtime never writes attendance, payroll or actual execution fields.
- Additive metadata is backward compatible for documents, but old capacity readers must not
  be restored over real accepted bounded transfers without retaining their protection.

## Verification and rollout

Synthetic Firestore transactions, API permission denial, real ERP browser cancellation,
acceptance, refresh and concurrent conflict pass. See the separate review for exact gates.
Production notification delivery and real user acceptance remain unverified in isolation.
No production write, push, merge, public preview deployment or production deployment occurred.

Before production use, revert this task commit to remove the feature. After use, prefer a
forward disable of new proposals/confirmation while preserving the bounded readers/guards,
identities and audit; review existing affected records read-only. Never compress, delete,
release or automatically relocate previously accepted work. Owner approval is required for
merge/deployment and any later production recovery action. Review again if scheduling,
duration, crew rules, open-ended after-hours or capacity authority changes.
