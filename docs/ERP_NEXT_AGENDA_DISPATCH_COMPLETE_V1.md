# ERP Next — Agenda & Dispatch Operational Completion V1

## Objective

Close Agenda & Dispatch as a usable daily Operations workflow rather than a passive calendar.

The module must answer four questions continuously:

1. What is scheduled and which van/crew owns it?
2. Can that assignment safely/operationally leave?
3. Where is each assigned van in the pre-field movement chain?
4. What exception or delay will affect the rest of the day?

## Authority model

- CRM owns Customer / Property identity.
- Scheduling owns date, time, duration, sector routing and van assignment.
- Source workflows own the eight Job Readiness dimensions.
- Consolidated Job Readiness calculates READY / AT RISK / BLOCKED.
- Operations may explicitly release AT RISK when policy allows.
- Dispatch records physical pre-field movement.
- Field owns actual technician start and execution.
- Customer communication remains explicit; delay detection does not auto-message.

## Dispatch Operations V2 requirements

### Conflict detection

- DISP-V2-001 — Detect overlapping Work Orders using the same van.
- DISP-V2-002 — Support-van assignments participate in the same collision detection as primary assignments.
- DISP-V2-003 — Detect insufficient configured route buffer between different sectors.
- DISP-V2-004 — Detect incompatible half-day sector sequences using the DEMAC sector-compatibility map.
- DISP-V2-005 — Detect schedules extending beyond configured workday end.
- DISP-V2-006 — Detect Workforce Registry corruption where one active employee identity is assigned to multiple vans.
- DISP-V2-007 — Conflict detection is advisory/read-only and never silently moves a customer appointment.

### Real-time exception management

- DISP-V2-008 — Current-day timing uses the Aruba timezone.
- DISP-V2-009 — Work Orders past scheduled start without recorded departure/on-site/Field start produce a critical exception.
- DISP-V2-010 — Work Orders within 30 minutes of start and still BLOCKED produce a critical exception.
- DISP-V2-011 — Work Orders within 30 minutes and AT RISK without a valid release produce a warning.
- DISP-V2-012 — Dispatchable Work Orders within 30 minutes that are not marked Ready to Depart produce a preparation warning.
- DISP-V2-013 — Field work continuing past scheduled end produces an overrun exception.
- DISP-V2-014 — Operations Exception Queue combines schedule conflicts and live time pressure into one actionable queue.

### Delay propagation

- DISP-V2-015 — A current assignment delay is projected into later assignments on the same van.
- DISP-V2-016 — Scheduled gaps absorb propagated delay before later jobs are marked affected.
- DISP-V2-017 — Delay projection never modifies scheduled customer promises automatically.
- DISP-V2-018 — Customer delay communication remains an explicit Operations action.

### Pre-departure briefing

- DISP-V2-019 — Briefing shows Work Order, customer, property, sector, scheduled window and technician-only instructions.
- DISP-V2-020 — Briefing shows exact HVAC scope and selected equipment identity.
- DISP-V2-021 — Briefing shows active crew and skill-verification context.
- DISP-V2-022 — Briefing surfaces Materials, Required Tools, Site Access and Commercial Clearance evidence from their owning workflows.
- DISP-V2-023 — Primary and support assignments have separate physical movement controls but remain one Work Order/customer appointment.
- DISP-V2-024 — Support assignment never becomes a second customer communication owner.

### Physical dispatch state

- DISP-V2-025 — Supported pre-field stages are Not Ready → Ready to Depart → Departed → In Transit → On Site.
- DISP-V2-026 — READY or a valid AT RISK release is required to mark Ready to Depart.
- DISP-V2-027 — Readiness is revalidated before physical Departed is accepted.
- DISP-V2-028 — BLOCKED cannot be overridden from Dispatch.
- DISP-V2-029 — Once Field start exists, Dispatch stops controlling the execution stage.
- DISP-V2-030 — An already departed assignment is historical physical evidence; later readiness changes do not erase that departure event.

### Dispatch history / traceability

- DISP-V2-031 — Every actual pre-field stage transition creates an append-style DispatchEvent.
- DISP-V2-032 — DispatchEvent retains Work Order, van, from/to stage, timestamp and actor.
- DISP-V2-033 — Reset Ready to Depart → Not Ready before physical departure is also historical evidence.
- DISP-V2-034 — Dispatch movement events project into Audit Log.
- DISP-V2-035 — Customer-linked dispatch movement events project into Customer 360 timeline.
- DISP-V2-036 — Dispatch history is distinct from Field start authority and Field execution history.

### Daily close

- DISP-V2-037 — Daily Close shows scheduled, submitted, still-in-field and pending counts.
- DISP-V2-038 — A past scheduled day with unfinished Work Orders surfaces Carryover Required.
- DISP-V2-039 — Field submissions after configured workday end surface as overtime-close indicators.
- DISP-V2-040 — Daily Close does not automatically reschedule work or create payroll/overtime entries.

## Browser preview persistence

Current dispatch preview records use:

- latest assignment state: `demac.erp-next.operations.dispatch-assignments.v2`
- append-style movement history: `demac.erp-next.operations.dispatch-events.v1`

These are browser-local workflow records only until the Firebase transaction/audit layer is activated.

## Agenda & Dispatch V1 acceptance test

A complete four-van simulation should verify:

1. Create/confirm appointments in multiple sectors.
2. Produce primary and linked support Work Orders.
3. Resolve exact equipment scope and all eight readiness dimensions.
4. Confirm that overlap / buffer / sector conflicts are detected.
5. Put one upcoming Work Order in BLOCKED and one in AT RISK.
6. Verify real-time exception escalation as start time approaches.
7. Release the AT RISK job and confirm Ready to Depart becomes available.
8. Record Ready to Depart → Departed → In Transit → On Site.
9. Start Field and verify Dispatch can no longer impersonate Field execution.
10. Run one job past scheduled end and confirm delay propagation to the next van assignment.
11. Verify no automatic customer message is sent.
12. Submit Field work and verify Daily Close / Audit / Customer Timeline evidence.

## Definition of complete for V1

Agenda & Dispatch V1 is considered operationally complete when:

- the checkpoint builds in ERP Next CI;
- Legacy TypeScript/web validation remains green;
- Vercel previews are Ready;
- the four-van acceptance simulation produces no contradictory source-of-truth behavior.

Future enhancements such as GPS/real navigation ETAs, live traffic, automated customer delay notifications or carrier telematics are **not** required to close V1 and must be separate governed integrations.