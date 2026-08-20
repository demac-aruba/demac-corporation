# Scheduling multi-work allocation

## Canonical ownership

- `services` remains the only service catalog.
- `featured` controls whether an active canonical service appears in the Scheduling quick picker.
- Hidden services remain resolvable for historical appointments and explicit service references.
- Scheduling owns van capacity, time-slot allocation and support-van rules.
- Appointment work lines snapshot the selected service identity, quantity and trusted scheduled duration at confirmation time.

## Booking behavior

- One appointment may contain multiple work lines, for example two Standard Services plus one Standard Installation.
- BTU is not required to create the appointment; equipment details can be confirmed during field execution.
- Pure Standard Service appointments retain the existing full-day/support-van policy.
- Mixed-service appointments are combined into one workload on one primary van and must physically fit that van's schedule.
- `Other` accepts an appointment-specific manual duration. The override does not modify the canonical service duration.
- Work Orders preserve every confirmed work line in `appointmentWorkItems`.

## Legacy boundary

`businessSettings/appointment-work-presets` remains a transitional fallback only for unmigrated services. A canonical service hidden from Scheduling cannot reappear through that legacy fallback.
