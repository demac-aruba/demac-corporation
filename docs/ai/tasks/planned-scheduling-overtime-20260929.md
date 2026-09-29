# Task: future emergencies and confirmed weekly-rest overtime

## Context and scope
- Owner request: 2026-09-29; ERP Next Scheduling & Dispatch. Future after-hours emergency bookings must be possible. Van 2 on September 29 needs four standard services during its weekly afternoon rest.
- Deep Review, Solo Maintainer Adversarial Review; isolated `fix/scheduling-planned-overtime` based on main `bd23d514`.
- Reuse the office facade, specialized booking transaction, canonical Customer/Property/work types, Appointment/Work Order, BAL locks and BAH serialization guard. No new source of truth, migration, actual attendance or payroll write.

## Authorities and rules
- Booking Authority commits appointments, crew and capacity; the office authentication boundary remains mandatory.
- OPS-SCHED-PLANNED-OT-001: today/future after-hours bookings retain >=17:00 start, canonical calendar, crew and open-ended emergency behavior.
- OPS-SCHED-PLANNED-OT-002: explicit office confirmation permits a fixed-duration booking wholly in weekly rest, including extension past ordinary closing time. Preserve full workload, exact duration and reservation locks; reject unavailable crew, closures, lunch, overlap, midnight, stale consent and altered retries.
- Ordinary/automatic/Maya availability and weekly schedules remain unchanged. Scheduled overtime is planning/audit evidence; payable overtime remains actual attendance authority.

## Acceptance and verification plan
- Future-date emergency enabled in UI and server, past date rejected.
- Weekly rest slots open the existing booking drawer with an overtime warning. Server preparation is read-only; cancel writes nothing. Confirmation binds operator, request, crew, schedule, workload and estimated finish.
- Four standard services at 13:30 reserve four slots through 17:30; three services reserve through 16:30. Refresh retains overtime labels and full occupancy.
- Exact retry creates one appointment; changed payload and stale consent fail. Concurrent overtime/emergency/normal reservations cannot overlap. Cancellation frees owned locks; ordinary rescheduling removes obsolete planning markers.
- Run Functions syntax, focused/transitive unit tests, Firestore emulator concurrency, ERP Next typecheck/build and synthetic browser flow.
- Reversible feature branch; owner explicitly approved publication, merge and deployment on 2026-09-29 ("puedes hacer merge y deploy"). After real use, forward-disable entry points while retaining readers and conflict protection; never revert away reservation ownership.
