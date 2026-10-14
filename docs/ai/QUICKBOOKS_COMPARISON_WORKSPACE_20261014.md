# QuickBooks comparison workspace — 2026-10-14

The owner requested a wide, continuous comparison page because the old embedded view
required page clicks and could hide an existing customer. Fast Product Validation applies:
this is presentation and read orchestration using the existing protected catalog reader.
The owner's existing merge/deploy authorization remains conditional on safe review.

## Behavior

- `/quickbooks/compare/` opens a full-width owner workspace, linked from the existing
  connection page. The existing login return allowlist includes this route.
- One explicit load accumulates all provider pages for customers, items and accounts.
  Queries stay sequential with 5.1 seconds between requests; the server rate/lease gate,
  realm validation and designated-owner authorization are unchanged.
- All ERP rows and unmatched QuickBooks rows are searchable by name, email, SKU or ID.
  Rendering grows by scrolling, without a next-page control or the old 100-ERP-row cap.
  Tabs and filters reuse only the current owner's in-memory observations.
- Products/services show suggested matches, types, SKU, inactive records and ambiguous
  matches. Exact normalized name/email/SKU matching semantics are preserved with indexes.
- Loading, cancellation, limits and partial observations are explicit. Errors clear results;
  identity changes/unmount prevent late results or queued reads from being used.
- No persisted mapping, accounting write, synchronization, schema, backend configuration,
  credential, authorization policy or inventory change is introduced.

## Focused review and verification

- Self-review covered the changed route, UI, caller, matching helper, serial scan, existing
  Firebase adapter and server gate. No actual customer records were put in tests or logs.
- `npm run test:quickbooks-connection --prefix apps/erp-next`: PASS, including 251 ERP
  rows, a match on a later provider page, QBO-only rows, one ERP read per catalog,
  cancellation/stale identity and duplicate-ID/company drift rejection.
- `quickbooks-catalog-browser.cjs`: PASS at 1440 and 375 pixels with synthetic data,
  349 combined rows reachable by scrolling, late match search, ambiguity/inactive filters,
  SKU/type review, cached tabs, double-click protection, cancellation, signed-out and
  unauthorized/disconnected views, error clearing, identity/unmount invalidation and zero
  external traffic. Desktop/mobile screenshots inspected.
- `quickbooks-connection-browser.cjs`: PASS at 1280 and 375 pixels for existing connection
  lifecycle, report forms and errors; no unexpected requests or browser errors.
- Production build: PASS, including `/quickbooks/compare` and existing package build gates.
  Final `npm run typecheck --prefix apps/erp-next`: PASS. Exact-head CI is required before merge.

## Limits and publication

The reported real customer's identity has not been verified in this test environment.
A missing suggestion is not proof of absence, and a suggested match is not a saved link.
The API returns sequential observations rather than an atomic catalog snapshot; a full page
at the existing 100,000-record cap stays partial. Large catalogs require time at the current
server rate limit. Read-only observations are discarded when leaving the page.

Use a `[merge-only]` merge and publish only the reviewed ERP frontend tree; no Functions
release or runtime flag update is needed. Record preview, CI, merge and production IDs in
the pull request. The production route is https://demac-aruba.com/quickbooks/compare/.

### Final theme correction

After PR #602 passed CI and merged, final inspection found that fixed white card surfaces
could conflict with dark-theme text. The in-progress frontend production build was canceled
before completion. The follow-up uses the ERP's existing surface/text/muted theme variables,
and the browser regression now verifies table/name colors and screenshots in both themes
at 1440/375. Both full browser runs passed. This correction changes CSS and synthetic
verification only; the same read-only behavior and source boundaries apply.
