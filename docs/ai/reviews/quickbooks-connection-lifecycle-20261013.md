# Review: QuickBooks connection entry points and disabled lifecycle

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / agent: Codex, separate adversarial pass.
Implementation author / agent: Codex.

## Scope reviewed

- Request: implement the four missing Intuit App details URLs, with safe connection
  and disconnection behavior and no accounting changes.
- Base: `9b7419f2ba31d6fdb7265c99e84dd65fe1b31673`.
- Branch: `feature/quickbooks-connection-lifecycle-20261013`.
- Reviewed complete implementation and affected login, integrations, Firebase auth,
  provider credential storage, HTTP entry points, tests, workflow and rollout docs.
- Existing authority: Firebase Auth plus active ERP user profile for identity;
  `integrationPrivate` for encrypted integration metadata. No new business authority.
- `FIN-QBO-SANDBOX-READ-001`, sandbox behavior, Firestore rules, operational Functions
  index, customer collections and accounting state remain unchanged.

## Findings

All implementation findings below were corrected before this record was finalized.

| Severity | Location | Evidence and impact | Correction |
| --- | --- | --- | --- |
| Medium | OAuth callback | Owner access could change during token exchange. | Recheck active designated owner after durable token storage and before CompanyInfo; recheck transactionally before finalization. |
| Medium | Disconnect recovery | A confirmed revoke with an empty queue could be stranded if final database cleanup failed. | Permit explicit retry to finish local cleanup without a second provider revoke; regression added. |
| Medium | Revocation response | Generic successful HTTP responses could overstate confirmation. | Only HTTP 200 confirms revocation; uncertain responses retain encrypted retry state. |
| Medium | Disconnect UI | A checked confirmation could survive a status change to a new connection. | Clear confirmation on reload/actions and retain server-side version matching. |
| Low | Launch login return | The private launch URL could lose its destination after login. | Add exactly `/integrations/` to the super-admin-only allowlist; reject arbitrary destinations. |
| Low | Build verification | Old generated output initially obscured whether the new exported pages existed. | Remove generated `.next`/`out`, run the full clean build and inspect both actual HTML files. Restore Next-generated source configuration edits. |
| Low | New CI installation | GitHub's clean runner rejected `npm ci` because ERP Next has no committed lockfile. | Match the existing ERP pipeline's `npm install` while preserving every test, typecheck and build gate. Re-run checks on the corrected SHA. |

## Verification

- New lifecycle and existing sandbox Node tests: **44/44 passed** (21 new, 23 existing).
- Firebase validation and syntax for all three new backend modules: passed.
- ERP typecheck and new frontend acceptance: passed.
- Clean ERP production build: all ten prebuild acceptance gates, Next build/typecheck
  and static export passed. Actual connect/disconnect HTML exists with `noindex`,
  `nofollow`, `nocache` and `no-referrer`; neither URL is in the public sitemap/menu.
- Browser acceptance: **1280px and 375px passed**, no errors, overflow or unexpected
  network requests. Auth and provider responses were synthetic; non-loopback traffic
  was intercepted or blocked. Screenshots and JSON results are in the sibling evidence
  directory. Manual inspection confirmed readable desktop and mobile layouts.
- Permissions: unauthenticated, disabled, wrong-role, wrong-owner, deactivated-owner,
  wrong-company, changed-configuration and stale-browser identity cases fail closed.
- OAuth: state, proof, ticket, expiry, replay, explicit completion and concurrent
  attempts covered. GET and URL query parameters never authorize local disconnection.
- Disconnect: stale version, overlap, retry, uncertain provider outcome, partial
  revocation progress, local cleanup recovery and idempotency covered.
- Secrets remain server-side, AES-GCM encrypted with production/realm binding;
  browser state contains only expiring opaque proof/ticket. Errors/logs are sanitized.
- `git diff --check` passed. No dependency/lock, security-rule, operational index,
  existing sandbox module or production configuration change.
- GitHub checks and release results must also be inspected for the saved exact SHA.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Pass applies to the reviewed source and publication of the **disabled frontend**.
It is not approval or evidence of a working real-company connection. The standalone
backend is deliberately not exported by the deployed operational Functions index.

Residual risks and activation gates (owner: DEMAC integration maintainer, due before
production activation): obtain production keys privately; verify actual DEMAC realm,
authorized owner, QBO plan/country eligibility and questionnaire/disclosure accuracy;
review Intuit policies; run owner-driven authorization/disconnect/reconnect acceptance.
No real Intuit authorization, CompanyInfo read, revoke or accounting call was performed.
Synthetic tests cannot establish provider-side production interoperability. A crash
after external token issuance but before durable storage may require Intuit-side
manual revocation. Keep configuration stable while live credentials exist.

The owner's earlier explicit merge/deploy authorization in this conversation covers
publishing these disabled pages after review. It does not enable synchronization,
accounting writes, credential changes or real-company activation. Those remain gated.
