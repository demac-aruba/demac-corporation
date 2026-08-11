# DEMAC ERP Next — Banking, Payments & Reconciliation V1

Status: In Development / preview-domain foundation.

## Objective
Provide read-only bank intelligence, controlled customer-payment allocation and ERP↔bank reconciliation without giving ERP Next transfer authority or storing bank authentication secrets.

## Requirements

- BANK-001: Bank accounts are modeled as read-only financial evidence sources.
- BANK-002: The bank connector must never store banking passwords, Soft Token codes or transfer authority.
- BANK-003: Supported transaction sources include secure read-only browser gateway, CSV, Excel and manual import.
- BANK-004: CSV/Excel remains the official reconciliation fallback when no formal bank API exists.
- BANK-005: Incoming transactions store amount, date/time, counterparty, description, reference, account and source.
- BANK-006: Payment matching order is explicit invoice reference → exact combination of invoices → known customer/counterparty/account patterns → oldest-invoice suggestion → human review.
- BANK-007: High-confidence exact matches may become controlled confirmations after sufficient production validation.
- BANK-008: Medium/low-confidence or ambiguous matches require human approval.
- BANK-009: Partial payments and aggregate payments across several invoices are supported.
- BANK-010: Customer-level running balance remains visible after allocation.
- BANK-011: A payment that does not uniquely identify invoice allocation remains unallocated rather than silently assigned.
- BANK-012: Outgoing bank transactions reconcile to supplier bills, approved expenses, payroll or other authorized ERP evidence.
- BANK-013: Reconciliation compares bank transaction count and ERP transaction count and reports auto-reconciled, review and missing items.
- BANK-014: Reconciliation evidence and operator decisions are auditable.
- BANK-015: Banking connector is structurally incapable of initiating a payment or transfer.

## Example allocation

Customer has open invoices Afl. 5,000 + Afl. 8,000 + Afl. 1,000 = Afl. 14,000.

Afl. 13,000 incoming with customer match and exact combination → suggest Afl. 5,000 + Afl. 8,000. Customer remaining balance = Afl. 1,000.

Afl. 4,000 incoming without explicit invoice reference → no exact combination. Oldest-first may be shown as a suggestion, but operator approval is mandatory.

## Integration scope

No live Aruba Bank browser connector, bank credentials, automated login, QuickBooks posting or Firebase persistence is enabled in this checkpoint. It defines the UI, matching engine and security boundary first.
