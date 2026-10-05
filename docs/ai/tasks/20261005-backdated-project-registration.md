# Register previously unscheduled Project work in historical Scheduling slots

## Context and scope

Christian's 5 October 2026 screenshot shows Project disabled for today's elapsed
08:30 slot. He explicitly requests that he and office operators can record work
performed today or on previous dates to reconcile the schedule. The drawer and
Project link provider both rejected all historical Project entry, even though
Booking Authority already implements acknowledged historical registration.

Deep Review, Solo Maintainer Adversarial Review: enable the requested historical
registration for existing Project schedulers. Do not expand planning permissions
or the manager-only adjustment/replacement of an already recorded Project booking.
Only published Projects enter this flow, so Project/Appointment/Work Order/locks
remain one atomic transaction. Services keep the existing backdated path.

## Governance and acceptance

- Booking Authority and projectRecords remain authoritative. OPS-PROJ-SCHED-001
  and OPS-SCHED-PROJECT-BACKDATE-001 apply. No new store, migration or Legacy change.
- Owner and active provisioned operators can select an existing schedulable Project,
  phase and whole slots on any eligible Van, including an earlier time today.
- Require explicit historical acknowledgement at availability and confirmation;
  historical Temporary Holds are rejected. Cancel acknowledgement writes nothing.
- Revalidate permissions, Project version, Customer/Property/phase, dated capacity,
  calendar/crew and conflicts. Preserve existing Project lifecycle restrictions.
- Persist backdating actor/time and work-already-performed evidence, suppress automatic
  customer messages, and never invent Field completion, attendance, payroll or invoices.
- Atomic commit/retry must create exactly one appointment/link and preserve capacity;
  stale/revoked/conflicting requests must leave no partial booking records.

## Verification and recovery

Focused backend suites, real Firestore emulator denial/retry/race cases, actual
React drawer through real HTTP booking transport and synthetic Firestore, ERP
scheduling/project acceptance, typecheck/build and Firebase syntax validation.
Review the complete diff and affected callers separately from implementation.
Deploy officeBookingAuthority before ERP Next only after owner approval. Revert
the entry guards to roll back; retain any already registered work and audit.
