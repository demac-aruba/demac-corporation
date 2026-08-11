# ERP Next — Commercial Clearance Readiness V1

## Objective
Replace the final manual Job Readiness toggle with structured Commercial Terms and Work Order clearance evidence while keeping accounting, bank reconciliation and QBO authority separate.

## Requirements

- **COMM-RDY-001** Commercial Clearance is derived from a reviewed Commercial Terms Policy plus Work Order evidence when that policy requires evidence.
- **COMM-RDY-002** Commercial Terms Policy is configured by Work Preset and starts unreviewed.
- **COMM-RDY-003** An unreviewed policy produces Commercial Clearance AT RISK rather than assuming a requirement.
- **COMM-RDY-004** Supported policy modes are `no_preclearance`, `deposit_required`, `po_required` and `finance_approval`.
- **COMM-RDY-005** A reviewed `no_preclearance` policy produces READY without fabricating payment, PO or approval evidence.
- **COMM-RDY-006** A policy that requires evidence but has no completed Work Order clearance record produces AT RISK.
- **COMM-RDY-007** A saved clearance record prepared under a different policy mode becomes AT RISK until re-reviewed under the current mode.
- **COMM-RDY-008** An explicitly blocked Commercial Clearance record produces BLOCKED.
- **COMM-RDY-009** Deposit-required clearance must use a required amount established from accepted commercial evidence; ERP must not calculate or guess that amount from an unsupported assumption.
- **COMM-RDY-010** Deposit-required clearance with no confirmed received amount remains AT RISK.
- **COMM-RDY-011** A confirmed received amount below the required amount produces BLOCKED.
- **COMM-RDY-012** A sufficient confirmed deposit without a payment/bank evidence reference remains AT RISK.
- **COMM-RDY-013** A sufficient confirmed deposit with an evidence reference produces READY for the Commercial Clearance dimension.
- **COMM-RDY-014** A payment evidence reference supports pre-dispatch clearance only; it does not create a bank transaction, allocate a payment, change an invoice balance or mark anything paid.
- **COMM-RDY-015** PO-required clearance without a PO/authorization reference is BLOCKED; a reviewed clearance with reference is READY.
- **COMM-RDY-016** Finance-approval clearance requires an approver identity and approval reason; incomplete approval evidence is AT RISK.
- **COMM-RDY-017** Commercial Clearance does not create invoices, journal entries, payments, bank transactions or QBO records.
- **COMM-RDY-018** Commercial Clearance participates in consolidated READY / AT RISK / BLOCKED and the risk signature used by governed AT RISK dispatch releases.
- **COMM-RDY-019** Changes to commercial policy/evidence may invalidate a previous AT RISK release for future Field start but never rewrite historical releases or Field starts.
- **COMM-RDY-020** After this checkpoint, all eight Job Readiness dimensions are source-owned; the consolidated Job Readiness panel exposes no manual READY toggle.
- **COMM-RDY-021** Command Center must consume the same source-owned readiness calculation without depending on legacy manual readiness checks.
- **COMM-RDY-022** Legacy browser readiness-check storage may remain temporarily readable for migration compatibility but is not authoritative for current readiness.
- **COMM-RDY-023** Production deposit evidence should eventually link to authoritative bank/payment reconciliation records rather than a free-form preview reference.
- **COMM-RDY-024** Production PO evidence should eventually link to a durable customer authorization/document record.
- **COMM-RDY-025** Production Finance approval requires authenticated authorized identity, durable timestamp and append-oriented audit history.

## Readiness authority after V1

All eight dimensions are calculated from their owning workflows:

1. Customer Confirmation — Scheduling
2. Van Assignment — Work Order assignment
3. Exact HVAC Scope — Work Order Scope
4. Materials — Material Plan + Inventory/Transfers
5. Crew & Required Skill — Workforce Registry
6. Required Tools — Tool Asset Registry + Tool Requirement Policy
7. Site Access — Work Order Access Plan + CRM context
8. Commercial Clearance — Commercial Terms Policy + Work Order clearance evidence

`Job Readiness` calculates the decision. It does not own or manually rewrite these facts.

## Accounting guardrail

Pre-dispatch commercial clearance and accounting truth are intentionally separate. A clearance record may reference evidence, but authoritative payment allocation, customer balance, invoice status, bank reconciliation and QuickBooks Online remain in their dedicated finance workflows.

## Current data mode
Browser-persistent preview policy/evidence. Production migration should connect accepted estimates/contracts, customer PO evidence, bank/payment matching and authenticated Finance approvals without weakening the separation of authority.
