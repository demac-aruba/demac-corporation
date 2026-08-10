# DEMAC ERP Next — CRM Customer 360

Status: In Development / master-data foundation.

## Objective

Create the canonical customer workspace before connecting production Firebase data. The CRM is the relationship and commercial memory of DEMAC, not merely a contact directory.

## Core requirements

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

## Master-data V2 requirements

### CRM-013 — Progressive customer registration
Creating a customer captures only the minimum relationship identity needed to continue work: display name, customer type, phone/WhatsApp, optional email, preferred language and general area. Property and HVAC information must not be forced into the customer form.

### CRM-014 — Duplicate detection before creation
The customer form must warn when display name, phone or email resembles an existing customer. The first implementation is deterministic; later AI may assist, but AI never silently merges records.

### CRM-015 — Contact records
A customer can have multiple contacts with role/relationship, phone, email and primary-contact status. Commercial accounts must not be limited to one person's contact details.

### CRM-016 — Property/site records
A customer can own or manage multiple service sites. Each site carries its own full address, future GAC mapping, DEMAC operating sector and access/parking/gate notes.

### CRM-017 — Equipment registry
Each HVAC asset belongs to one customer and one site. Registration captures system type, room/equipment name, capacity, brand and serial number while preserving room for future model, QR, warranty and technical fields.

### CRM-018 — No destructive CRM delete as normal workflow
Master-data correction should use archive, replace or merge semantics so service, communication, financial and audit history remain traceable.

### CRM-019 — Master data before transactions
Appointments, work orders, invoices and communications reference canonical customer/site/equipment IDs. Transactional modules must not become alternate stores of customer identity.

## Current implementation

- Premium customer list + search rail.
- Interactive selected customer context.
- Customer 360 header and relationship KPIs.
- Tabbed information architecture.
- Overview with relationship facts, sites/assets and recent activity.
- Customer Intelligence side rail.
- Native create/edit customer drawer.
- Deterministic duplicate warning by customer name, phone and email.
- Contact registration UI.
- Property/site registration UI with GAC/sector placeholders.
- HVAC equipment registration UI tied to a property.
- Responsive premium master-data layouts in light and dark themes.
- Expanded CRM repository adapter contract for customer/contact/site/asset CRUD plus archive/merge semantics.
- Preview data only; no production Firebase reads or writes.

## Next CRM work

1. Duplicate review/merge workflow.
2. Property 360 and equipment detail profile.
3. Timeline event contract and filters.
4. Opportunity/recommendation lifecycle.
5. Permission matrix by role/field/action.
6. Customer tags/segments and maintenance relationships.
7. Firebase adapter design and Legacy migration mapping after the canonical flows are accepted.

## Questions intentionally deferred

These do not block the present structure:
- final customer number format
- mandatory fields that may differ for residential versus commercial customers
- whether customer health score is visible to every office role or management only
- exact Aruba GAC address-assistance interaction
- final financial fields visible to non-finance office operators
- whether an equipment serial number becomes mandatory for specific equipment classes
