# Task: Activate additional canonical Vans without a numbered allowlist

## Context and scope
Owner request 2026-10-27: VAN-5 is configured but cannot become available; unavailable Vans should not occupy schedule lanes. Every additional configured Van must supply its dated slots when activated. Deep Review applies because eligibility and commit-time concurrency are affected.

Evidence: Booking Authority already discovers VAN-N from `vans`; ERP profile and WhatsApp clients retained the older four-Van guard. The board rendered unavailable lanes. Add Van considered legacy timestamp document IDs as fleet numbers. Profile-only saving also rewrote the partial-day schedule.

## Authority and rules
`vans`, `vanHalfDaySchedules`, dated overrides and staff remain canonical. Booking Authority owns offers, locks and commit revalidation. No new collection, migration, payroll rule, credential or access-rule change. OPS-TEAM-001 and OPS-VAN-FLEET-001 apply. A sole authorized driver uses the existing `Trabajo liviano` mode; the protected `Disponible` two-person rule is retained. Regular crew changes remain exclusively in the atomic roster editor.

## Acceptance
- VAN-5, VAN-6, VAN-12 and later registered lanes activate without another code change.
- Inactive, maintenance, out-of-service and no-personnel lanes offer no ordinary slots and are hidden; existing bookings remain accessible for correction.
- Dated capacity totals and half-day labels use each date, including when the currently selected date has an unavailable lane.
- Profile status changes preserve the weekly rule. Status saves invalidate cached capacity; entry/focus refresh reads fresh fleet state.
- Legacy source IDs do not become new fleet numbers.
- Repeated/concurrent booking cannot duplicate appointments or claim occupied capacity; disabling or removing a Van invalidates a previously prepared offer inside the transaction.
- No production fixture, message, customer, employee, appointment or payroll write.

## Verification and release
Focused profile and live-scheduling acceptance; dynamic Booking Authority booking/locks/replay/contention tests; existing Booking Authority regressions; Firebase syntax checks; ERP typecheck/build; real React browser tests with synthetic transport at 1440 and 390 pixels; separate Solo Maintainer Adversarial Review.

Backend change is limited to provider commit-time Van eligibility and the existing no-personnel status primitive. Release requires a bounded Office backend publication first, then ERP frontend on demac-aruba.com, preserving current source/configuration and a verified rollback. No generic migration deployment. Merge/deployment awaits owner authorization for this correction.
