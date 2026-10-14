# Review: catalog comparison candidate

## Mode and scope

Solo Maintainer Adversarial Review, separate from implementation; not an independent
review. Builder/reviewer: Codex. This record is technical evidence, not production
approval. Reviewed the complete catalog continuation diff against merge base `ad1a9ac`,
including shared report/OAuth callers, HTTP authorization, frontend session transport,
ERP CRM/catalog read authorities, connection page, source package and CI. Incorporated
main `4c982ca` (#599), preserving actual-work editable descriptions.

Authorities: CRM/services in ERP, accounting and provider catalog in QuickBooks;
FIN-QBO-PRODUCTION-READ-001 and candidate FIN-QBO-CATALOG-READ-001. No persistent
mapping, alternative customer identity, financial/stock write or rule change exists.

## Findings and corrections

| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | New upstream editable descriptions were absent from the earlier QBO appointment projection. | Preserve a separately validated description beside the canonical article label; regression keeps article ID, label and amounts unchanged. |
| Medium | Async catalog delivery must be bound to current principal as well as component lifetime. | Generation and actor checks gate ERP follow-up reads and rendering; parent is also keyed to UID/connection. Browser transitions wait for committed identity changes before releasing old responses. |
| Medium | A partial catalog page cannot establish missing entities or unique identity. | Explicit page scope, full-page continuation/upper-bound warning, inactive candidates visible; no creation/approval button or saved mapping. |
| Low | Rendering every ERP row can overwhelm the browser. | Memoize comparison; show the first 100 filtered ERP rows with explicit count/search. No hidden declaration of catalog completeness. |
| Test fixture | Mutating the shared synthetic customer contaminated later tests. | Clone each generated provider page; retain all negative assertions. |

Reviewed lease contention, token rotation before reads, role revocation, connection
replacement, stale UI, paging/type checks, no-store behavior and provider-text privacy.
Catalog queries use a literal host/realm, enum entity and integer position only. Audit
stores action/page metadata, not names, emails, amounts or returned records. OAuth token
maintenance remains the existing encrypted transport state; no accounting POST exists.

## Verification

- Catalog/report/release suites: 24 tests PASS (7 new catalog, 14 report, 3 release).
- Connector/sandbox/source regressions: 44 tests PASS.
- ERP production entry + catalog acceptance: PASS, including invalid response shapes,
  wrong company/page, session change, disabled backend, provisional matching, privacy.
- Appointment preview/diagnostic model: 19 checks PASS, including description parity.
- TypeScript: PASS. Full local production build + prebuild: PASS; final minor UI/description
  changes then passed focused types/model/browser checks. Published head must also build.
- Functions `validate:firebase`: PASS; source-pinned package check: PASS.
- New catalog browser: PASS at 1280/375, double submit, ambiguity/inactive data, partial
  pages, page changes, errors clearing results, identity/unmount invalidation and overflow.
  Desktop/mobile screenshots inspected. Tables scroll within their region on mobile.
- Existing connection/report browser: PASS at 1280/375; no automatic catalog request,
  unauthorized access, auth/revocation/retry/report states preserved; zero external calls.
- Existing appointment preview browser: 8 cases PASS.
- Actual charge-service browser: all 7 flows PASS, including 375/250/125, unchanged
  synthetic database after preview, edit/recovery/conflict, and uncertain cash replay.
- Whitespace checks: PASS. CI retains the new browser gate; none is weakened/waived.

Local browser download from Playwright CDN returned truncated archives. The same tests
ran using isolated Chromium 153.0.0 packaged by `@sparticuz/chromium`; CI still uses
Playwright's pinned Chromium. No dependency was added to the ERP runtime.

## Decision and residual work

PASS for publishing the draft candidate, subject to exact-head CI/preview build results.
No production merge or deployment performed. Live catalog reads NOT run; provider
shape/order support remains a real-company acceptance gate. The existing first-install
guard remains intact; the catalog flag is absent/disabled in production.

Engineering next step: review and verify an update path for the existing dedicated
function (old source, revision, owner, secrets references, unchanged other functions,
failure recovery), then activate only catalog reads. Persistent mapping approval,
tax/payment accounts, historical reconciliation/cutoff and the future Sandbox invoice/
partial-payment cases are still pending. Balance Sheet diagnostics remain undeployed.
Nothing here enables financial writes or exports records to ChatGPT/MCP.
