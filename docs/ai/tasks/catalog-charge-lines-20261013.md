# Task: Select catalog articles as invoice-style appointment lines

## Context and scope
- Owner correction 2026-10-13: a selected 12K/18K service already has its specifications.
  Remove redundant service/BTU configuration and allow successive services, add-ons and products.
- Deep Review: financial pricing input/compatibility is affected. Existing Booking Authority,
  canonical services and Pricing Authority remain the owners (OPS-SCHED-CHARGES-001/002).
- Base main14eda789; implementation branch fix/catalog-charge-lines. Preserve concurrent QBO work.
- No official invoice/QBO posting, catalog migration, customer communications or production test writes.

## Acceptance
- [x] Catalog-only search followed by immutable selected article, quantity, unit price and amount.
- [x] Search remains below appended lines; + Añadir opens/focuses it; selection clears it for next item.
- [x] Governed capacity-specific catalog codes resolve BTU automatically; fixed articles need none.
- [x] No inference from marketing names/SKU, arbitrary prices or contradictory capacity for new lines.
- [x] Historical agreements, draft/payment concurrency, leases, exact retries and audit remain intact.
- [x] Desktop/mobile rendering, 60-line limit and bounded local search verified.

## Verification and recovery
- Focused pricing/charges/editing tests, existing financial browser flow and loading/concurrency suite.
- Typecheck/build and independent review. Synthetic fixtures only; no real appointments are used.
- Backend compatibility precedes frontend activation. Prior frontend can use the new backend;
  retain projectionOnly guard and persisted canonical BTU. Do not restore old financial data.
- Owner's existing authorization covers reviewed merge/deploy of this update; compatible backend must precede frontend activation.

## Local verification results
- 53 pricing/charges/editing tests PASS, no skips.
- 38 loading/concurrency/catalog cases PASS; complete financial flow at1440/1366/390 PASS, including reload persistence.
- Typecheck and production build PASS; generated configuration changes restored.
- Firestore emulator case added; local Java17 cannot run the required Java21 runtime. CI must execute this gate before readiness.
- See ../evidence/catalog-charge-lines/ for synthetic screenshots and results.

## Final integration evidence
All five CI workflows passed on9acb620, including13/13 real Firestore/authorization tests with Java21 and no skips. Protected preview returned HTTP200 for ERP HTML and the new catalog-lines bundle. Main00090bb5 metadata-only additions merge cleanly and their4 tests pass. Final release preparation must rerun CI on its resulting head.
