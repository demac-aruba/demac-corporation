# Task: Appointment estimates, final charges and operational receipts

## Context and approval
- Owner request 2026-10-10: implement the three approved DEMAC blue/icon-rich screenshots and merge/deploy only after deep review, preserving existing workflows and real records.
- Baseline main: `1f1bf7783a9bf6706b8008ce0a3fa63a5c065741`; production frontend `demac-corporation-web`, `demac-aruba.com`.
- Mode: Deep Review; independent reviewer `financial_review`. No live test records or outbound messages.

## Scope and governance
- Add optional appointment-owned original/current estimate and final charge, with item quantities, BTU, governed base price and explicit operator overrides.
- Record cash, transfer, POS and SUAVE receipts against the same appointment; immutable receipt identity, audited voids, actor/time/reference, split and partial payments.
- Reuse Booking Authority, governed pricing and the existing `payments` collection. QBO remains the accounting authority. No invoice issuance, bank verification, automatic charging, stock or payroll effects.
- Financial confirmation never completes Field execution or bypasses after-hours attendance/report gates. Existing technical completion remains authoritative.
- Rule `OPS-SCHED-CHARGES-001`; security is server-side, including transaction-time active provisioned roles. No Firestore/Storage rules change.
- Preserve appointments without new data as not recorded. No backfill or migration. No duplication onto support Work Orders or follow-up appointments.

## Acceptance criteria
- [x] Three stages retain approved colors, icons and layout, with accessible desktop/mobile controls.
- [x] Original estimate immutable; final, received and outstanding distinct; unknown prices never become zero.
- [x] Financial creation is atomic with booking when supplied; old callers remain compatible.
- [x] Split/partial payments, exact retries, lost-response recovery, version conflicts, voids and credit balances are explicit.
- [ ] Existing booking/hold/project/support/historical/overtime/references/communication/Field flows pass relevant regressions.
- [ ] Independent complete-diff review and required tests pass before merge/deploy.

## Verification and release
- Functions syntax, focused financial and facade tests; transaction/emulator contention and role-denial tests; Booking/Field/communication/Project transitive regressions.
- ERP typecheck, production build and real-component browser scenarios, screenshots at desktop/mobile sizes.
- Verify exact tested commit/tree, backend then frontend deployment and read-only production smoke. Retain prior production deployment for rollback; new additive records remain intact on code rollback.
- Local evidence: Booking 235/235, Field 425/425, WhatsApp 121/121; final focused financial/creation/pricing 67/67. ERP typecheck and production build passed. Financial browser flows at 1440/1366/390 passed; actual booking parent 14 cases passed. Remaining: real Firestore emulator and full PR CI on the release tree.
