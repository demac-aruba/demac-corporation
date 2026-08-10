# DEMAC ERP Next — CRM Customer 360 V1

Status: In Development / UI foundation.

## Objective

Create the canonical customer workspace before connecting production Firebase data. The CRM is the relationship and commercial memory of DEMAC, not merely a contact directory.

## V1 requirements

### CRM-001 — One customer identity
A returning customer must resolve to the same customer record instead of creating a new customer for every appointment or conversation.

### CRM-002 — Customer and site are separate
A customer may have multiple properties/sites. Site-specific address, access, equipment and operational history remain attached to the site.

### CRM-003 — Customer and HVAC asset are separate
HVAC equipment is a durable asset record attached to a site, with its own service/repair history and technical identity.

### CRM-004 — Customer 360 header
The customer workspace surfaces status, type, primary location, customer since, health, lifetime relationship value, outstanding balance, open work and asset counts.

### CRM-005 — Relationship timeline
Calls, WhatsApp conversations, appointments, work orders, estimates, invoices, payments, documents, notes and opportunities can appear in one chronological customer timeline.

### CRM-006 — Multiple CRM sections
The workspace provides explicit sections for Overview, Contacts, Properties, Equipment, Jobs, Estimates, Invoices, Payments, Communications, Opportunities and Documents.

### CRM-007 — Search and customer switching
Office users can search by customer name, phone, email, type or site/location and switch customer context without leaving the CRM workspace.

### CRM-008 — Financial context is visible but permission-aware
Customer-level balance and invoice/payment context can appear inside CRM while detailed financial operations remain controlled by finance permissions.

### CRM-009 — Customer intelligence
The CRM may surface measurable next actions such as open proposals, maintenance due, outstanding balance or missing follow-up. AI recommendations must be grounded in structured data and governed rules.

### CRM-010 — Duplicate merge pathway
The architecture must support controlled customer merging with audit history rather than silent deletion of duplicates.

### CRM-011 — Provider-neutral CRM repository
CRM UI/services must use a repository/service boundary. Firebase implementation details must not become the CRM domain model.

### CRM-012 — Responsive premium UX
The Customer 360 workspace must preserve usable hierarchy on desktop and smaller screens while retaining the global ERP light/dark themes.

## Current implementation

- Premium customer list + search rail.
- Interactive selected customer context.
- Customer 360 header and relationship KPIs.
- Tabbed information architecture.
- Overview with relationship facts, sites/assets and recent activity.
- Customer Intelligence side rail.
- Responsive layouts.
- CRM repository adapter contract.
- Preview data only; no production data writes.

## Next CRM work

1. Canonical customer create/edit form design.
2. Contacts model and UI.
3. Property/site profile with Aruba location/sector metadata.
4. HVAC asset/equipment registry.
5. Duplicate-detection and merge UX.
6. Timeline event contract and filters.
7. Opportunity/recommendation lifecycle.
8. Permission matrix by role/field.
9. Firebase adapter design and migration mapping after the canonical flows are accepted.

## Questions intentionally deferred

These do not block the V1 structure:
- final customer number format
- mandatory fields for residential versus commercial customers
- whether customer health score is displayed to every office role or management only
- exact Aruba GAC address-assistance interaction
- final financial fields visible to non-finance office operators
