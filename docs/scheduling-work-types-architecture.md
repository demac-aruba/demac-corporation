# Scheduling Work Types

Scheduling Work Types are the small operational categories used by **New Appointment → Work & Allocation** to reserve technician/van time when exact equipment details (for example BTU) may not yet be known.

They are intentionally separate from the detailed commercial **Services & Products** catalog.

## Source of truth

`businessSettings/appointment-work-presets` with `workTypesVersion: 2`.

The approved defaults are:

1. Standard Service — 60 min / unit
2. Premium Deep Cleaning Service — 120 min / unit
3. Standard Installation — 120 min / unit
4. Installation Extended Labor — 180 min / unit
5. Check Up — 60 min / unit
6. Leak Repair — 180 min / unit
7. Commercial Service — 180 min / unit
8. Other — manual appointment duration

Administrators can edit label, duration, category, active state and picker order in ERP Next → System Settings → Appointment Work Types. Custom future Work Types can also be added there.

## Boundaries

- Detailed BTU-specific services remain in `services` for price, estimates and reporting.
- Active commercial services do **not** automatically appear in Scheduling.
- Appointment Work Types do not carry selling price or stock.
- `Other` stores its manual duration on the appointment/work line; it never rewrites the master Work Type.
- Legacy appointment preset documents without `workTypesVersion: 2` are not exposed as the new picker. The new system starts from the approved eight defaults while historical legacy IDs remain resolvable by compatibility code.
- Booking Authority remains the only canonical write path for Appointment + Work Order + Capacity Locks.
