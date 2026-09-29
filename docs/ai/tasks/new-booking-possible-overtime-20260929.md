# Task: possible overtime when creating a regular afternoon appointment

- Owner request 2026-09-29: Van 4, four Standard Services with only three afternoon slots.
- Prior rule OPS-SCHED-MOVE-OT-001 covers transfers of existing appointments; OPS-SCHED-PLANNED-OT-002 covers weekly rest. Neither permits a new regular afternoon booking to exceed ordinary slots.
- Deep Review / Solo Maintainer Review: touched atomic reservation, consent and retry behavior. Base main 246814113274bc50f4eda2d8795568ae82ae6b3b; branch fix/new-booking-possible-overtime.
- Extend the existing explicit bounded booking authority, authenticated office facade and create drawer. Read-only preparation reports full work, remaining ordinary slots and finish. Explicit final confirmation revalidates and writes Appointment, Work Order, owned BAL locks and shared BAH guard atomically.
- Scope: normal afternoon starts with a nonempty ordinary tail; preserve every requested service/duration. Protected lunch, midnight, company closures, weekly rest, unavailable crew, conflicts and stale consent remain blockers. Route policy remains advisory for explicit office targets, as in the existing ordinary path.
- Never extend Maya/automatic availability, rewrite existing bookings, create customer messages as a test, or write payroll/actual attendance. Current overtime metadata clears through existing ordinary lifecycle/move and retains audit.
- Acceptance: four at 13:30 => 4 slots, 3 ordinary, 17:30 finish; three at 14:30 => 3 slots, 2 ordinary; three at 13:30 stays ordinary. Cancel writes no appointment/locks. Concurrent normal, overflow and emergency reservations cannot double-book; exact retry creates one appointment. Scope/crew changes invalidate consent. Refresh labels this possible overtime, not weekly rest.
- Use synthetic unit, real emulator and full React/client/facade browser tests, transitive scheduling regressions, typecheck/build. Record separate adversarial review and exact release evidence.
- Earlier owner approval in this same scheduling task authorized merge/deploy. This follow-up corrects the reported incomplete creation behavior through the same reviewed PR and deployment gates.
