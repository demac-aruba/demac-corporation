# Task: explicitly confirmed ERP–QuickBooks identity links

## Context and scope

Owner requested continuation of customer/item comparison and confirmation on 2026-10-19.
Base: `b50b8e80a3cc8fd289662a64829ad35e1d4aa60e`. Deep Review applies because
versioned integration metadata may later be consumed by financial preparation.

Implement owner-only prepare/confirm/list/revoke for existing Customer and Item identities,
plus review UI in the current comparison page. A dedicated `quickbooksLinks` boundary
reuses the unchanged catalog reader, designated-owner authorization and shared OAuth lease.
Store only private integration references, fingerprints, versions and actor/time audit under
`integrationPrivate/quickbooksProduction`. Canonical clients/services remain unchanged.

No accounting POST, invoice/payment/expense sync, inventory changes, customer/item
creation, implicit match acceptance, migration, new credentials or Firestore rule changes.
Existing reports and authorization functions are not redeployed.

## Authority and acceptance

- `FIN-QBO-CATALOG-READ-001`, `FIN-QBO-PRODUCTION-READ-001`; additive identity-link rule
  `FIN-QBO-LINKS-001`. This is coordination metadata, not customer/catalog/accounting truth.
- Explicit owner reviews a fresh provider page and canonical ERP identity, then confirms.
- One active link per ERP identity and per provider identity within entity/realm/environment.
- Changed source, incompatible/inactive records, stale version, expired preparation,
  revoked owner, disconnected/replaced connection and conflicting target fail closed.
- Duplicate confirmation/revocation or lost response cannot create another version/link.
- Revocation retains history; another target requires explicit revocation first.
- List requests are bounded to 100 ERP IDs; frontend reuses observations and isolates sessions.
- A confirmed link does not authorize a financial send; future sends must revalidate live
  provider state, source, currency, tax, account configuration and mapping version.

## Verification and publication

Backend adversarial tests for authorization, concurrency, replay, source/connection drift,
privacy and provider GET-only traffic; browser review/confirm/revoke/recovery tests on desktop
and mobile; existing reader/connection tests; ERP typecheck/build; Functions syntax; source
and deployment guards. Separate Solo Maintainer Adversarial Review before merge.

Owner's existing merge/deploy authorization applies after review. Publish only a reviewed
new function and frontend; preserve installed functions/configuration and record recovery.
Actual ambiguous customer identities require owner decision in the UI, never AI inference.
