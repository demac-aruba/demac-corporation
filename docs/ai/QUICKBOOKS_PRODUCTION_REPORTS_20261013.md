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

Next owner action: open https://demac-aruba.com/quickbooks/connect/ while signed into DEMAC,
scroll to **Informes reales · solo lectura**, select **Ingresos y gastos · Profit and Loss**,
choose dates and basis, and click **Consultar informe real**. Compare the result directly
with QuickBooks for the same dates, currency and basis. This first authenticated real
report remains PENDING; synthetic tests and unauthenticated release probes do not verify
DEMAC's financial figures. The cloud browser used for the public check was signed out.

Current scope: four owner-only read reports, explicit queries and encrypted token refresh.
No ERP-to-QuickBooks sales/payment/expense/inventory synchronization and no ChatGPT/MCP
financial access are enabled. Suspend only the new reports gate if needed; do not delete
the existing authorization or redeploy the original identity installer for recovery.
