# ADR: Appointment-owned operational estimates and receipts

- Status: Accepted for implementation; production release gated by review and CI.
- Date: 2026-10-10
- Owners: DEMAC Operations and Finance
- Related task/rule: appointment-pricing-payments-20261010; OPS-SCHED-CHARGES-001
- Authority: owner explicitly requested projected/final amounts and payment capture on appointments, then approved implementation, merge and deployment after deep audit.

## Context

Scheduling needs an original projection, an agreed final amount, and received/pending amounts. BTU, changed work, additional services and time can change the price. The approved design uses DEMAC's broad white modal, blue context/cards and payment icons. Existing appointments and Field, capacity, communication and payroll workflows must remain intact.

## Decision

Booking Authority owns an optional `appointments.jobCharges` operational snapshot. Original estimate remains immutable; current estimate and final are versioned. Prices reuse Company Rules/catalog authority; unknown is null, explicit zero is distinct. Manual prices and changed scope require reasons. Quote fingerprints reject stale prices. Amounts use integer AWG cents and quantities use thousandths.

Receipts use the existing `payments` collection, source `appointment-operational`, with canonical appointment/customer/property/Work Order IDs, method, reference, received timestamp and recording actor. These records document office-reported receipt of money; they do not issue official invoices, post to QBO, verify bank settlement, trigger POS/SUAVE charges, process refunds or create a general accounting ledger. QBO remains official accounting authority. A future accounting screen can consume this evidence.

Initial financial data and optional deposit commit atomically with ordinary/special booking. Holds permit projection but no payment/final. Untouched booking forms and original booking clients omit the optional financial payload; opening/editing the financial section opts in and requires a valid quote. This preserves existing scheduling-only permissions. The UI checks financial acknowledgment in successful booking responses, so an older backend cannot silently drop a deposit.

Every mutation requires an active provisioned office/finance role inside the Firestore transaction, expected version, stable request identity and append-only `chargeEvents` evidence. Auditor is read-only. Identical retries replay; changed retries conflict. Receipt corrections retain the original as voided, never delete it. A void does not execute a refund. Credit balances remain explicit.

Financial confirmation never completes technical work or attendance. Existing Field billing candidates are validated with their canonical projector, shown read-only, and reconciled explicitly using a transaction-time candidate-set fingerprint and recorded note. They are never automatically added to operator lines. Non-AWG/invalid/officially invoiced evidence blocks until reconciled. Existing invoices, Legacy money and foreign receipts likewise block competing balances. No data migration/backfill runs on read or deployment.

## Alternatives considered

| Alternative | Risk | Decision |
| --- | --- | --- |
| Work Order amount/paid fields as new authority | Broad Legacy client writes and duplicated support balances | Rejected |
| Separate accounting ledger/invoice numbering | Competes with QBO | Rejected |
| Auto-add Field candidate totals | Could double-count existing work or addons | Rejected |
| Rewrite/backfill existing appointments | Could reinterpret real historical money | Rejected |

## Consequences

- Additive records preserve operational documents; support vans share one appointment balance and follow-ups do not copy receipts.
- Existing historical financial conflicts require deliberate reconciliation; this release does not silently import them.
- Up to 60 priced lines, 300 receipts and 100 displayed audit events per appointment. Limits fail closed; the full audit remains stored.
- No Firestore/Storage policy, credentials, live data or external messages change.
- UI clears monetary drafts when customer, property, source, Project or phase changes.

## Verification and rollout

Independent review, financial negative/concurrency/recovery tests, actual Firestore emulator, existing Booking/Field/WhatsApp/Project regressions, ERP types/build and browser desktop/mobile gates precede merge.

Release uses `[merge-only] [deploy-appointment-charges]` to deploy the Project commercial guard first, then Office Booking Authority through its existing authenticated workflow after both existing and added gates. Project deployment verifies the reviewed source baseline and preserves its current runtime configuration. Other automatic function releases continue to honor `[merge-only]`. Deploy frontend exact tested tree only after backend success. No scheduled jobs or migrations are invoked.

Rollback frontend first to the previous production deployment; preserve new data and backend financial read/write compatibility. If backend rollback is necessary, financial acknowledgment checks stop silent omission. Never delete new receipts to roll back code. Review again before QBO posting, automated settlement, refunds, foreign-currency support or accounting reports.
