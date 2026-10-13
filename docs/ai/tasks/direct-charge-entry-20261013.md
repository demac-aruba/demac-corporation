# Task: direct actual-work catalog entry

## Request and scope

Christian rejected the two starting options, "Registrar trabajos realizados" and
"Usar trabajos agendados". Opening Importes y pagos must immediately offer the
catalog entry row and + Añadir for successive actual services, products and add-ons.
No BTU reconfiguration, planned-work copy or new invoice/accounting authority.

This UI change removes both choices and the unused planned-work seed path. The
first selected catalog item starts the existing recoverable work draft. Opening
the screen alone does not create a dirty draft, finalize work or record a payment.
Search remains mounted, reuses its catalog, clears after selection and retains focus.
It begins below the panel heading and stays visible below the bounded growing list.
Existing final snapshots remain explicitly editable; existing projections remain
viewable and unchanged. All current finance save/review/version/retry guards remain.

## Authority, compatibility and risks

OPS-SCHED-CHARGES-001/002; Office Booking Authority owns operational quotes/finals
and receipts, QBO accounting. No authority, backend, schema, rules, permission,
dependency, migration or customer-data changes. Root AGENTS audit/review applies to
the authorized production release. React review: removed per-render planned seed allocation; no new data fetches.
The open floating picker measures available space inside clipping ancestors and
repositions on resize/scroll; listeners are removed on close/unmount. This keeps
results selectable near the top and below long lists. Catalog and
row identities, accessible input labels and native button keyboard support remain.

Risks to verify: new row/plus visible before entry, sequential services/product/add-on
without extra configuration, repeated search without re-fetch/remount, large-list
search/footer visibility, historical agreed final prices and projection preservation,
and existing payment/final/recovery flows. The old planned-copy browser setup is
replaced by explicit catalog selection, preserving concurrency/Field assertions.
Historical coverage separately verifies untouched estimates and editable agreed finals.

## Acceptance and gates

- No initial two-option choice; first row is within 130 px of the panel top at
  desktop, laptop and mobile widths. Each selection appends a row and resets search.
- No planned lines, financial writes or repeated catalog loads from selection.
- Preserve unknown prices, confirmed-price history, permissions, payments and PDF.
- Focused real component/HTTP/Office browser flow; full drawer interaction suite;
  ERP types and full prebuild/build; independent diff review; exact-head CI/preview.
- Isolated fixture writes only. No customer communications or production CRUD tests.

## Release and rollback

Branch fix/direct-charge-entry in demac-aruba/demac-corporation targets current main.
Standing audited-release authorization applies. Publish reviewed frontend only to
Vercel prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7 / team_DMKv1yhhUjnR4Pu141k3iwuX,
www.demac-aruba.com and apex. Verify source, deployed assets and public routes.
Rollback frontend to dpl_BJBveBv5hcGKFrqpWq2ZbqVWdWHn (ced93209), retaining all
receipts, confirmed finals and recovery copies. No backend deployment or data repair.

## Local validation results

- ERP typecheck and full prebuild/build: PASS. Next-generated configuration changes
  were reverted; no generated files or dependencies are included.
- Drawer browser suite: 60 PASS, including direct entry at 1600/1366/390,
  eight-line scrolling/footer, historical prices, permission/lease fences, error,
  refresh/recovery, balance and PDF paths. Normal clicks only.
- Real component/HTTP/Office facade: 7 PASS, including no original projection,
  three configured services totaling Afl. 375, transfer Afl. 250, final balance
  Afl. 125, persistence, PDF and exactly-once retry behavior.
- Previous/current-client cutover compatibility: 18 PASS.
- Synthetic 1,000-item catalog: maximum 40 rendered matches, 60-line cap, no
  network or authority requests while typing; median input-to-two-frames 80.9 ms,
  p95 208.1 ms under shared local build load. This is not a production benchmark.
- Screenshots inspected for initial entry, open picker and growing list. Independent
  review reproduced and verified the clipped picker correction, including resize.
- No production/customer writes or client communications. Remote exact-head CI,
  preview and post-deployment checks are recorded in the release PR.
