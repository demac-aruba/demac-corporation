# Review: Shared supplier purchase drafts

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer and implementation author: Codex. A separate final adversarial pass followed implementation and browser corrections on 2026-11-09. This is not an independent review.

## Scope reviewed

- Task: `../tasks/supplier-bill-drafts-20261109.md`.
- Diff: feature branch `feature/supplier-bill-costing`, changes after `0982f3a5b98c803094840d743a9aa485f0e8be53` for shared draft persistence. The preceding supplier-cost editor remains covered by its costing tests.
- Inspected all changed/new application, service, transport, validation, test and workflow files; Purchasing caller, shared math declarations, current role-capability map, Functions export and Firestore catch-all deny.
- Authority: proposed private operational staging; existing `services`, stock stores, physical movements, bank accounts and QBO untouched. Rules PUR-DRAFT-001–005 and OPS-CATALOG-001.

## Findings and disposition

| Severity | Evidence and impact | Disposition |
| --- | --- | --- |
| Medium | A fresh operator edit must not replace another operator's version; repeat submissions must not add revisions. | Transactional version check and original-result receipts; simultaneous-save tests passed. Terminal rejection receipts fence old attempts. |
| Medium | Lost response after commit may invite a duplicate invoice; corrupt/unavailable browser recovery must not silently dispatch another command. | Exact command retained before send, replay after reload, verified receipt retirement and fail-closed recovery controls. HTTP 503-after-commit browser scenario recovered version 1 without a second record. Transport tests cover mismatch, lost JSON, storage quota and account change. |
| Medium | Supplier free text is not canonical identity; name aliases defeat normalized-label uniqueness. | Explicit pending catalog linkage and draft-only status. Canonical provider/item links and reviewed duplicate exceptions are prerequisites for promotion/receipt. Not presented as full supplier deduplication. |
| Low | `crypto.randomUUID` was unavailable on the HTTP QA surface. | Replaced with 128-bit cryptographic IDs from `getRandomValues`; observed New invoice flow works. |
| Low | Read-only editor initially prevented return navigation; old conflict text remained after opening current version. | Separate close-blocking from write permissions; clear stale status on successful open. Verified read-only close and fresh version view. |
| Low | A dotted UID could overlap another recovery namespace; test fixture port fallback was invalid without `--port`. | Encode the project/UID tuple; add dotted-UID isolation assertion. Fix fixture argument parsing. |

## Verification

- PASS: `npm run test:supplier-bill-drafts --prefix functions` — 9 tests: server-calculated costs, zero/import exceptions, auth, duplicate claims, concurrent inserts/updates, immutable history, exact retries, corruption blocks, pagination and HTTP policy.
- PASS: `npm run test:supplier-bill-recovery --prefix apps/erp-next` — 5 tests, including real gateway module with mocked fetch/session and actual recovery storage logic.
- PASS: `npm run test:supplier-bill-costing --prefix apps/erp-next` — existing 5 tests unchanged.
- PASS: `npm run typecheck --prefix apps/erp-next`.
- PASS: `npm run validate:firebase --prefix functions`, including its existing QuickBooks sandbox prevalidation tests. No required scripts removed or weakened.
- PASS: `npm run build --prefix apps/erp-next` with existing prebuild checks and static export. The first attempt hit an existing `.next` ENOTEMPTY cache; moved that cache aside, completed the build, then reran the full command successfully after final source changes. Framework-generated tsconfig/next-env edits are reverted as unrelated output.
- PASS: syntax checks for both isolated preview helpers and final diff whitespace.
- Browser: actual React workspace, actual browser transport and actual service/HTTP handler with synthetic transactional store. Save and reopen after refresh; exact recovery after simulated post-commit failure; version conflict preserves local USD 300 while saved USD 250 remains; current revision opens; history shows versions 1 and 2; finance may read but cannot save/create; returning from read-only remains possible. Screenshot contains synthetic data only.
- Reviewed React use: fixed hook order, labeled inputs, fieldset write lock, request in-flight ref, alive checks, independent reads in parallel, domain arithmetic kept outside components. No new UI dependencies.
- Security: fresh server-side profile read for every call/replay, revoked-token check, origin allowlist, input/response bounds, no-store, safe-code logs, no secrets in fixtures. Existing Firestore catch-all denies new staging collections to clients. No rules/access grants/configuration were deployed.

## Decision

- [ ] Pass for production deployment
- [x] Pass with recorded follow-up as a disabled feature-branch proposal
- [ ] Changes required in this draft-only implementation

Residual risk / owner / due: DEMAC engineering, before activation. Synthetic MVCC tests do not establish real Firebase transaction/index behavior, production role compatibility, custom-domain authentication or operational retention policy. Run nonproduction Firebase deployment/smoke verification and approve the proposed storage/access boundary before enabling. Read-model corruption fails at the service or rendering boundary; no automatic repair is provided. Recovery data is same-origin local storage, not encryption against a shared device/XSS. Receipts/revisions grow indefinitely until an explicitly reviewed retention/reconciliation policy exists.

Before subsequent financial use: resolve canonical suppliers/articles; implement receipt through Inventory Authority, actual import closing and explicit capability configuration; verify QBO account/item/vendor mapping and avoid duplicate recognition. No claim that accounting synchronization, live saving or financial approvals are active.

Human approval remains required for deployment/activation, new source-of-record authorization, live role grants, security-rule changes or other actions covered by AGENTS.md. This review authorizes none of those actions.
