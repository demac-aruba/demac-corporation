# DEMAC ERP Next — Purchasing & Finance V1

Status: In Development / preview-domain foundation.

## Objective
Connect inventory demand, supplier purchasing, expense evidence, customer/supplier balances and QuickBooks governance without turning the ERP into an uncontrolled accounting engine.

## Requirements

- FIN-001: Finance Center provides cash, AR, AP, collected/invoiced revenue, expenses, gross margin and control queues.
- FIN-002: Customer-level AR must retain invoice allocation and remaining customer balance.
- FIN-003: Ambiguous customer payments remain unallocated until confirmed.
- FIN-004: Accounts payable is driven by supplier bills, due dates, outstanding balance and purchasing evidence.
- FIN-005: Budget vs actual compares spend pace to elapsed month and projects month-end spend.
- FIN-006: Expense capture supports voice, receipt photo, supplier invoice PDF and manual entry.
- FIN-007: Expense AI extraction may suggest line-item classifications but original evidence remains authoritative.
- FIN-008: Expense classification separates operational inventory, tools, vehicle/fuel, office, marketing, utilities and other accounting mappings.
- FIN-009: QuickBooks Online remains accounting system of record.
- FIN-010: ERP operational events may prepare/sync QBO invoices, customer payments, bills and expenses through governed adapters.
- FIN-011: Journal entries, refunds, write-offs, deletes and other high-impact accounting actions require explicit authority/approval.

- PUR-001: Purchase Orders have draft, approval, receipt and closure lifecycle.
- PUR-002: Purchasing recommendations use projected inventory availability, minimum/target stock, booked demand and supplier lead time.
- PUR-003: Supplier master stores category, currency, lead time, terms and active state.
- PUR-004: Purchase Order lines can identify item, quantity, cost, destination inventory location, Work Order and/or Project.
- PUR-005: Receipt updates purchasing and becomes an inbound/received inventory event.
- PUR-006: Supplier bill approval should use three-way match: approved PO → confirmed receipt → supplier bill.
- PUR-007: Three-way mismatches are review/blocking exceptions and never silently adjusted.
- PUR-008: AI-generated purchase recommendations remain proposals until approved under capability policy.
- PUR-009: Supplier price history should later inform variance alerts and purchasing recommendations.
- PUR-010: Purchasing and finance retain source documents, decision history and audit evidence.

## Architecture boundaries

Operational truth is computed by ERP modules. Accounting truth is synchronized to QuickBooks only after controlled validation. Banking evidence, invoice allocation, PO/receipt/bill matching and expense evidence remain traceable rather than collapsed into a single editable balance.

## Integration scope

This checkpoint is preview state only. No real QuickBooks API calls, Firebase persistence, bank feed, supplier transmission, inventory receipt posting or accounting writes are enabled yet.
