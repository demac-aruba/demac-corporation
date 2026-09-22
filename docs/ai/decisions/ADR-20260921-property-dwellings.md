# ADR: Optional dwellings owned by canonical Property
- Status: Proposed for owner review; implemented only in an isolated preview.
- Date: 2026-09-21
- Owner: DEMAC maintainer; human approval required for production activation.
- Related: tasks/property-dwellings-preview-20260921.md; existing Customer, Property, Booking and Field authorities.

## Context and decision
One Customer may own several Properties. A Property can contain independent main-house, apartment and annex dwellings. Property/Site identity and its owner/address stay canonical. This extends Property; it does not create another Property catalog or source of truth.

Use properties/{propertyId}/dwellings/{dwellingId} and properties/{propertyId}/areas/{areaId}. Each child stores clientId/propertyId; Area also stores an optional dwellingId. IDs are opaque and stable, independent of names. Codes are normalized (NFKC, whitespace, case) and unique within Property, or within the Area's dwelling container. Child moves and automatic historical classification are not offered.

Property summary fields are hasIndependentDwellings, dwellingCount and locationVersion. A type named Apartamento has no implicit effect. Creating children never creates equipment. Existing equipmentSystems IDs remain canonical; new on-site equipment links dwellingId/areaId. Multiple physically distinct units may share room, brand and capacity.

Office operations list_property_locations and save_property_locations are exposed through the authenticated existing office authority. Save uses a transaction, property version, deterministic retry IDs, payload fingerprint and immutable actor/before/after record in bookingIdempotency. Groups contain at most 100 rows and 200 total location/contact writes; larger complexes use successive batches. A stale version rejects the entire batch.

Contact identity remains contacts; existing contactPropertyAssignments optionally include dwellingId. Assignment precedence is all properties, property, then dwelling. Requester and access-contact IDs/snapshots on a visit do not change ownership, residence, billing, additional-work approvals or communication rules. A neighboring dwelling's assignment is excluded. Existing recipient snapshots remain intact.

Offers carry optional dwellingId/requesterId/accessContactId. Commit validates Customer → Property → Dwelling and freezes locationSnapshot. Work Orders, Work Visits/return visits, Visit Assets, Work Interventions and report projections retain that context. Equipment attach and registration validate the dwelling and area at the server boundary. Capacity and pricing remain with existing authorities.

## Alternatives and tradeoffs
- Separate properties for every apartment would duplicate parent identity and lose the shared address relationship.
- A general recursive location tree exceeds this bounded requirement.
- Client-only location metadata cannot protect cross-property writes or retries.
- Subcollections require contextual reads. Equipment reads are scoped to the current Property; no global A/C load is added to New appointment.

## Compatibility, activation and recovery
The approved unified editor uses the same model for residential houses and apartment complexes. `main_office` is an additional dwelling type alongside `main_house`, `apartment` and `annex`. Create Property, Create Customer + First Property and Edit Property can atomically commit an optional locations draft. Parent and child fields share the same transaction, version check and request replay; existing API callers that omit locations are unchanged. Area drafts can target the property or an already saved dwelling. No separate editor-only source of truth is introduced.

No migration is required. Missing dwellingId means unclassified/legacy, never first apartment. Existing jobs retain their original destination and recipient snapshots. Old A/C remain visible through the property unclassified view.

Production is NOT activated. Before any later rollout: owner approval, current-main rebase/review, rerun gates, deploy compatible backend before frontend, confirm existing role/rule boundaries, then enable only approved properties. No Firestore/Storage rule change is included.

For apartments currently represented by separate Properties: produce a proposed grouping manifest containing all current Property, Customer, Equipment, Appointment, Work Order, Visit and contact references and counts. Run read-only reconciliation and duplicate checks. Preserve the original Property IDs and historical references; do not delete/recreate/merge parents. Any explicit prospective grouping or equipment classification needs its own reviewed operation and authorization. Obtain a dated export, verify restore in an isolated environment, compare counts and relationship hashes, then review a dry-run diff. Store mapping version and deterministic operation IDs for retries.

Rollback first disables entry of new dwelling bookings, keeps a backend able to read additive fields, and preserves all child records/evidence. Restore only from verified backup after separately approved recovery, never erase newly recorded history by blindly reverting data. Existing legacy application cannot be assumed to display dwelling context; keep dwelling-specific operations in ERP Next until legacy parity is explicitly reviewed.
