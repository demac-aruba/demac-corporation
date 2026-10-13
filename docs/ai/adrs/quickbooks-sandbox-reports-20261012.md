# ADR: On-demand sandbox reports with serialized credential renewal

- Status: Accepted for the owner-requested sandbox development scope
- Date: 2026-10-12
- Owner: DEMAC / Christian Marquez
- Related: issue #385; FIN-QBO-SANDBOX-READ-001
- Extends: quickbooks-sandbox-handshake-20261012.md (does not replace its identity/security boundaries)

The completed OAuth handshake only verifies identity. It cannot provide reports or
retain access beyond access-token expiry. Extend its existing private record and
function rather than create a ledger, duplicate grant store or second auth boundary.

Only ProfitAndLoss, BalanceSheet and AgedReceivables are accepted, using fixed sandbox
GET URLs. ERP displays provider values and source metadata; it does not reconcile,
recalculate or store official accounting balances. No direct ChatGPT access is added.

A Firestore transaction reserves a 90-second operation lease before token use; reports
and handshakes exclude one another. Refresh uncertainty is persisted before the OAuth
POST. Save the latest returned pair encrypted before the report GET. A stale refresh
marker or failed/unknown exchange requires explicit reauthorization instead of replay.
This trades occasional manual recovery after an outage for protection against losing
rotated credentials. A stale GET-only lease can be reclaimed. A changed grant fences
late responses. Role revocation prevents disclosure without discarding an already
rotated token. The existing pre-extension grant remains readable without migration;
new OAuth/refresh grants additionally bind to the app/configuration fingerprint.

Reports are requested manually and limited to one in-flight request per sandbox,
with a five-second request interval. They remain in browser memory only; server audit
stores actor/report/date/outcome, never amounts or report contents. Response streaming,
structural limits and strict period/basis checks bound memory and prevent silent loss.
No scheduled refresh is added: a sufficiently long period of inactivity or provider
revocation can still require reauthorization.

Alternatives rejected: browser token storage; unconstrained provider proxy; parallel
refresh calls; automatic replay after an uncertain token exchange; partial report
rendering; rebuilding official balances in the ERP. Each crosses a security or
accounting boundary without benefiting this narrow verification phase.

Official references retrieved 2026-10-12:
- https://static.developer.intuit.com/output_html/qbo/docs/develop/authentication-and-authorization/oauth-2.0.html
- https://static.developer.intuit.com/output_html/qbo/docs/workflows/run-reports.html
- https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/ReportService/ReportService.php

These confirm latest-refresh-token persistence, report names, date parameters and
nested Header/Rows/Summary structure. Provider fixtures and actual sandbox comparison
remain separate evidence; synthetic tests do not claim real-provider acceptance.
