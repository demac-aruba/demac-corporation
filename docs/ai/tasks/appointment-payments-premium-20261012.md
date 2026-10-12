# Task: Approved premium appointment payments overview

## Context

- Owner approved the first Importes y pagos illustration and explicitly requested merge/deploy, followed by products/services catalog work.
- Surface: ERP Next appointment detail, office operators and read-only auditors.
- Existing financial authority, draft retention and preload behavior already function. This release makes the saved overview match the approved visual hierarchy.
- Mode: Deep Review because this presentation displays and opens controls for operational money.

## Scope

- In scope: four financial cards; persisted work lines/BTU/quantity/agreed unit price; reconciled snapshot differences; payment cards and method shortcuts; history navigation; customer context; responsive styling.
- Out of scope: catalog data seeding, backend/schema/rules, QBO invoicing, technical completion, second work-entry mockup, diagnostic PR568.
- Boundaries: three scheduling components, one CSS module and two synthetic browser tests. Preserve the main branch's PR569 technician instructions.

## Governance

- Authority: Office Booking Authority, appointments.jobCharges and existing operational payment receipts. QBO retains official invoice/accounting ownership.
- Rule: OPS-SCHED-CHARGES-001.
- Security/privacy: existing canManage, blockers, lifecycle restrictions, read failures and pending-operation locks remain; no new endpoint or production data write.
- Legacy parity: null stays unknown; explicit zero stays zero; final-only records do not invent an original estimate; blocked receipts are described as requiring reconciliation.
- ADR/debt: no new architecture or authority; existing appointment-operational-charges ADR remains applicable.

## Acceptance criteria

- [x] Saved financial data uses approved blue/purple/green/amber layout and icons; editor remains the existing reviewed flow.
- [x] Original estimate immutable; final confirmation does not imply technical completion; agreed unitCents and fractional quantities display correctly.
- [x] Recorded receipts count excludes voided receipts; voided receipts and reasons remain visible; negative balance is a credit.
- [x] All four method shortcuts open a draft only; version checks, exact retry and cross-tab draft retention remain intact.
- [x] Read denial/error/loading and hold/cancellation/read-only restrictions remain enforced.
- [x] Desktop and mobile remain usable without document overflow; mobile work table can scroll horizontally.

## Plan and risk

- Add read-only overview components. Keep transport, hook, mutation handlers and authority unchanged.
- No migration/backfill. Roll back the frontend deployment or revert the scoped PR if needed. Previous production deployment: dpl_GqN3HtYk7jZzwZ2C6KYFqYfdpkes.
- Main risks: false payment status under reconciliation, invented original estimate, duplicate payment retries and lost draft state. Covered by independent review and synthetic tests.

## Verification

- 20 appointmentCharges authority invariants pass.
- Real browser/component/authority financial booking-to-final/split-payment flow passes at 1440,1366,390, including unknown-response exact retry.
- Expanded real-drawer loading/finance suite: 24 cases; desktop/mobile, slow read, dedupe, refresh failure, versions, fingerprint, draft retention, exact retry, isolation, amount states, method shortcuts and restrictions.
- 17 appointment detail parity scenarios pass, including saved technician instructions from PR569, attachments, communications, lifecycle and keyboard focus.
- Typecheck and production build pass (including standard prebuild acceptance suites). Build-generated tsconfig/next-env changes are excluded.
- Independent reviewer: /root/financial_review; separate financial fixtures and 25 browser cases pass. See review record.
- Visual inspection: actual drawer at 1440/1366/390 compared with approved first illustration. Synthetic evidence only; no invented room/equipment metadata.
- Release gate: exact-head GitHub checks and ready Vercel production deployment for demac-aruba.com.
- Not run: authenticated customer financial transactions in production; no authenticated session was supplied and audit used synthetic authority/data. Public deployment/version verification follows release.
