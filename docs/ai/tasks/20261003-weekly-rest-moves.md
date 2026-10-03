# Move an appointment into a Van's weekly rest window

## Context and scope

Christian requested on 3 October 2026 that an existing morning appointment can be
moved into Van 1's free afternoon, with explicit acknowledgment that its crew will
work overtime. Apply the rule to any eligible Van/date, including the same Van.
Screenshot: a four-slot morning job and a weekly rest window after 13:00.

Deep Review: the existing server-authoritative consent and atomic capacity swap
must apply to a newly eligible destination. Solo Maintainer Adversarial Review.
No new data authority, permission, payroll calculation, migration, or schedule edit.
Ordinary overflow transfers retain their existing rules. Multi-Van coordination,
historical moves and executed work are outside this exception.

## Governance and acceptance

- Booking Authority owns validation and writes; OPS-SCHED-MOVE-REST-001 extends
  OPS-SCHED-MOVE-OT-001 using the weekly-rest controls of OPS-SCHED-PLANNED-OT-002.
- Any active eligible Van can expose an empty weekly-rest slot as an amber move
  target, including moving within the same Van. Ordinary availability is unchanged.
- Confirm the free-time/overtime reason, complete slots and estimated finish;
  cancel/preparation writes nothing. Four slots at 13:30 finish at 17:30.
- Retain Appointment/Work Order IDs, duration, quantity, links and full capacity;
  swap locks and record operator/time/from/to and weekly-rest acceptance atomically.
- Revalidate calendar, dated crew, absences, occupied work/holds, source ownership,
  protected lunch, same-date finish, stale consent and exact replay.
- No actual attendance/payroll writes or customer messages are introduced.

## Verification and recovery plan

Run focused move tests, real Firestore transaction/race and permission tests,
live scheduling acceptance, ERP types/build and Firebase syntax validation.
Exercise actual React controls against synthetic local data, inspecting cancel,
accept and reload. Separately review the complete diff and direct callers.
Owner approval precedes merge/deployment. Rollout requires officeBookingAuthority
before the frontend; rollback disables the new UI and reverts backend eligibility
without deleting appointments or historical audit evidence.
