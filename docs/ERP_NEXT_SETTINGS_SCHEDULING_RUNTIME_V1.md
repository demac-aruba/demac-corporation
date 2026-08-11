# ERP Next — Settings → Scheduling Runtime V1

## Objective

Make governed business configuration operational. Saving a duration/buffer setting must change the future scheduling options produced by the deterministic solver rather than remaining decorative UI.

## Requirements

- CFG-SCHED-001 — Standard Service duration is configurable in 15-minute increments, 30–480 minutes per A/C unit.
- CFG-SCHED-002 — Deep Cleaning duration is configurable in 15-minute increments, 45–480 minutes per A/C unit.
- CFG-SCHED-003 — Operational route/recovery buffer is configurable in 5-minute increments, 0–120 minutes.
- CFG-SCHED-004 — Saved Standard Service duration feeds ordinary slots, extended same-site plans and linked support-van plans.
- CFG-SCHED-005 — Saved Deep Cleaning duration feeds ordinary weekday and Saturday slot calculations.
- CFG-SCHED-006 — Saved buffer protects the pre-lunch and end-of-day margin used by the deterministic slot solver.
- CFG-SCHED-007 — Saturday capacity uses the configured work duration and closing buffer.
- CFG-SCHED-008 — Support-van planning remains one parent appointment with one customer communication owner; configuration cannot bypass that rule.
- CFG-SCHED-009 — Runtime settings cannot make a job valid if it no longer fits before the protected working-day boundary.
- CFG-SCHED-010 — Existing appointments retain the start/end values recorded when they were created; changing configuration does not silently rewrite historical/confirmed appointments.
- CFG-SCHED-011 — Overtime threshold remains a timekeeping/exception rule and does **not** automatically extend appointment capacity.
- CFG-SCHED-012 — Browser settings are normalized before use; invalid/unsafe local values fall back to governed bounds.
- CFG-SCHED-013 — Production configuration must eventually use authenticated permissions, version history and append-only audit evidence.

## Runtime architecture

System Settings browser store
→ validation / normalization
→ Scheduling runtime overrides
→ pure deterministic capacity functions
→ candidate slots
→ Appointment snapshot

The solver still receives a `SchedulingSettings` object. The browser bridge is responsible for translating preview configuration into runtime overrides; business screens do not read arbitrary localStorage values inside the scheduling algorithm.

## Current values wired

- `serviceMinutes` → `standard_service` duration
- `deepMinutes` → `deep_cleaning` duration
- `bufferMinutes` → `routeMarginMinutes`

`afterHours` remains stored but is deliberately not mapped to `workdayEnd`, because the overtime threshold and scheduling availability boundary are different business concepts.

## Production migration

When Firebase configuration persistence is activated, the browser adapter is replaced by a repository-backed configuration reader. The deterministic solver and its `SchedulingSettings` contract remain unchanged.