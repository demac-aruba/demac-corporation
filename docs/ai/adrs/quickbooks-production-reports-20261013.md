# ADR: Production read-only reporting beside the identity connector

- Status: Accepted for owner-authorized read-only phase
- Date: 2026-10-13
- Owners: DEMAC owner / ERP maintainer
- Rule: FIN-QBO-PRODUCTION-READ-001

## Decision

Add a separate, bounded quickbooksReports function using the exact existing encrypted
production authorization record, owner checks and config fingerprint. Do not redeploy the
authorization connector or operational functions. It accepts only four named reports and
uses fixed production GET endpoints, with token refresh as the only OAuth POST.

Reuse the original `operation` lease so existing start/disconnect commands block while
a report or refresh is running. Reports reject incomplete OAuth attempts, so a pending
finish cannot race a report. Record `reportRecoveryDigest` before refresh. Uncertain
refresh blocks only the affected encrypted credential version; a completed fresh owner
authorization replaces the credential envelope and recovers through the unchanged
connector. Save rotated tokens even after role loss, but revalidate role before GET and
before delivering data. Do not reuse old credentials automatically after an uncertain call.

Reports exist only in memory and the HTTP response. Audit stores operation metadata,
never report rows/amounts/tokens. UI requests occur only on explicit submit and clear
old results when parameters change or a request fails. Report currency is never inferred
from Aruba. Strict validation rejects mismatched dates/basis and malformed/oversized data.

## Alternatives / tradeoffs

Updating the identity connector would increase release scope and require replacing its
reviewed source. A separate credential store would create competing refresh/revocation
authorities. Neither is needed. A separate function adds a runtime but shares the single
lease/credential authority. It inherits the existing runtime identity; dedicated IAM
isolation remains outside scope. The report formatter intentionally mirrors the tested
sandbox projection without coupling its runtime or release package to sandbox credentials.

## Rollout

Deploy reviewed UI/disclosures first, then install only the new report function. The
installer pins source hashes and the existing identity revision, checks owner and metadata,
and compares other functions before/after. It never reads secret payloads or calls Intuit.
Existing CI source guards remain valid. An initial authenticated report must still be
checked by the owner against QuickBooks for identical dates, currency and accounting basis.
Disable the reports runtime flag to suspend this new capability without revoking identity.

## References checked 2026-10-13

- https://developer.intuit.com/app/developer/qbo/docs/workflows/run-reports
- https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/apagingsummary
Official Intuit pages inspected in browser after search returned only their loading shell.
