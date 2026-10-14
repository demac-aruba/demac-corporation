# Task: read-only catalog comparison before mapping

## Context and scope

Christian authorized continuation after explaining customer/item reuse on 2026-10-14.
Deep Review: expand the existing designated-owner read boundary to Customer, Item and
Account. Preserve reports, OAuth lease/recovery and confirmed work/receipt behavior.
Provide paginated, explicit catalog reads and provisional ERP comparison. No saved
mapping, customer/item creation, invoice/payment POST, automatic sync, bulk import,
stock effect, new collection, security-rule change or production activation.

## Governance

CRM and services remain ERP canonical identities; QuickBooks owns provider identities
and accounting configuration. FIN-QBO-PRODUCTION-READ-001 is unchanged for reports;
catalog extension is separately disabled by default until a reviewed backend update.
Existing ERP reads/rules apply. Only the designated active owner may access the new
provider route; no private records in logs, audit payloads, fixtures or durable browser storage.
Legacy unchanged. See ../adrs/quickbooks-catalog-20261014.md.

## Acceptance and risks

- Fixed production realm/host, three allowlisted entities, server-generated query;
  bounded pages, include inactive records, validate provider shape and pagination.
- No automatic reads, arbitrary query/host, silent truncation or claims of absence
  from a partial page. Names/SKUs/emails suggest review only, never save mappings.
- Reuse the existing exclusive operation/refresh lease and audit metadata only.
- Deny disabled flags, other roles, revoked identity, stale connection/session and
  malformed provider data; retain original report compatibility.
- Clear private results on input/principal change, error, unmount; prevent double submit.
- Keep original first-install guard intact. Production update/activation and live
  catalog validation remain separately recorded gates, never implied by local tests.

## Verification

Focused provider/HTTP/refresh/race/privacy tests; frontend comparison/client tests;
desktop/mobile synthetic browser flow; typecheck/build; Functions validation; report
and connector regressions; source pins; separate Solo Maintainer Adversarial Review.
No real accounting writes are part of testing. Results recorded in the review.
