# Task: Property dwellings in CRM, Booking and Field

## Context and scope

Owner request dated 2026-09-21; delivery mode **Deep Review**. Work starts from
`d1a495611f178210474f6fd40b84e514f614ba75` on
`feature/property-dwellings-preview`. Existing work is preserved in its checkout.
Only ERP Next and the relevant Firebase authorities are in scope. No production
data, migration, merge, automatic merge, production deployment or settings changes.

## Inspected active paths

- `Customer360` -> `CustomerMasterDataTab` -> `office-booking-authority.ts` ->
  authenticated `officeBookingAuthority` master-data operations.
- `LiveAppointmentCreateDrawer` -> `live-scheduling-booking-data.ts` uses those
  same operations and primes Scheduling's reference cache.
- Booking confirmation uses `bookingAuthorityFirestore` and the canonical
  Scheduling provider: offer revalidation, transaction validation, capacity locks,
  Appointment and Work Order commit. These remain authoritative.
- Field registration and Visit Assets use current assigned Work Visit transactions;
  `equipmentSystems` remains the single physical equipment identity.
- `customerContactDirectory` and `contactPropertyAssignments` own reusable people
  and communication responsibility. Recipient snapshots are historical evidence.
- Browser CRM/Projects models are not canonical alternatives for this feature.

## Contracts planned before implementation

- `properties/{propertyId}` keeps its identity/customer/address. Additive summary
  fields identify independent dwellings; type `Apartamento` alone implies nothing.
- Child records `properties/{propertyId}/dwellings/{dwellingId}` and
  `properties/{propertyId}/areas/{areaId}` are owned by that same Property.
  Stable opaque IDs survive renaming. Areas optionally reference a dwelling.
  No unbounded tree or separate Site/property catalog is introduced.
- `contactPropertyAssignments` gains an optional `dwellingId` dimension. Contact
  identities are reused. General property responsibility remains distinct.
- Appointment offers, Appointments, Work Orders and Field projections gain an
  optional dwelling reference and immutable display/access/visit-contact snapshot.
  Requester/access choices do not change residential or financial responsibility.
- Equipment stays in `equipmentSystems`; optional `dwellingId` and `areaId` link
  location. Equal brand/capacity equipment can have different equipment identities.
- Authorized server operations validate the complete relationship chain, enforce
  property-local code uniqueness and optimistic versions, and record exact-request
  retry/audit evidence in the existing idempotency authority.

## Preserved behavior and compatibility

Simple properties and old Appointments retain their existing path; absent dwelling
references never resolve implicitly to the first dwelling. Old equipment remains
visible as unclassified. No historical assignment or recipient rewrite is planned.
Quantities of service do not depend on inventory completeness. Booking remains a
modal and preserves its work, date, Van and time when creating master data.
Capacity, duration, multihour blocks, support, movement, cancellation, partial
completion, pricing, taxes, payments and inventory authorities are unchanged.

## Governance and risk

Authorities: Customer/Property/Contact, Booking Authority, Field Operations.
Rules: existing OPS-SVC/OPS-TEAM/OPS-ROUTE/OPS-SCHED/FIELD-DAY and additive
CRM-LOCATION-001 (explicit stable property-contained dwelling/area identity).
Read and write authorization must be server-side. New child collections are read
through the existing office authority; no permissive production rules are needed.
Main risks: cross-dwelling leakage, stale selection, duplicate batches, loss of
context in downstream projections, sending to unrelated tenants, and accidental
preview access to production. All require negative acceptance evidence.

## Acceptance and verification

Track requested scenarios A-N: existing house + five dwellings; configurable
complexes and multiple properties; forty apartments; property-local code reuse;
multiple identical units per area; address search; distinct owner/requester/access;
inline creation visible in CRM; incomplete inventory; historical appointments;
retry/concurrency/network failure; permission/cross-property denial; canonical
scheduling regressions; persistence/reload/second authorized session.

Required gates: ERP typecheck/build and affected tests; Functions validate:firebase,
focused/transitive Booking/Field/Contact tests, emulator integration and allow/deny;
desktop and mobile browser checks with device/emulation limitations reported.
Separate Solo Maintainer Adversarial Review after implementation, never claimed
as independent. No gate weakening is authorized.

## Preview and rollout

Prepare only an isolated synthetic Firebase emulator environment, using actual
application authorities and persisted emulator data. Test authentication/roles,
deny non-preview project identifiers, and run no external messaging/file/billing
workers. A public URL alone is not evidence of isolation. Check repository CI and
hosting configuration before pushing a branch or opening the requested Draft PR.

No migration is required to retain old records. Any later grouping of properties
previously representing apartments requires a reviewed mapping, dry-run counts,
relationship reconciliation, verified export/restore and a separate approval.
Rollback disables the feature/reverts code; it must preserve child records and
historical links. Do not activate production or collapse dwellings automatically.

## Results

Implementation is complete for isolated preview review. See the separate
[adversarial review](../reviews/property-dwellings-preview-20260921.md),
[ADR](../decisions/ADR-20260921-property-dwellings.md) and
[preview runbook](property-dwellings-preview-runbook.md) for contracts, actual
verification, limitations and the unexecuted activation/recovery plan.
