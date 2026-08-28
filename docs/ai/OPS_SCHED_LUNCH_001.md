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
- A full-day reservation may own all sellable start anchors as capacity policy without falsifying the job's wall-clock start/end.
- Van half-day windows and company closure remain hard operating-window limits.

## Authorities

- Booking Authority validates continuous start/end intervals and commit-time concurrency.
- Capacity locks use only sellable start anchors actually overlapped by the continuous interval; lunch itself never receives a sellable lock.
- Work Order `appointmentDurationMinutes` plus `time` is the canonical wall-clock schedule span for modern records; `appointmentEndTime` is the stored projection of that span.
- `scheduledSlots` remains capacity/history metadata and a compatibility fallback, not a second timing authority.
- Live Scheduling, technician WhatsApp, PENDIENTE calculation, reschedule/move, and support validation must project the same continuous span.

## Acceptance examples

1. `10:30 + 180 min = 13:30`; `13:30` remains available.
2. `10:30 + 240 min = 14:30`; `13:30` is unavailable.
3. No customer booking start is created at `12:00`, `12:30`, or `13:00` merely because a job can cross lunch.
4. A configured Van half-day cannot be crossed by a job whose real end exceeds the half-day work window.
5. Confirmation/revalidation and transactional capacity locks must agree with live availability.
