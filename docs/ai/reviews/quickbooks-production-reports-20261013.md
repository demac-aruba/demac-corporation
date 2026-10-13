# Review: Owner-only real QuickBooks reports

## Review mode

- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Reviewer and implementation author: Codex maintainer, separate passes on 2026-10-13.
This is an adversarial self-review, not an independent review. Review began after the
initial implementation and challenged the complete change plus existing OAuth callers.

## Scope reviewed

Branch feature/quickbooks-production-reports-20261013, based on f4c519ff146a95555365f40427c9b957e6597259.
Reviewed new entry, HTTP/auth boundary, report/refresh service, formatter, isolated release
script/workflow, UI/transport, existing connection start/callback/finish/disconnect,
test harnesses, disclosures, task/ADR and FIN-QBO-PRODUCTION-READ-001. QuickBooks remains
the accounting authority; the existing private integration document remains credential
authority. No rules, operational financial records or source-of-truth replacement.

## Findings and corrections

| Severity | Location | Evidence / correction |
| --- | --- | --- |
| Medium, closed | Report formatter | Intuit A/P documentation omits row.type and sometimes ReportBasis. Accept the documented shapes with full structural validation; show missing basis explicitly. Negative/positive tests pass. |
| Low, closed | Connection feedback | An expired tab proof could appear to confirm by silently reading status. It now fails explicitly, refreshes pending-button state and displays recovery guidance. A new status request clears its old success time. |
| Low, closed | Report selectors | Wrapped labels included option text in their accessible names. Explicit names now support deterministic keyboard/accessibility targeting; desktop/mobile tests pass. |

## Adversarial conclusions

- ID tokens are checked for revocation, exact owner and fresh active role are enforced
  server-side before lease, before provider read and before response. Other admins are denied.
- Client controls cannot choose tenant, provider host, arbitrary paths or accounting entities.
  Four fixed GETs and OAuth refresh are the only outgoing operations in the new service.
- Existing identity code remains byte-identical. Its shared operation lease prevents
  start/disconnect overlap; incomplete OAuth attempts prevent finish/report races.
- Refresh uncertainty is persisted before the call; latest tokens are encrypted before
  report GET. Role loss retains rotated credentials but denies financial delivery. A killed
  or ambiguous refresh requires explicit reconnection; no automatic replay of stale tokens.
- Reads have bounded bytes/time/rows/depth. Schema, dates, currency and basis are checked;
  no silent truncation. Amount strings are projected without recalculating financial truth.
- Report values remain in memory/response, never audit/storage/logs. Audit contains only
  request metadata and safe outcomes. No report is requested on mount or during deployment.
- Release is initial-install only, exact main/source-pinned, isolated eight-file package.
  Existing function revisions and authorization metadata are compared before/after; public
  probes carry no credentials. A partial deploy must be investigated, not blindly rerun.

## Verification

- 75 focused backend/release regression tests: PASS (sandbox, identity, reports,
  refresh/recovery, deployment source/config/probes, existing installation/activation).
- Functions validate:firebase and unchanged identity source guards: PASS.
- ERP typecheck and production connection/report transport acceptance: PASS.
- ERP production build including mandatory prebuild acceptance suites: PASS.
- Playwright synthetic UI at 1280px and 375px: PASS, four report forms, no automatic
  report requests, empty/error/filter clearing, status feedback, expired proof,
  consent/revocation/login/role states; zero unexpected requests or browser errors.
- Desktop/mobile screenshots visually inspected: readable layout, no page overflow.
- All test values are synthetic. No real report or accounting mutation was made.
- Applicable remote CI must be green before publication/merge; source and runtime
  verification must complete before the feature is reported as deployed.

## Decision and remaining validation

- [x] Pass with recorded follow-up

No material unresolved code finding. Owner must run the first authenticated real report
and compare identical dates/basis/currency in QuickBooks before relying on figures or
authorizing any future synchronization. A live provider shape may be rejected safely and
require a focused compatibility correction. Current runtime identity is inherited, not
dedicated IAM isolation. Refresh/network uncertainty intentionally requires reconnection.
Maintainer owns deployment evidence; owner/maintainer own first-report verification now.
Existing explicit human merge/deploy approval applies to this continued read-only phase;
it does not authorize accounting writes or automatic AI access.
