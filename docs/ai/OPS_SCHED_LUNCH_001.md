# OPS-SCHED-LUNCH-001 — Flexible lunch overlap

Owner: DEMAC Operations / Scheduling
Effective date: 2026-08-28
Status: Protected scheduling invariant

## Rule

Lunch is not an independently sellable customer slot, but it is also not a hard conflict for an already-running job.

- Canonical normal customer start times remain `08:30`, `09:30`, `10:30`, `13:30`, `14:30`, `15:30`.
- A job may run continuously through 12:00–13:00 when its real duration requires it.
- Example: a three-hour job beginning at `10:30` ends at `13:30`; it does not gain an artificial lunch hour and therefore does not block the `13:30` start.
- A job beginning at `10:30` and ending at `14:30` does overlap the `13:30` start and must block it.
- Lunch placement for technicians remains operationally flexible: during a long job when practical or after the job.
- Booking Authority keeps the service-work estimate and the reserved Van-capacity boundary as separate values when lunch or full-day policy makes them differ.
- Scheduling must use the reserved-capacity boundary for the visible block and label; it must not draw through a later slot while presenting the earlier service estimate as though it were the Van's release time.
- Van half-day windows and company closure remain hard operating-window limits.

## Authorities

- Booking Authority validates continuous start/end intervals and commit-time concurrency.
- Capacity locks use canonical owned sellable starts; lunch itself never receives a sellable lock. `capacityEndTime` is the end of the final owned start window.
- Work Order `appointmentDurationMinutes` plus `time` remains the service-work estimate for modern records; `appointmentEndTime` stores that estimate and `appointmentCapacityEndTime` stores the Van release boundary.
- A `fullDaySingleProperty` technician assignment displays the complete reserved Van window, while retaining service duration as the work-effort estimate.
- `scheduledSlots` remains capacity/history metadata and a compatibility fallback, not a second timing authority.
- Live Scheduling, technician WhatsApp, PENDIENTE calculation, reschedule/move, and support validation must project the same continuous span.

## Acceptance examples

1. `10:30 + 180 min = 13:30`; `13:30` remains available.
2. `10:30 + 240 min = 14:30`; `13:30` is unavailable.
3. No customer booking start is created at `12:00`, `12:30`, or `13:00` merely because a job can cross lunch.
4. A configured Van half-day cannot be crossed by a job whose real end exceeds the half-day work window.
5. Confirmation/revalidation and transactional capacity locks must agree with live availability.
6. When a capacity block outlasts the work estimate, Scheduling shows the capacity end prominently and identifies the earlier time only as a service-work estimate.
