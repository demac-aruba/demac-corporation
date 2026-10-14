# QuickBooks production reports — release evidence, 2026-10-13

PR #593 merged as `0fe88f1e310e0076933703b90c6c4254055c4bb3`; reviewed head
`66bc53a63d1fbd5a5be7a5e137ac1ad6d947f3be`. Both have tree
`fac6566ee1fb38beeeb4be16a89ccfdc6a38ea5b`. All eight pre-merge head workflows passed.
See the task, ADR and Solo Maintainer Adversarial Review dated 2026-10-13.

Production frontend: Vercel `dpl_FmnR5JYGAa7Z4Kj2riNiv8HPVWf7`, READY at the exact
reviewed head, serving https://demac-aruba.com/. Both live QuickBooks disclosures were
compared byte-for-byte with reviewed source. The live connection page correctly requires
an ERP session and shows no financial information when signed out.

Backend installation workflow:
https://github.com/demac-aruba/demac-corporation/actions/runs/38445776873
Deploy job 115464188750 completed successfully at 2026-10-13T18:22:57Z.
New function `quickbooksReports`, revision `quickbooksreports-00001-liy`.
Reports gate enabled; owner/realm verified; published eight-file source verified;
existing functions and authorization metadata unchanged; HTTP denial boundaries passed.
No provider calls, accounting writes, synchronization or secret-payload access occurred
in deployment. Identity remains `quickbooksconnection-00002-vic`; sandbox remains separate.
Do not rerun the initial installer: it deliberately rejects an already existing function.

## Authenticated read comparison — follow-up on 2026-10-13

The owner supplied manual Profit and Loss PDF exports and authorized comparison through
the signed-in ERP. For 2026-09-01 through 2026-09-30, currency AWG, all 33 monetary rows
in Cash and all 33 monetary rows in Accrual matched the corresponding live ERP report.
Comparison normalized only the label prefix "Total for" / "Total"; amounts, ordering and
row count matched. This supersedes the earlier pending first-report status. Private
PDFs, report values and customer data are intentionally not stored in this repository.
This is integration-read evidence, not an accounting audit of the underlying books.

AgedReceivables and AgedPayables also returned rendered reports for cutoff 2026-09-30;
manual figure comparison remains pending. BalanceSheet with the same cutoff and Accrual
was rejected as invalid-report-response and displayed no figures. Its root cause remains
unconfirmed; the generic formatter error cannot identify the rejected field or shape.
No accounting transactions were created, edited or deleted in these checks.

Remaining read acceptance: resolve and retest BalanceSheet, compare the three additional
manual reports, and verify a real expired-access-token renewal with a successful read.
Existing synthetic refresh tests are not that live evidence. See the
[sales/payment design and diagnostic next step](plans/quickbooks-sales-payments-20261013.md).

Current scope: four owner-only read reports, explicit queries and encrypted token refresh.
No ERP-to-QuickBooks sales/payment/expense/inventory synchronization and no ChatGPT/MCP
financial access are enabled. Suspend only the new reports gate if needed; do not delete
the existing authorization or redeploy the original identity installer for recovery.

## Diagnostic change — deployed with catalog reader 2026-10-14

The continuation in PR #597 adds fixed validation classifications to the report formatter
and HTTP error response, plus compatible frontend messages. Tests verify that no provider
values, report amounts or arbitrary classification strings leave the error boundary.
Published in revision `quickbooksreports-00002-gaf` with PR597; Balance Sheet's
actual rejected condition remains unknown. Source pins follow the candidate, while the
initial installer's existing-function rejection remains unchanged. The reviewed update path is complete;
an authenticated diagnostic read is still required. This is not a Balance Sheet fix.
See the [preparation review](reviews/quickbooks-preparation-20261013.md).
