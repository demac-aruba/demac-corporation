# ERP Next — Receivables, Payment Allocation & Customer Balance V1

## Objective

Provide a controlled receivables allocation engine that distinguishes Invoice, Payment and Payment Allocation and always shows what remains owed after a transfer.

## Requirements

- AR-PAY-001 — Invoice, Payment and Payment Allocation remain separate records.
- AR-PAY-002 — Ready-for-QBO browser billing drafts can stage preview receivable invoices for workflow testing only.
- AR-PAY-003 — Incoming bank transfers can remain detected/unapplied without forcing an invoice match.
- AR-PAY-004 — Explicit invoice reference is the highest-priority match signal.
- AR-PAY-005 — An exact single-invoice amount can produce a high-confidence suggestion.
- AR-PAY-006 — An exact combination of multiple open invoice balances can produce an aggregate suggestion.
- AR-PAY-007 — Oldest-invoice application is a low-confidence operator-confirmed fallback only.
- AR-PAY-008 — Partial/ambiguous transfers are never auto-posted in the current maturity phase.
- AR-PAY-009 — Operator applies a suggestion explicitly.
- AR-PAY-010 — Allocation updates invoice open balance and payment unapplied amount independently.
- AR-PAY-011 — Invoice status becomes `partial` or `paid` from remaining balance; receipt of a payment alone never means every invoice is paid.
- AR-PAY-012 — Customer-level balance is the sum of remaining eligible invoice balances.
- AR-PAY-013 — After allocation ERP Next surfaces both remaining payment and remaining customer balance.
- AR-PAY-014 — Allocation records retain payment, invoice, customer, amount, method and timestamp evidence.
- AR-PAY-015 — Re-processing the same suggested payment/invoice pair uses stable allocation identity in browser preview storage.
- AR-PAY-016 — Unknown/unmatched payments remain unapplied for review.

## Matching hierarchy

1. explicit invoice/QBO reference
2. exact amount / exact combination of open invoice balances
3. oldest-invoice fallback suggestion
4. manual human allocation for unresolved ambiguity

## Browser preview persistence

- receivable invoices: `demac.erp-next.finance.receivable-invoices.v1`
- detected transfers: `demac.erp-next.finance.bank-payments.v1`
- allocations: `demac.erp-next.finance.payment-allocations.v1`

These records are testing aids only; they do not alter Aruba Bank or QuickBooks.

## Example behavior

If a customer owes Afl. 5,000 + Afl. 8,000 + Afl. 1,000 and transfers Afl. 13,000, the exact-combination engine can suggest the Afl. 5,000 and Afl. 8,000 invoices and surface **Afl. 1,000 remaining customer balance**.

If the same customer transfers only Afl. 4,000 with no explicit reference, no exact combination exists. ERP Next may show the oldest-invoice fallback, but it remains unapplied until an operator explicitly approves it.

## Production path

Bank read-only transaction
→ staged Payment
→ match suggestion
→ human/approved allocation
→ Payment Allocation records
→ invoice/customer balance update
→ QBO reconciliation/sync
→ audit evidence

No ERP action in this workflow is allowed to move money.