# Task: Owner-only real QuickBooks reports

## Context and governance

Owner asked to continue after the real DEMAC authorization was confirmed in the supplied
screenshot, 2026-10-13 13:45:37 Aruba time. Country AW is CompanyInfo data, not proof of
subscription edition. Existing merge/deploy permission persists, with no accounting writes.
Deep Review applies because this exposes real financial data and renews encrypted access.
Authority: QuickBooks accounting books; Firebase identity and designated owner; existing
integrationPrivate/quickbooksProduction authorization record and audit. Rule
FIN-QBO-PRODUCTION-READ-001. No new accounting source, rules, IAM roles or collections.

## Scope

- Separate quickbooksReports HTTP function; preserve exact published authorization code.
- Four fixed production GET reports, owner-only, no-store, explicitly requested from UI.
- Shared operation lease blocks OAuth/revocation races; 90s lease exceeds 60s runtime.
- Latest refresh token saved encrypted before financial GET; uncertainty fails closed.
- UI dates, original currency/basis, data/empty/error states; clear status feedback and
  expired confirmation errors. No reads on mount, no silent truncation or local persistence.
- Update existing internal disclosures outside public menus.

## Acceptance / verification

- Exact owner and current role; wrong realm/app, unauthenticated or revoked users denied.
- Allowlisted paths and parameters only; four GETs cannot create transactions.
- Concurrency, expired/uncertain credentials, revoked role in flight, late responses tested.
- Existing sandbox and authorization regression gates preserved.
- Browser and transport tests; ERP typecheck/build; functions validation; deployment pins.
- Fresh Solo Maintainer Adversarial Review recorded separately.
- Deployment verifies source, existing functions/authorization unchanged and HTTP denials.
- First actual report requires the owner's authenticated ERP session; synthetic tests
  must not be presented as verification of DEMAC's financial figures.

## Recovery

Suspend only QBO_PRODUCTION_REPORTS_ENABLED on the new function to stop report access.
Do not delete the existing authorization record or replay original installer/activation.
Frontend rollback must preserve unrelated current ERP work. Ambiguous refresh requires
explicit owner reauthorization through the existing connector. No migrations.
