# Review: sandbox reports and serialized refresh

## Mode and scope

**Solo Maintainer Adversarial Review**, performed as a separate pass after implementation.
Builder/reviewer: Codex maintainer; this is not an independent review. Scope: complete
report module, changed OAuth/HTTP callers, UI/client, release workflow and documentation.
Authority: QBO books; active ERP admin; FIN-QBO-SANDBOX-READ-001. No operational write
path or permission/rule change. Legacy parity unaffected.

## Findings and corrections

| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Configuration fingerprint from an old grant could survive a new authorization. | New OAuth grants set their own fingerprint; reconnect regression verifies recovery. |
| Medium | Implicit select labels included option text in Chromium's accessible name. | Explicit matching accessible names; desktop/mobile filter-change tests now pass. |
| Medium | Initial release procedure only supported creating an absent Function. | New update path requires the exact previous revision/source/config, validates the new reviewed source pin, and checks all other Functions unchanged. No create-only gate was simply removed without replacement. |
| Low | Next build rewrote generated type/config files unrelated to the feature. | Restored those two files; no compiler/config changes included. |

## Adversarial evidence

- 23 backend tests pass: original OAuth checks plus all three report URLs, authority,
  tenant/input restrictions, exact provider totals, encryption, single refresh under
  concurrency, no refresh replay after timeout/malformed response, explicit reconnect,
  revoked actor after rotation and after report fetch, late completion fencing, retry,
  report rate limit, malformed/mismatched/oversized data and explicit no-data handling.
- Client acceptance passes including preview isolation, same-actor response binding,
  no financial browser persistence, callback proof/redirect/retry regressions.
- Chromium 1280px and 375px pass with real compiled card and transport, synthetic
  network only: unauthorized/unconfigured/ready/authorized/report/filter-change/no-data.
  Screenshots visually inspected; no page errors, unexpected external requests or
  page horizontal overflow.
- ERP typecheck and full Next build including unchanged mandatory prebuild suites pass.
- Firebase validation including syntax and both QBO suites passes. Runtime/release CI
  uses Node 22 and must pass on the pinned final head before merge.
- Full diff/security review: provider account URLs fixed to sandbox, only GET accounting
  requests, sole POST goes to OAuth token endpoint, token never reaches browser/logs,
  fresh role before disclosure, fail-closed stale refresh marker, transaction read-before-
  write order, no accounting totals persisted. Operational bookings/payments untouched.

## Decision and residual limits

Pass for bounded sandbox release once final exact-head CI and reviewed-source check
pass. No unresolved critical/high/medium code finding. The owner has authorized the
sandbox connection deployment and continued this next sandbox development/testing block.
No production-company accounting, financial writes, new secrets/IAM/rules or MCP is authorized.

Actual Intuit reports have NOT yet been fetched by this extension. The owner must compare
all three reports to the sandbox UI after deployment. Real-provider schema/period handling
and expired-access refresh are pending that acceptance. Synthetic tests are not represented
as real-provider evidence. A structure outside the reviewed parser fails explicitly rather
than displaying partial figures. No scheduled keepalive or automatic recovery from an
uncertain refresh; owner reauthorization remains the deliberate fallback.

## Concurrent release boundary

Main advanced from12105b6d to3ab832a0 during this task. Its catalog/finance changes
were merged into this branch; the documentation conflict was resolved by retaining
both rule sections. QBO runtime source still matches reviewed4f1f6b5a.

The controlled appointment-finance release38320718009 failed in its publish job
115047915333, while a separate finance recovery branch is actively being audited.
The public ERP still points to the previously verified QBO release. Consequently this
branch must not publish a combined ERP build until that finance cutover has verified
completion; a normal frontend deployment could activate unrelated finance behavior.
This is a concrete concurrent-production dependency, not a missing owner approval.
Keep the QBO extension reviewable in its PR; do not trigger deployment markers while
this dependency remains unresolved.
