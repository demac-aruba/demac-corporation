# Dynamic Vans + Employee Calendar UX — 2026-08-28

## Objective
Remove the current fixed-four-Van assumption from Scheduling and simplify Employee Calendar navigation so the canonical fleet and the visible payroll calendar remain the single authorities.

## Scope
- Scheduling/capacity must derive Vans dynamically from the canonical `vans` collection instead of accepting only `VAN-1` through `VAN-4`.
- Newly created Vans must be recognized without a code change for each future fleet addition.
- Inactive, maintenance, or `Fuera de servicio` Vans must remain operationally unavailable and must not become bookable merely because they are visible to Scheduling.
- Employee Calendar `Quick Actions` must close when clicking outside, pressing Escape, or selecting an action.
- Remove the duplicate top-right Payroll Period navigator. The calendar month is the sole visible period navigator.
- The displayed month continues to map to the existing payroll-period rule: the payroll period ending on the 26th belongs to that displayed month (for example August 2026 = Jul 27–Aug 26).
- Payroll totals, attendance summaries, PDF/CSV exports, salary advances, selected records, and period navigation continue using the same existing period state.

## Canonical authority
- Fleet identity/status/crew: canonical `vans` records and existing operational assignment/schedule collections.
- Operational availability: existing scheduling capacity rules; this task removes only the numeric fleet cap and must preserve status/active guards.
- Employee payroll period: existing `periodAnchor` -> `payrollPeriodBounds(...)` flow in Employee Workspace. No second month or payroll state may be introduced.

## Non-goals
- Do not mutate production Van data, including the test Van 5 status, crew, or schedule.
- Do not activate an out-of-service Van.
- Do not create another fleet or payroll source of truth.
- Do not redesign Booking Authority beyond changes strictly required to remove a fixed-four-Van assumption.
- Do not migrate or rewrite historical appointments/payroll records.
- Do not merge to `main` or intentionally deploy production during the Product Review phase.

## Acceptance criteria
1. A canonical `VAN-5` (and future valid numbered Vans) is recognized by live operational capacity without modifying a `1-4` whitelist.
2. A recognized Van whose status is `Fuera de servicio` remains unavailable for operational scheduling/booking.
3. Existing Van 1–4 availability, crew, half-day, and closure behavior remains unchanged.
4. No additional fixed-four-Van assumption remains in the applicable Scheduling display/capacity path.
5. Quick Actions closes on outside pointer interaction, Escape, and after any selected menu action.
6. Quick Actions remains keyboard/button accessible and reports expanded state.
7. Employee Calendar has only one visible payroll-period navigation control: the calendar month toolbar.
8. The calendar month clearly shows its derived payroll range (for example `August 2026` / `Payroll period · Jul 27 – Aug 26`).
9. Previous/next calendar navigation updates the existing payroll period, totals, records, and exports through the same period state.
10. Clicking an in-period date selects the date without changing the payroll month.
11. No production data is changed by implementation or validation.

## Product-review gate
Before deeper hardening, provide the owner a functional implementation with focused validation and report **🟡 READY FOR PRODUCT REVIEW**. Merge requires a separate explicit owner authorization after engineering review and required CI/deployment-preview gates.
