# DEMAC ERP Next — CRM Relationship Detail V3

Status: In Development / preview UX and domain behavior.

## Purpose

Turn customer master data into navigable operational records. Office users must be able to inspect a property or HVAC asset without searching through appointments, notes or technician reports, and duplicates must be corrected without deleting business history.

## Requirements

### CRM-020 — Controlled duplicate review
Potential duplicate customers are reviewed side by side with match confidence and the fields that support the match. A merge always requires a human-confirmed canonical customer. AI may recommend but never silently merges.

### CRM-021 — History-preserving merge
Merging two customer identities must preserve and relink properties, HVAC assets, appointments, work orders, invoices, payments, communications, documents and audit history. The duplicate identity remains traceable as an alias/reference rather than being silently deleted.

### CRM-022 — Property 360
Every site/property has its own detail view containing address, GAC classification, DEMAC operating sector, geocode status, access notes, HVAC equipment at the site, recent site activity and work-readiness context.

### CRM-023 — Equipment 360
Every durable HVAC asset has its own technical profile and history. System type, room/equipment name, capacity, brand, serial, refrigerant/voltage verification, QR identity, warranty context, service history, findings and future preventive intelligence belong to the asset rather than an appointment.

### CRM-024 — Site-specific history isolation
A customer with several properties must not see unrelated work from another property mixed into a site history. Customer 360 may aggregate; Property 360 remains location-specific.

### CRM-025 — Evidence-based equipment intelligence
Future AI recommendations must reference real equipment measurements, service history, findings and configured maintenance rules. AI must not invent equipment specifications or technical condition.

## Preview implementation in this checkpoint

- `Import / Merge` opens a controlled duplicate-review experience.
- Match confidence and incoming-vs-canonical identity are visually separated.
- Merge preview explicitly lists what operational history is preserved.
- Property records open a dedicated Property 360 drawer.
- Property 360 surfaces routing/GAC/sector/access context, site assets and recent work.
- Equipment rows open a dedicated Equipment 360 drawer.
- Equipment 360 surfaces technical identity, service history, findings and governed AI context.
- All behavior remains preview-only; Firebase is not read or written by these flows yet.

## Deferred until integration phase

- actual duplicate-scoring service and field-weight configuration
- alias collection/schema in Firebase
- transactional relinking implementation
- official GAC lookup/geocoder integration
- real equipment history and measurement aggregation
- warranty-source rules and QR generation
