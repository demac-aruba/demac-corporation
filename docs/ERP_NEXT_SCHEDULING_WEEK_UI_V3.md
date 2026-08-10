# DEMAC ERP Next — Scheduling Week UI V3

Status: In Development / interactive preview workspace.

## Purpose

Connect the date-aware capacity model to the actual Scheduling & Dispatch user experience so office operators can change operational days and receive availability from the selected date rather than from a timeless demo schedule.

## Requirements

### SCHED-024 — Clickable operational week
Scheduling displays the current Aruba operational week with each day's shift, assignment count, vans occupied and capacity indicator. Selecting a day changes the dispatch context.

### SCHED-025 — Date selection changes availability truth
The booking engine receives only jobs belonging to the selected `dateKey`. Appointments on Tuesday must not consume Monday capacity.

### SCHED-026 — Temporary holds retain date identity
A newly selected ERP option creates an in-memory temporary hold linked to the currently selected operational date. Production persistence will later protect this transition with a transactional concurrency guard.

### SCHED-027 — Closed days do not offer capacity
Sunday is represented as operationally closed under the current baseline. The New Appointment action is disabled and the day-aware resolver returns no candidate slots.

### SCHED-028 — Saturday uses short-shift solver
Saturday uses a 09:00–13:00 short-shift candidate solver instead of weekday 08:30/13:30 logic. Customer restrictions still filter invalid Saturday starts.

### SCHED-029 — Extended same-site planner is active in the booking UI
For an open weekday with adequate van capacity, 4–7 standard services at one property can now surface as an extended same-site option from 08:30 through the lunch-aware calculated end time.

### SCHED-030 — Two-van support planner is active in the booking UI
For a large same-site standard-service request such as ten units, an open day with two free vans can return a linked primary + support plan. The temporary hold creates two van assignments while retaining one customer communication owner.

### SCHED-031 — V1 visual source is retired
The superseded `dispatch-board.tsx` implementation is removed once the date-aware `dispatch-workspace.tsx` becomes canonical. ERP Next should not accumulate a patch/duplicate-component chain like Legacy.

## Implemented in this checkpoint

- Canonical `DispatchWorkspace` replaces V1 board component.
- Current Aruba week rendered as clickable premium capacity cards.
- Active date filters all visible van work and geographic anchors.
- New holds are written to the selected date in preview state.
- Booking drawer uses `findCandidateSlotsForDay()`.
- Weekday resolver uses V2 same-site/support rules.
- Saturday gets a dedicated short-shift solver.
- Sunday is closed and cannot create a booking.
- Superseded Scheduling V1 component removed.

## Next Scheduling work

1. Settings-backed shift/work-preset editor.
2. Crew/technician availability and absences.
3. Van outage/maintenance exceptions.
4. GAC/geocode + operating-sector adapter.
5. Inventory/tool readiness adapter.
6. Persisted temporary holds and booking concurrency protection.
7. Calendar drag/reschedule rules with audit history.
8. Legacy appointment migration mapping and acceptance tests.
