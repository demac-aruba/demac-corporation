# Scheduling legacy simulator quarantine

Status: acceptance-only, non-production.

The following modules are retained only to preserve historical browser simulations and their acceptance fixtures:

- `components/scheduling/booking-copilot.tsx`
- `components/scheduling/booking-drawer.tsx`
- `components/scheduling/dispatch-workspace.tsx`
- `components/scheduling/scheduling-overview-v2.tsx`
- `lib/booking-intelligence/copilot.ts`
- `lib/scheduling-appointment-lifecycle.ts`
- `lib/legacy-scheduling-simulator-fixtures.ts`

They are not a booking or capacity authority. Production `/scheduling` routes mount `SchedulingPageShell` → `LiveSchedulingOverview`; availability and writes go through `lib/office-booking-authority.ts` to Office Booking Authority.

The legacy heuristic functions now require an explicit Van registry. Their four-Van dataset lives only in `legacy-scheduling-simulator-fixtures.ts`; no core helper silently defaults to it.

`scripts/scheduling-production-boundary-acceptance.cjs` traverses every App Router page/layout/route dependency and fails CI if any production entry reaches a quarantined module. It also fails when static `previewVans` or a default Van registry returns to core scheduling helpers.
