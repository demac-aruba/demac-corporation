# Review: read-only QuickBooks preparation and safe diagnostics

## Review mode

- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Builder and reviewer: Codex, separate implementation and adversarial passes. This is
not an independent review. The root AGENTS.md permits this mode. Scope continues the
owner's approved integration work while retaining the prohibition on accounting writes.

## Scope and authorities

Reviewed the complete continuation diff after design commit `4212f49`, including its
direct callers: AppointmentChargesWorkspace, authenticated Office Booking read, source
record/evidence contract, booking focus owner, report client/formatter/HTTP handler,
source-pinned installer, browser fixtures and CI. Latest main checked: `f4369f3`.

Rules: OPS-SCHED-CHARGES-001/002 and FIN-QBO-PRODUCTION-READ-001. Booking/Pricing/Field
remain the source of operational work and receipts; QBO remains accounting authority.
The preview creates no invoice number, accounting balance, mapping or stored integration
record. `canSend` is always false and there is no provider payload or send action.
The only data request is the existing authorized appointment read, on explicit click.
No auth, Firestore rules, credential, token-scope or provider-write boundary changed.

## Adversarial findings and corrections

| Severity | Finding and impact | Correction / evidence |
| --- | --- | --- |
| Medium | Removing a native dialog without closing it lost keyboard focus. | Call native close before removal; desktop/mobile tests assert focus returns to the trigger and Escape leaves the parent appointment open. |
| Low | A malformed Field evidence envelope could throw instead of explaining the blocker. | Validate envelope before fingerprint comparison; malformed evidence yields no figures. |
| Medium | Existing browser fixtures omitted the newly consumed session-read export, preventing bundling. | Extend the synthetic identity contract using exactly each fixture's existing principal. Actual charge-service browser suite passes. Initial CI exposed another transitive consumer in coworker support; all remaining synthetic session stubs now export the same read contract. Nine additional fixtures pass syntax checks, with assertions/network guards byte-for-byte preserved. Full CI must pass before production merge. |
| Follow-up | Production Balance Sheet still fails a generic validator condition. | Add fixed diagnostic classifications and privacy tests; do not guess the condition or weaken report checks. Backend update and real read remain pending. |

No unresolved finding blocks publishing this read-only frontend candidate. No existing
gate or assertion was removed or weakened; CI gains a dedicated preview browser step.
The first published candidate `6af8763` built successfully on Vercel and its protected
`/scheduling/` route returned HTTP 200. Its coworker support CI failed on the missing
fixture export above, so that run is not considered a passing release gate. The follow-up
fixture commit requires a fresh CI run; current evidence is tracked on PR #597.

## Concurrent main integration

Main advanced to `3a1578dd5ade78da0c409ceb0a6666f864ad3316` (PR #598) during
publication. It was merged into this candidate, preserving the reviewed direct catalog
entry, picker placement, removed planned-work seed prop and updated caller/fixture
signatures. The QBO preview import/footer, fresh source read and synthetic identity
exports remain intact. No merge conflict required manual resolution. The existing
[direct-entry review](direct-charge-entry-20261013.md) covers those upstream changes;
this is not a new review claim for their original implementation. Re-run the combined
preview/model/types and full charge/drawer browser cases and publish a new exact-head
preview. Record their final outcome and CI/deployment links on PR #597 before delivery.

## Verification

- `npm run validate:firebase --prefix functions`: PASS.
- `npm run typecheck --prefix apps/erp-next`: PASS.
- `npm run build --prefix apps/erp-next`: PASS, including all existing prebuild gates.
  Final evidence-envelope/focus corrections were additionally checked by the model,
  browser and type checks; the exact published candidate receives its own Vercel build.
- `npm run test:quickbooks-preparation --prefix apps/erp-next`: 18 checks PASS.
- `node --test functions/quickbooksReports.test.js`: 14 tests PASS, including 15
  malformed provider fixtures, safe classification and unauthorized/no-provider-call cases.
- `node --test functions/quickbooksConnection.test.js functions/quickbooksSandbox.test.js
  functions/quickbooksSandboxReports.test.js scripts/quickbooks-reports-release.test.cjs`:
  47 tests PASS.
- `node scripts/quickbooks-reports-release.cjs --check`: PASS. Original identity source
  pins remain valid; report pins reflect this candidate. Existing-function rejection remains.
- Isolated `quickbooks-preparation-browser.cjs`: 8 cases PASS at desktop/mobile widths,
  session/appointment/version changes, double clicks, late responses, guarded errors,
  reconciliation blockers and keyboard focus. Screenshots visually inspected.
- Isolated `appointment-charges-browser.cjs`: PASS on all seven flows, including the
  actual Office facade and transaction test double. The confirmed work/receipt example
  also opens the QBO preview and asserts the entire synthetic database is unchanged.
- Isolated `appointment-charges-loading-browser.cjs`: 56 cases PASS, plus retained
  timing evidence, with the real drawer/read hook. No external requests allowed.
- Whitespace and local documentation link checks: PASS before candidate publication.

Browser evidence is synthetic. No real financial rows, customer information, tokens or
credentials are committed. These tests do not constitute S01-S21 Sandbox write acceptance
or a live accounting audit. Report values and arbitrary provider strings cannot enter
the added diagnostics. Refresh/authentication behavior retains the existing coverage.

## Decision and release boundary

- [x] Pass with recorded follow-up for frontend preview
- [ ] Production accounting synchronization approved

The frontend works with the currently deployed report backend; absence of a diagnostic
subcode preserves the existing message. Candidate backend diagnostics are not installed.
Do not rerun the initial-only installer; develop a reviewed, source/revision-checked
update path before a live diagnostic query. Balance Sheet root cause, manual A/R/A/P/
Balance Sheet comparisons and real expired-token renewal remain open.

Further business preparation needs actual customer/item/tax/account mappings and cutoff
review, followed by Sandbox tests. No historical synchronization, expense/inventory write
or ChatGPT/MCP financial access is activated. Owner: DEMAC integration maintainer;
due before production write activation. Frontend rollback is the prior deployment;
there is no migration or new persisted preview state to reverse.

See [task](../tasks/quickbooks-preparation-20261013.md),
[pilot design](../plans/quickbooks-sales-payments-20261013.md) and
[live read evidence](../QUICKBOOKS_PRODUCTION_REPORTS_20261013.md).
