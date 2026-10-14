# QuickBooks catalog read stage: publication evidence

PR597 merged as `3b4da611164439b841a6bc909b36069b3de4f686`.
Reviewed head `f511d905d9afaf342fd357bcb6e5856f0d264b36` and merge have the
same verified tree `27b1cea7619765616f52cf68dcc5f8508e84ceca`.
All nine exact-head workflows passed before merge, including catalog desktop/mobile
and actual appointment/payment flows. Main reader workflow38572793300 completed
successfully; update job115882676910 completed at2026-10-14T13:37:43Z.

## Installed reader

`quickbooksReports` is now `quickbooksreports-00002-gaf`, catalog flag enabled.
Exact installed source, successful operation provenance, ACTIVE serving revision,
100% traffic, unchanged IAM and all other runtime configuration were verified. Other
functions were unchanged. Anonymous report/catalog access and foreign origins were
rejected. Only source and the explicit catalog environment flag were patched.

CI made no Intuit requests, accounting writes, customer reads or secret-payload reads.
No persistent mapping, customer/item creation, invoice/payment sync, tax/account
mapping, historical import or inventory write was added. Normal authorized reads retain
the existing encrypted OAuth refresh/lease/audit behavior.

Immutable baseline/candidate archives were retained privately and verified by hash,
roundtrip extraction and anonymous denial. The complete safe deployment summary is
[releases/quickbooks-catalog-update-20261014.json](releases/quickbooks-catalog-update-20261014.json).
Artifact11898314211 ZIP SHA256:
`0e4ae7b8f4b25a80f4e6844c188f78d90abee29789a511d6a32a7b56b26a894a`.
Downloaded artifact digest and complete-stage flags verified before committing it.
The initial installer still refuses an existing function. Deliberate rollback needs
a reviewed patch using retained baseline and fresh environment; no rollback happened.

## Frontend

Production deployment `dpl_FBfeq8nhFRjtaQewskyewhzoG65a` is READY, rebuilt with
production configuration from reviewed f511d90 (identical merged tree).
Canonical aliases verified: `demac-aruba.com`, `www.demac-aruba.com`.
https://demac-aruba.com/quickbooks/connect/ returned HTTP200.
No error/fatal Vercel runtime log groups were returned for this deployment in the
initial10-minute inspection. This is route/build evidence, not signed-in data testing.
Previous production frontend was `dpl_ABGUwWMkkyFq6xAZdS6wkjDeoGmk`.
The merge used `[merge-only] [update-qbo-catalog]`; operational functions were not
redeployed. Only this frontend was explicitly rebuilt for production.

## Remaining business acceptance

The designated owner must refresh the canonical connection page, open
“Preparar emparejamiento”, choose “Clientes” and click “Consultar para comparar”.
Then verify company and known customer identities; repeat for “Productos y servicios”
and “Cuentas contables”, paging as necessary. No real catalog response was read by
Codex during this release, and matching suggestions do not create or approve links.

Future phases remain explicit: reviewed persistent mappings; accounts/taxes/currencies;
historical cutoff and reconciliation; Sandbox service invoice and partial-payment
retry tests; controlled approved production write pilot. Report diagnostics are now
installed, but Balance Sheet cause/response and A/R/A/P manual comparison remain
pending. Existing Cash/Accrual comparisons are historical evidence, not a new run.
