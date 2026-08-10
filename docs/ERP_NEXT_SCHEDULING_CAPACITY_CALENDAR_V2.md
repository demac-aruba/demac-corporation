# DEMAC ERP Next — Scheduling Capacity & Calendar V2

Status: In Development / domain foundation.

## Purpose

Extend Scheduling V1 beyond short same-half-day appointments so the engine can represent DEMAC's same-property capacity and a real date/week operating calendar before persistence is introduced.

## Requirements

### SCHED-017 — Same-site 4–7 unit planner
For standard service at one property, 4–7 units may be scheduled as one extended same-site work plan when a van has sufficient day capacity. The planner uses service working minutes rather than pretending lunch is customer-service time.

### SCHED-018 — Lunch is not billed/reserved as service duration
When an extended same-site job crosses 12:00–13:00, lunch is skipped from service-duration accumulation. Example: four standard services starting at 08:30 use 3.5 working hours before noon plus 0.5 hour after lunch, ending at 13:30 under current defaults.

### SCHED-019 — Seven-unit same-site baseline
Under the current baseline, seven one-hour standard services at one property can occupy 08:30–12:00 and 13:00–16:30. This is possible because property-to-property transit is removed. The ceiling remains configurable.

### SCHED-020 — Date-specific job identity
The calendar layer associates each dispatch assignment with an operational `dateKey`. Availability checks must use only jobs from the target date rather than treating the schedule as one timeless collection.

### SCHED-021 — Aruba operational week
The week model uses `America/Aruba` as the business timezone. Current defaults are Monday–Friday 08:00–17:00, Saturday 09:00–13:00 and Sunday closed. Shift templates become Settings data before production.

### SCHED-022 — Week capacity is explainable
For each day, the system can summarize jobs scheduled, vans occupied and blocked-readiness jobs. This summary supports future capacity bars without changing scheduling truth.

### SCHED-023 — V2 candidate wrapper
The V2 candidate resolver checks an extended same-site plan first for 4–7 standard services, then delegates ordinary and two-van support cases to the canonical V1 candidate engine.

## Implemented in this checkpoint

- `CalendarDispatchJob` adds date identity without changing core dispatch-job semantics.
- Aruba current-date and operational-week helpers.
- Monday-based seven-day week generation.
- Saturday short-shift and Sunday-closed defaults.
- Date-specific job filtering and capacity summaries.
- Deterministic extended same-site planner for 4–7 standard services.
- Lunch-aware working-minute calculation.
- `findCandidateSlotsV2()` composition over the V1 engine.

## Next UI/integration work

1. Connect the Dispatch Board to `dateKey` and the V2 candidate resolver.
2. Add clickable week/day capacity navigation.
3. Store appointments/holds by date with concurrency protection.
4. Move weekday/Saturday shift templates into Settings.
5. Add staff absence, van outage and holiday exceptions.
6. Add acceptance tests for 4-, 7- and 10-unit same-site scenarios.

## Deferred

- exact Saturday service-slot templates if different work types require special rules
- public holiday calendar policy
- overtime scheduling and manager override rules
