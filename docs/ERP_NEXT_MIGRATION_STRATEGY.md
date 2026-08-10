# DEMAC ERP Next — Legacy Migration Strategy

## Principle

Do not delete or mutate Legacy during the greenfield build. Legacy is frozen as a reference and operational fallback until ERP Next passes migration and acceptance gates.

## Phase 0 — Inventory Legacy

Create an explicit inventory of:
- customer records
- properties/sites
- HVAC equipment/assets
- appointments
- work orders
- technician reports and media
- employees and vans
- inventory data
- invoices/payment references
- WhatsApp booking sessions and conversation-related records
- settings and company rules

For every Legacy collection/table, document owner, quality, duplicate risk and future canonical destination.

## Phase 1 — Canonical mapping

Map Legacy concepts to ERP Next entities. Avoid blindly copying shapes that were created around old screens.

Examples:
- old customer address fields -> Customer + Site
- AC fields embedded in reports -> Asset
- support appointment -> WorkOrderAssignment linked to one customer-facing job
- material text -> InventoryTransaction where reliable
- WhatsApp scheduling state -> Conversation + appointment history when durable business history is required

## Phase 2 — Adapter layer

ERP Next application services talk to interfaces, not directly to Legacy implementation details. Firebase can initially back those adapters while the canonical contract stays provider-neutral.

## Phase 3 — Dry migration

Run repeatable migrations into a test/staging data environment.

Validation includes:
- record counts
- duplicate detection
- customer/site relationship integrity
- asset relationship integrity
- appointment/work-order relationship integrity
- invoice/payment totals where migrated
- media/document availability
- role/permission mapping

## Phase 4 — Parallel validation

For a controlled period, compare key outcomes between Legacy and ERP Next:
- today's schedule
- customer history
- technician assignments
- open work orders
- critical inventory quantities
- open invoices/balances

Any mismatch becomes a migration exception, not an invisible manual fix.

## Phase 5 — Cutover

Cutover requires:
- owner acceptance
- office operator acceptance
- technician acceptance for field workflows
- reconciliation sign-off for finance/inventory data in scope
- tested rollback plan
- production backup
- written cutover checklist

## Legacy retirement

After cutover, Legacy becomes read-only for a defined retention period before any infrastructure retirement. Historical evidence must remain accessible according to DEMAC retention policy and applicable legal requirements.
