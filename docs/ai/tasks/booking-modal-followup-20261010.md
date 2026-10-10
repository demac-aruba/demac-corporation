# Task: Booking workspace follow-up

## Context
- Owner approved implementation, deep audit, merge and deployment on 2026-10-10 after grouping two observations.
- Baseline main: 1f1bf7783a9bf6706b8008ce0a3fa63a5c065741; live demac-aruba.com deployment dpl_9wTBhdDonzMGse5qkPq1soHosEp6 (d204fdbc50fc8c512ed259fc113a49bdba981cd1, identical tree).
- Support previously unmounted the booking draft and provided no return selector. Capacity occupied the right column; work/catalog and visit details shared the middle.

## Scope
- Permit Regular / Project / Support navigation in one modal session before committing; retain drafts when visiting support and returning to the same source.
- Keep customer/property/recipients left; catalog, quantities/manual duration and Project slot planning center; workload summary, descriptions, instructions, media/GPS right.
- Compact capacity status immediately left of Cancel, retaining all authoritative explanations, recheck, support allocation choices, overtime consent and hold guidance in accessible details.
- No backend, rules, schema, migrations, pricing/payment work, live test bookings or customer messages.

## Governance
- Booking Authority remains sole owner of capacity, Appointment/Work Order writes, support locks, transaction revalidation and idempotency.
- CRM Customer/Property/Contact identity, Project scheduling vs planning capabilities, private visit-reference uploads and transactional communication authority unchanged.
- Applicable rules: OPS-SVC-*, OPS-TEAM-*, OPS-SCHED-SUPPORT-001, OPS-SCHED-REFERENCES-001, OPS-PROJ-SCHED-001, OPS-SCHED-PROJECT-BACKDATE-001, OPS-SCHED-PLANNED-OT-001/002/PROJECT, OPS-SCHED-CREATE-OT-001.
- Legacy remains active fallback; no changes. No new authority or durable architecture boundary; existing ADR-20261010-booking-modal-presentation continues to apply, with follow-up rationale documented there.

## Acceptance criteria
- Regular→Support→Regular and Project→Support→Project retain identity/work/notes/references; support retains selected appointment/duration/reason/note. Regular↔Project preserves existing explicit source-reset semantics.
- Project source respects live capability; support remains restricted to eligible calendar slots, with existing historical acknowledgment and consecutive slot limits.
- Only one visible dialog owns keyboard focus, scroll lock and Escape; no switch during uploads, master writes, booking/support commit or unknown-outcome recovery.
- Green status only for the current approved allocation; pending/incomplete is neutral, conflict red, explicit overtime warning retained.
- Support selection, alternatives, allocation windows, hold, recovery, historical, after-hours and rest-day Project workflows remain available.
- Desktop three-column and mobile stacked layout fit viewport; Cancel/confirm remain visible.

## Plan and risk
- Keep original forms mounted when inactive with hidden/inert presentation and inactive dialog hook. Parent closes both drafts only on cancellation or completed mutation.
- Move existing JSX; preserve state, validation, payload and commit predicates. Details auto-open when an allocation decision is required.
- Protect support unknown outcomes with exact original request recovery before new edits/navigation.
- No data migration. Rollback is the prior Vercel frontend deployment; no reverse data operation.

## Verification
- Independent reviewer: /root/booking_followup_review; owner explicitly requested Deep Review and AGENTS prefers an independent reviewer.
- Required: ERP typecheck, production build including existing prebuild gates, applicable booking/lifecycle/dispatch/live-scheduling/project suites, existing references browser, extended real-component synthetic browser cases, CI on final SHA, preview and production alias/source verification.
- Tests use isolated synthetic/emulator data. Authenticated live writes are excluded to protect operational data.
- Results recorded in the independent review and PR before release.
