# ERP Next — Scheduling Primary View V2

## Objective

Make Scheduling & Dispatch fast to read during normal office use. The primary route should open the scheduling/capacity agenda, while deeper operational control and readiness remain available on demand instead of stacking three full workspaces vertically.

## Requirements

- SCHED-UI-001 — `/scheduling` opens **Schedule & Capacity** by default.
- SCHED-UI-002 — **Daily Dispatch Control** remains available through a compact workspace view selector.
- SCHED-UI-003 — **Dispatch Readiness Board** remains available through the same selector.
- SCHED-UI-004 — Only one of the three major Scheduling workspaces is rendered visibly at a time.
- SCHED-UI-005 — Operational week cards remain visible in the primary Schedule & Capacity view.
- SCHED-UI-006 — Week cards show filled/open standard work spots, not only assignment counts.
- SCHED-UI-007 — Primary agenda shows Van 1, Van 2, Van 3 and Van 4 as four parallel columns on desktop.
- SCHED-UI-008 — Smaller screens preserve all four vans using horizontal scrolling rather than silently hiding a van.
- SCHED-UI-009 — Every standard work spot is rendered whether occupied or empty.
- SCHED-UI-010 — Weekday standard spots are driven by Scheduling runtime `serviceStartTimes` (currently 08:30, 09:30, 10:30, 13:30, 14:30, 15:30).
- SCHED-UI-011 — Saturday renders the short-shift spots 09:00, 10:00, 11:00 and 12:00.
- SCHED-UI-012 — Empty spots are explicitly labeled **Available / Open work spot** and can open the New Appointment workflow.
- SCHED-UI-013 — Jobs longer than one standard work spot visibly occupy/continue through every overlapped spot.
- SCHED-UI-014 — Temporary holds remain confirmable from the agenda.
- SCHED-UI-015 — New Appointment continues using the deterministic booking engine; visual empty slots do not bypass sector, duration, route, restriction or support-van rules.
- SCHED-UI-016 — Existing CRM customer/property selection remains available in New Appointment.
- SCHED-UI-017 — Booking Intelligence remains on the primary page but is compressed into a horizontal information strip so it does not take a full sidebar away from the four-van agenda.
- SCHED-UI-018 — Main summary metrics include Confirmed, Temporary Holds, Need Attention and **Open Spots**.
- SCHED-UI-019 — Demo Data Mode remains supported so the full-day test schedule can be visually evaluated after deployment.

## Information hierarchy

Primary route:

**Schedule & Capacity**
→ week utilization
→ day metrics
→ selected-day navigation
→ compact Booking Intelligence
→ four-column van schedule with occupied and open spots

Secondary on-demand views:

- Daily Dispatch Control
- Dispatch Readiness Board

## Important business rule

An empty visual work spot is not an unrestricted booking promise. Clicking it opens the deterministic appointment workflow. The booking engine remains authoritative and may reject that exact van/time when geography, duration, customer restrictions, route margin, support capacity or other scheduling constraints make it invalid.
