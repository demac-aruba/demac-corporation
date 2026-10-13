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
Pending implementation and verification; final results belong in the review record and PR.
