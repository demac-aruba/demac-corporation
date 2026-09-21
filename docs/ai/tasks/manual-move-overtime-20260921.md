# Task: controlled possible overtime on a same-date manual Van transfer

## Context and scope
- Owner request: 2026-09-21. ERP Next existing manual move, including the 14:30 / three required / two ordinary spots example.
- Deep Review; Solo Maintainer Adversarial Review will be recorded separately.
- Base: main cb01c469; isolated feature/manual-move-overtime, synthetic data only.
- Booking Authority remains the sole writer. No new booking engine, ordinary capacity, payroll truth, migration, production write, merge or production deployment.

## Evidence and authorities
- live-scheduling-move.ts currently excludes insufficient ordinary ownership before confirmation.
- bookingOperationalMove.js is the existing atomic Appointment/Work Order/lock swap. Normal moves have deliberate legacy leniencies; the exception must not inherit those leniencies.
- bookingAfterHours.js owns open-ended emergency work and its BAH guard. Reuse that guard for serialization; do not turn fixed-duration work into an open-ended emergency.
- bookingSchedulingPrimitives / bookingCapacityAvailability own crew, duration and capacity; officeBookingAuthority authenticates existing office roles.
- OPS-SCHED-MOVE-OT-001: only a cross-Van transfer on the appointment date can exceed its remaining ordinary tail, with explicit server-validated consent; all other restrictions survive.
- Appointment, Work Order, quantity, duration, support links, notification ownership and actual attendance remain canonical and unchanged in identity.

## Acceptance / failure behavior
- Canonical read-only preparation supplies Van, start, required/ordinary spots and estimated finish. Cancel/close performs no write.
- Confirmation revalidates the full interval, calendar, Van, crew, staff conflicts, reservations and source revision in the canonical transaction.
- Audit records actor, timestamp, source/destination and consent. Retries replay; changed payloads and stale consent fail closed.
- Rejected or failed transactions preserve all source documents/locks; no duplicate notifications.
- Verify normal moves, bookings, lunch, support, after-hours, denial, cancellation, race, double submission and refresh projections.

## Plan / rollback
- Add a narrowly scoped preparation/consent contract to the existing move authority and modal, plus persistent bounded overtime metadata for projections.
- No schema migration. Before any production use, reverting the task commit restores the previous code. After real accepted transfers exist, disable the new entry/consent path with a forward patch while retaining capacity readers, guards and audit; never blindly revert protection for already accepted bookings or move them retroactively.
- Test with demo Firestore emulator and synthetic browser preview. Report unverified boundaries honestly.
