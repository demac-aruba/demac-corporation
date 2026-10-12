# Review: first QuickBooks sandbox authorization

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer and implementation author: Codex, separate implementation and adversarial passes.
This is not an independent review or owner approval to deploy.

## Scope reviewed

- Request: continue the Intuit development setup for DEMAC ERP; first verify the sandbox.
- Diff: feature/quickbooks-sandbox-connection, based on main `0dc09f3167150ed775018a6f257542961b21cddf`.
- Full provider service/HTTP/export, client transport/session callers, UI, tests, scripts,
  proposed ADR/runbook and existing Firestore rules reviewed. No production connection exists.
- Authority: existing users profiles, privileged Functions boundary, QBO accounting source of
  record; SECURITY_RULES 1–10. No changes to operational charges/receipts or historical books.

## Findings and corrections

| Severity | Location | Evidence / impact | Correction |
| --- | --- | --- | --- |
| High, corrected during implementation | CompanyInfo verification | Intuit entity `Id` may be `1`; comparing it to realm would reject legitimate companies. | Tenant identity enforced by exact callback realm and fixed realm-scoped sandbox API; official SDK fixture checked and regression uses `Id: 1`. |
| Medium, corrected in review | Stored token expiry | Calculating expiry after CompanyInfo would overstate lifetime by provider latency. | Capture expiry immediately after token exchange; delayed CompanyInfo regression decrypts synthetic envelope and checks lifetime. |
| Medium, corrected during implementation | UI failure recovery | A cancelled callback on first page load left no configured status, disabling restart. | Fetch safe status after callback error so an administrator can start again. |
| Low, corrected in visual review | New card typography | Nested details inherited larger base typography while controls inherited tiny provider-card text. | Scoped styles, readable details, wrapped layout and 44px control height. |

No unresolved material code finding in this setup-only scope. Release remains gated below.

## Verification

- `npm run validate:firebase --prefix functions`: syntax gate plus 12 focused backend tests;
  focused tests also executed on Node 22, matching the Function runtime.
- `npm run typecheck --prefix apps/erp-next`: passed.
- `npm run test:quickbooks-sandbox --prefix apps/erp-next`: passed browser transport
  acceptance: off/isolated flags, proof hash, completion deduplication, lost-response retry,
  cancellation, missing browser proof, account switch and redirect destination guard.
- `npm run build --prefix apps/erp-next`: passed including all existing mandatory prebuild
  suites and the added QuickBooks acceptance suite. Generated Next config changes excluded.
- `quickbooks-sandbox-browser.cjs`: real component and client in Chromium, synthetic
  authorization/data transport; 1280px and 375px, unconfigured/ready/verified/unauthorized,
  no overflow, no page errors, all external network intercepted or blocked. Screenshots
  inspected. This is local component evidence, not a published authenticated preview.
- Firebase v2 export loads with installed lockfile dependencies without fetching secrets
  or contacting Intuit. No dependency/lockfile changes.
- Backend negative cases: missing/revoked Firebase session, missing/inactive/finance profile,
  wrong origin/content type/method, disabled config, wrong realm, array-valued query,
  cancellation, wrong proof/actor/ticket, changed config, expired/replayed/superseded state,
  concurrent claims, late failed provider response, malformed provider data, identity failure,
  AES-GCM nonce/authentication, no secrets in safe projections/audits, idempotent finish.
- Concurrency tests serialize conflicting synthetic transactions and enforce reads-before-
  writes. They do not claim a live Firestore or provider concurrency experiment.
- Existing rules end in deny-all; no broader rule matches `integrationPrivate` or its audit
  subcollection. Rules are unchanged; emulator rule-change gate is N/A for this source diff.
- Diff/whitespace and documentation links checked; no credentials or unrelated edits.

## Decision

- [ ] Pass for release
- [x] Prepared code with recorded follow-up; keep as draft until activation evidence
- [ ] Unresolved code correction required

Owner / integration maintainer must complete these **before activation**: confirm exact
sandbox ID, securely provision development secrets and encryption key, approve scoped
deployment, inspect deployed preview/live function routing, verify actual Intuit consent
and returned sandbox identity, and verify production-origin CORS and restricted callback
logging. No live financial or historical data has been read or written in this review.

Residual scope limits: no refresh, revocation UI, automatic grant cleanup, MCP or accounting
sync. Verification status is historical, not continuous health. The broad Intuit accounting
scope must not be mistaken for a provider-enforced read-only permission. These capabilities
need separate reviewed work before financial use. Follow-up is due before expanding the
setup-only scope; owner: DEMAC integration maintainer / business owner.

Human approval is still required by `AGENTS.md` before credential/secret changes and
production deployment. Neither this self-review nor passing tests grants that authority.

## Approved sandbox release addendum — 12 October 2026

The owner explicitly approved merge and deployment at 18:14 Aruba time, conditioned on
preserving real customer data and making no accounting changes in QuickBooks. Screenshots
confirm the three named secrets were created in `demac-corporation`; values were not read.
The prior paragraph records the original review state, not an outstanding approval request.

A separate release pass verified the reviewed service still calls only the OAuth token
endpoint and sandbox CompanyInfo GET. Writes stay in the private connection/audit record.
The actual ERP domain maps to `demac-corporation-web`. Its published frontend tree equals
the baseline frontend tree, so this release retains the published payment/booking UI.
GitHub ERP CI, legacy validation and both Vercel preview builds passed for the original head.

The added release workflow uses pinned actions, tests before cloud authentication, and a
temporary package exporting only `quickbooksSandbox`. It requires the reviewed source,
current main, existing enabled secret versions, and an absent target Function. Deployment
selects only that Function. It verifies published source, sandbox settings, secret versions,
unchanged existing Function revisions, rejected anonymous requests, CORS and invalid callback.
The merge uses `[merge-only]` to suppress existing unrelated deployment jobs while leaving
their validation gates running, plus `[deploy-qbo-sandbox]` to select this authorized release.
No secret values, customer records or accounting APIs are read by the release workflow.

The 12 backend tests passed again. Release script syntax and reviewed-source checks passed.
Actual OAuth consent and company-name confirmation remain an owner browser step after the
deployment; do not describe the company as connected before that step succeeds.
