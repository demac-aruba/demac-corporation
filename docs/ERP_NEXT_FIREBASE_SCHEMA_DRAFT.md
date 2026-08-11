# ERP Next — Firebase Schema Draft

Status: **Planned / implementation-ready, not applied to Firebase Console yet.**

The data model is intentionally provider-neutral. Firebase/Firestore is the first persistence adapter, not the business architecture itself.

## Core collections

### Identity / security
- `users`
  - authenticated user profile, role, active status, employee link where applicable
- `audit_events`
  - append-only sensitive business/security events
- `settings`
  - governed business configuration with version metadata
- `integration_states`
  - non-secret provider health/status metadata only

### CRM
- `customers`
- `contacts`
- `sites`
- `assets`
- `leads`
- `opportunities`
- `estimates`

### Operations
- `appointments`
- `work_orders`
- `work_order_assignments`
- `field_reports`

Appointment, Work Order, Field Report and Office Review remain separate business states. A calendar event must not become the work-order data model.

### Inventory / purchasing
- `inventory_items`
- `inventory_locations`
- `inventory_transactions`
- `inventory_balances`
- `tools`
- `purchase_orders`
- `vendors`

`inventory_transactions` is the inventory source-of-truth ledger. Balances are derived/materialized views and must reconcile to ledger movements.

### Finance
- `invoices`
- `payments`
- `payment_allocations`
- `bank_transactions`
- `expenses`

A Payment is distinct from an Invoice. A Payment Allocation is distinct from both. This is required for partial payments, aggregate transfers and unapplied cash.

### Communications
- `conversations`
- `communication_cases`
- `messages`

Conversation ownership, internal notes and customer messages must stay structurally distinguishable.

### Management
- `projects`
- `employees`
- `documents`
- `alerts`
- `automations`

## Data integrity principles

1. Stable IDs are created once and never recycled.
2. Cross-entity relationships use IDs, not copied display names as authority.
3. Server timestamps become authoritative once Firebase is connected.
4. Sensitive writes use optimistic concurrency / transaction checks where practical.
5. Ledger/event collections are append-oriented. Corrections create reversing/corrective events rather than silent mutation.
6. Documents store storage references and checksums, not large binary data inside Firestore documents.
7. Financial totals are calculated from governed source data; AI is never the source of financial truth.
8. Provider IDs (QuickBooks, Meta, bank import identifiers) are adapter metadata, not primary business IDs.

## Initial indexes expected

Exact indexes will be generated from implemented queries before Console deployment. Expected composite-query families include:

- appointments: `startsAt + primaryVanId + status`
- work orders: `status + scheduled/updated timestamp`
- customer assets: `customerId + siteId + status`
- opportunities: `stage + ownerId + expectedCloseAt`
- inventory transactions: `itemId + location/workOrder + createdAt`
- invoices: `customerId + status + dueAt`
- bank transactions: `status + transactionDate`
- conversations: `queue + status + updatedAt`
- alerts: `severity + resolvedAt + createdAt`
- audit events: `module/entity/actor + occurredAt`

## Firebase Console work deferred

Do **not** change production Firestore rules, indexes or project configuration from this document alone. Before applying the adapter we will review:

- Firebase project/environment strategy
- Auth providers and user identities
- Security Rules generated from the capability model
- required composite indexes
- Storage paths/rules for evidence
- Functions/server-side responsibilities
- backup/export policy
- cutover plan

No credentials, private keys, banking tokens or service-account material belong in this document.
