# ERP Next — Scheduling CRM Onboarding & Multi-Slot Appointment V1

## Objective

Improve Scheduling without changing the approved four-van visual structure:

1. a multi-hour appointment must read as one customer appointment, not repeated customer cards per occupied hour;
2. New Appointment must search the CRM relationship by typed customer name;
3. if the relationship does not exist, Scheduling can create the Customer plus one or more Properties and optional additional Contacts before booking.

## Reused DEMAC operating rules

The implementation reuses business behavior from the prior DEMAC system and current company-rules registry, but does **not** reuse the old visual design.

- One customer relationship may have multiple properties, contacts and HVAC assets.
- Property addresses do not belong inside the Customer identity record.
- Scheduling offers availability from real capacity/routing rules rather than an unrestricted customer time picker.
- Multiple A/C units at one property may reserve consecutive work spots.
- Large same-property jobs may use support vans, but the customer remains one appointment conversation.
- Only the primary assignment owns customer confirmation/reminder communication.

## Requirements

### Multi-slot visual behavior

- SCHED-MULTI-001 — A single assignment occupying 2+ standard work spots displays customer/job information once.
- SCHED-MULTI-002 — The visual block reserves enough vertical space to represent all occupied standard spots.
- SCHED-MULTI-003 — The block shows appointment start/end time and number of work spots reserved.
- SCHED-MULTI-004 — Empty work spots before/after the block remain visible and individually schedulable.
- SCHED-MULTI-005 — Occupancy calculations continue counting every occupied spot even though customer text displays once.
- SCHED-MULTI-006 — A support-van assignment remains a separate internal van block but retains the same customer appointment relationship and does not become a second customer communication owner.
- SCHED-MULTI-007 — Full-day/cross-lunch work can remain one visual appointment while preserving the protected lunch/reset rule.

### CRM-aware booking

- SCHED-CRM-SEARCH-001 — New Appointment begins with typed CRM customer search rather than a long select list.
- SCHED-CRM-SEARCH-002 — Search matches customer name and can also match phone/email for operator convenience.
- SCHED-CRM-SEARCH-003 — Booking requires a canonical Customer ID and Property/Site ID before capacity options are calculated.
- SCHED-CRM-SEARCH-004 — Manual unregistered customer/property text is no longer the normal booking path.
- SCHED-CRM-SEARCH-005 — After selecting a customer, only that customer's registered properties appear.
- SCHED-CRM-SEARCH-006 — Selecting the property supplies the booking Site identity and the best-known DEMAC sector.

### Quick Add Customer

- CRM-ONBOARD-001 — Scheduling exposes `Add Customer` when the CRM search does not find the relationship.
- CRM-ONBOARD-002 — Customer identity captures display name, type, optional legal name, phone/WhatsApp, email and preferred language.
- CRM-ONBOARD-003 — At least one service property/address is required before the newly created customer can be used for booking.
- CRM-ONBOARD-004 — The operator may create multiple properties in the same onboarding flow.
- CRM-ONBOARD-005 — The operator may add multiple additional contacts with relationship/role, phone and email.
- CRM-ONBOARD-006 — Properties and Contacts persist beneath the same Customer master-data relationship.
- CRM-ONBOARD-007 — HVAC equipment registration is not required to create the appointment; assets remain a separate property-linked CRM record.
- CRM-ONBOARD-008 — Exact duplicate signals by customer name, phone or email block blind creation and offer the existing customer relationship instead.
- CRM-ONBOARD-009 — A newly created customer/property is immediately selected back into the Scheduling booking flow without retyping.

## Browser preview persistence

Current test mode uses the existing browser CRM stores:

- customers: `demac.erp-next.crm.customers.v1`
- customer master data: `demac.erp-next.crm.master.{customerId}.v1`

The same hierarchy is intended for the Firebase repository adapter later.

## Data hierarchy

Customer
→ Contacts
→ Properties / Sites
→ HVAC Assets
→ Appointment
→ Work Order
→ exact equipment scope
→ Field Execution

A second address for the same person/company creates a second Property, **not a second Customer**.

## Example

A residential customer has three standard-service A/C units and is assigned Van 2 from 8:30–11:30.

Expected schedule view:

- one Van 2 appointment block from 8:30–11:30;
- customer name appears once;
- `3 spots` / `3 units` visible on that single block;
- 1:30, 2:30 and 3:30 remain visible as independent afternoon capacity;
- occupancy still counts 3 morning spots used.

## Future production path

The browser storage functions will later be replaced by CRM repository calls/Firebase persistence. Scheduling should not change its information hierarchy when that happens.
