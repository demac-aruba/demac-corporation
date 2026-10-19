# Review: explicitly confirmed QuickBooks identity links

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer and implementation author: Codex, separate post-implementation adversarial pass.
This is not independent review. Date: 2026-10-19.

## Scope reviewed

Base `b50b8e80a3cc8fd289662a64829ad35e1d4aa60e`; full staged 24-file implementation,
tests, workflow and authority/documentation diff. Pre-review-record diff SHA-256:
`14c54f3c7c45d400ea9e35b924ea1cd43269cb2e157d94980b2b410c828369ea`.
Callers inspected: comparison page/catalog scan, Firebase session and connection adapters,
canonical ERP customer/service shapes, fixed report reader and shared connection service,
existing report/auth installers and catalog updater, default-deny Firestore rules.
Authorities: `FIN-QBO-LINKS-001`, `FIN-QBO-CATALOG-READ-001`, `FIN-QBO-PRODUCTION-READ-001`.

## Findings

| Severity | Location | Evidence and disposition |
| --- | --- | --- |
| Medium, corrected | Active target claims | Missing/corrupt claim could otherwise be repaired implicitly on reverify. Prepare/confirm now reject it; replay also checks entity/target. Negative tests pass. |
| Medium, corrected | Workflow concurrency | Reusing a workflow-level group could cancel another queued validation. Validation has a separate ref group; only deployment shares the installation lock. |
| Bounded follow-up | Five-minute provider observation | Provider can change between prepare and confirm. Link is identity metadata only; every future financial consumer must revalidate provider/source/config before send. No consumer is enabled here. |
| Bounded follow-up | Intent retention | Expired intents are unusable but retained privately. Review retention before expanding volume; no destructive cleanup is authorized here. |

## Verification

- Combined backend/transitive/release tests: **98/98 PASS**, including **11 new link
  test groups**. Owner/token/origin denial, input bounds, stale source/provider/connection,
  inactive/hierarchy/type restrictions, target/same-source concurrency, exact confirm/revoke
  replay, old-intent non-revival, shared provider lease and corrupt claims covered.
- ERP connection/catalog/link adapter acceptance: **PASS**. Fingerprint contract, identity,
  realm and version validation, UID response race, manual target union and no business data
  persistence in browser storage.
- Isolated real-browser components: **PASS at 1440px and 375px**, StrictMode, synthetic
  records only, all external traffic blocked. Full scroll/search, late-page match, customer
  and item confirmations, mandatory acknowledgement, double-click protection, persisted
  reload, revoke, lost-response recovery, cancellation, identity/unmount and themes.
  Desktop/mobile confirmation screenshots visually inspected; no horizontal overflow.
- `npm run typecheck --prefix apps/erp-next`: **PASS** after restoring only inspected
  Next-generated config changes. `npm run build --prefix apps/erp-next`: **PASS**, including
  every existing prebuild gate. No gate skipped or weakened.
- `npm run validate:firebase --prefix functions`: **PASS**, including prevalidate tests.
  New function/service/HTTP syntax checked; isolated runtime exports only `quickbooksLinks`.
- New release source check and original report pins: **PASS**. Published-source, target,
  runtime, tenant/owner/secrets, denial probes and unchanged-function inventory are deployment
  gates. A differing existing link source cannot be overwritten by this installer.
- `git diff --cached --check`: **PASS**. No dependency, Firestore rule, credential,
  operational bootstrap, invoice/payment or inventory write changed. Rule deployment/
  migration gates are N/A because neither is part of this diff.

## Decision

- [x] Pass with recorded follow-up
- [ ] Block / changes required

No unresolved release-blocking finding in reviewed source. Production deployment and
owner-session acceptance are not claimed by local tests; record their actual outcome in
publication evidence. Synthetic reference transactions exercise application invariants,
not a production Firestore contention load test. Live Isaia Mansur/customer identity,
item matches, AWG/tax/account setup and actual financial/inventory behavior remain unverified.
Owner must choose the real identities; maintainer must verify any future accounting boundary.

The owner's existing merge/deploy authorization and 2026-10-19 continuation cover this
reviewed metadata stage. They do not authorize any accounting send or automatic identity
selection. Merge-only plus the explicit links marker scopes the new backend installation;
production frontend follows verified backend. Existing reader/auth remain untouched.
