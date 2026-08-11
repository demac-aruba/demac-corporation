# ERP Next — Unified Customer 360 Timeline V1

## Objective

Make the customer relationship the durable cross-module context instead of forcing office staff to hunt across Scheduling, Work Orders, Field, Communications and Finance.

## Requirements

- CRM-TL-001 — Customer timeline resolves operational events by canonical Customer ID.
- CRM-TL-002 — Appointment hold/confirmation events appear chronologically.
- CRM-TL-003 — Work Order creation/schedule events appear chronologically.
- CRM-TL-004 — Field start and technician submission events appear chronologically.
- CRM-TL-005 — Office Review pending/approved/returned events appear chronologically.
- CRM-TL-006 — Human-recorded report delivery appears as a Communications event.
- CRM-TL-007 — Billing draft / Ready-for-QBO events appear as Finance events.
- CRM-TL-008 — Customer-linked detected payments appear as Finance events.
- CRM-TL-009 — Payment allocations appear as Finance events with invoice and allocation method.
- CRM-TL-010 — Events are ordered by actual event timestamp rather than module grouping.
- CRM-TL-011 — Timeline preserves source entity identity (Appointment, Work Order, Review, Delivery, Billing, Payment/Allocation).
- CRM-TL-012 — Customer 360 exposes relationship KPIs such as open work, approved reports, delivered reports and detected payments.
- CRM-TL-013 — Browser preview proves identity propagation first; production timeline will use immutable/audited ERP events behind Firebase repositories.

## Browser sources

The timeline currently derives from the already persistent test records for:

- appointments
- work orders
- field executions
- office reviews
- report deliveries
- billing drafts
- detected payments
- payment allocations

It does not create duplicate timeline records in storage. The timeline is a projection over source business records.

## Production event model

Recommended future architecture:

business transaction
→ source record / transaction
→ immutable AuditEvent / BusinessEvent
→ Customer timeline projection

The timeline should never become the authoritative source for finance, inventory or work-order truth; it is a relationship projection over authoritative source records.