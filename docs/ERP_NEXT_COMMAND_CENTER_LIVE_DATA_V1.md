# ERP Next — Live Workflow Command Center Projection V1

## Objective

Make the executive dashboard react to the same test records created through Scheduling, Work Orders, Field, Office Review, Inventory, Billing and Payments instead of remaining isolated static demo content.

## Requirements

- CMD-LIVE-001 — Command Center projects confirmed appointments and temporary holds from persistent Scheduling records.
- CMD-LIVE-002 — Work Order totals, exact-scope completion, in-field and field-submitted status are derived from source records.
- CMD-LIVE-003 — Office Review pending/approved/returned counts are projected from review records.
- CMD-LIVE-004 — Approved reports awaiting delivery and human-recorded sent reports are projected from Communications records.
- CMD-LIVE-005 — Inventory consumption metrics derive from field-generated inventory movements.
- CMD-LIVE-006 — Billing counts, pricing-review risk, QBO-ready state and governed known subtotal derive from Billing records.
- CMD-LIVE-007 — Open receivables, detected payments and unapplied cash derive from Receivables/Payment records.
- CMD-LIVE-008 — Management Attention Queue is derived from current workflow exceptions rather than hard-coded alert copy.
- CMD-LIVE-009 — Missing exact Work Order scope, pending office review, approved-but-unsent reports, pricing review and unapplied cash produce actionable attention items.
- CMD-LIVE-010 — Every attention item links to the operating module where the issue can be resolved.
- CMD-LIVE-011 — Browser test Command Center is explicitly labeled as non-production financial truth.
- CMD-LIVE-012 — Future repository-backed Command Center will retain source/freshness/evidence metadata for authoritative data.

## Operational chain shown

Scheduling
→ Work Orders
→ Field
→ Office Review
→ Customer Delivery
→ Inventory
→ Billing
→ Receivables / Payments

The panel is a projection and never becomes the source of truth for any underlying transaction.

## Current data mode

Browser-persistent test records only.

Future Firebase/QBO/bank data sources will replace the browser readers behind the projection without changing the management information hierarchy.