# Task: usable appointment charges workspace and truthful balances

## Context and scope
- Christian approved the faithful UI proposal and merge/deploy on 2026-10-13.
- Deep Review: financial presentation, payment feedback and a confirmed operational PDF.
- Expand only the financial appointment view; compact KPIs, line entry, transient specific
  success feedback, preserved search/confirmation, disclosures for secondary receipt details.
- Draft and confirmed balances use actual work minus recorded receipts, never booking estimates.
- Download confirmed operational statement; no invoice issuance, official numbering, tax
  inference, QBO writes, customer communication, database migration or backend change.

## Authorities / risk
- OPS-SCHED-CHARGES-001/002: Office Booking Authority still owns prices, final snapshot,
  receipts, version checks, lease, audit and exact retries. QBO owns official accounting.
- Preserve historical empty states and agreed prices; no backfill or new financial authority.
- Summary, Field reconciliation, appointment lifecycle and existing permission gates retained.
- Risk: stale quote/receipt combinations, false paid state, PDF of drafts, lost drafts,
  invisible controls on small screens. Test these with synthetic state and transactions.
- No production customer data writes/notifications in verification.

## Acceptance and gates
- 375 actual work minus 250 recorded payment shows estimated 125 while editing and
  confirmed 125 after saving, with or without any original projection.
- Pending/error/stale quote does not display a collectible balance or enable confirmation.
- Payment-only success says payment recorded, preserves work draft, disappears without hiding errors.
- Catalog articles remain immutable except quantity/removal; search and footer remain usable.
- PDF refreshes authorized data and exports only reconciled final snapshots and recorded receipts.
- Typecheck, full ERP build, charge browser end-to-end, drawer/loading/concurrency regressions,
  PDF rendering and focused financial domain tests; independent review before release.
- Release exact reviewed tree after integration check; verify deployed source and public routes.
- Rollback: restore prior frontend deployment. No schema/runtime changes and no data rollback;
  receipts and work saved while this UI is active survive frontend rollback.

## Evidence
Local verification completed with synthetic data and external network blocked:
- Typecheck and ERP production build (including prebuild acceptance suites): PASS.
- Financial/lease domain tests: 43/43 PASS.
- Balance/PDF acceptance: 10/10 PASS, including the independent review pagination regression.
- Drawer compatibility: 17/17 PASS; finance loading/catalog/permissions/latency/PDF: 44/44 PASS.
- Real components + client transport + Office facade + transactional test database: three
  responsive full flows and the exact no-projection 375/250/125 persistence/PDF case PASS.
- Synthetic 1000-item catalog, 59 entered lines: 15 input samples, median 63.2 ms,
  p95 112 ms to two animation frames; 462.8 ms to ready editor; zero reads/quotes/writes
  while filtering. These are isolated browser measurements, not production latency claims.
- PDF rendered with Poppler: one-page receipt and 16-page long-description fixture;
  extraction retains all 60 concept endings and exact totals. A continuation table overlap
  found independently was corrected and covered by a geometry regression assertion.
- No backend, schema, security-rule, configuration, customer record or communication writes.

Remote CI, independent review, exact-head integration and release evidence are recorded in
PR #591 and `reviews/charges-workspace-balance-20261013.md`. Production checks are read-only;
financial creation/persistence verification is isolated, not executed against real clients.
