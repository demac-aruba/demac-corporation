# Technician App: transient authentication recovery

## Scope and authority
Continue PR 526 on `feature/technician-app-20260923`. This change implements the session-continuity requirement without waiting for the independent hosting blocker. It uses the existing email/password session, AuthProvider, canonical user/staff profile and Firestore access path. No server authorization, Firebase rules, account provisioning, pricing, booking, inventory or production configuration changes.

Deep Review applies because the shared AuthProvider and token-refresh lifecycle affect all authenticated ERP Next routes. This is not completion of the multimedia outbox, shared parts or procedures. A mounted text input in the regression harness is evidence of component continuity, not evidence of durable photos or offline backend commits.

## Behavior
- Explicitly typed fetch/network, interrupted-body, HTTP 408/429/5xx errors retain the existing session for retry. Non-network application/parse defects do not receive that classification.
- A previously server-verified principal remains mounted during a transient profile check failure. A visible notice offers explicit retry; no automatic mutation or success acknowledgement is generated.
- Fresh page loading or a successful password exchange alone does not grant access. Until the canonical profile is checked, the UI remains locked. Rechecking a retained credential does not require repeating the password exchange.
- Authoritative authentication/permission errors, missing/inactive/unrecognized profiles and unlinked technicians still lock access. No arbitrary stored roles or cached principal are trusted on reload.
- Concurrent refresh consumers share one token exchange and one same-session profile verification. Sign-out/account changes invalidate late responses; an older account cannot overwrite or clear a newer login.
- Existing sessionStorage is the only token store. No credentials are added to IndexedDB, logs, URLs or business records. Existing user-scoped Field drafts are not removed by this change.
- The new banner is in document flow, not a fixed overlay. It does not declare captures uploaded or server-confirmed.

## Failure boundaries and tests
New isolated tests use the real session module and AuthProvider with explicitly synthetic transport responses, not customer data. Existing application typecheck is retained in the added `Technician session resilience` workflow. The prior Field, security, offline, backend and blocked-public-preview checks remain unchanged.

Local verification at preparation:
- Original auth-provider/session/firestore-rest/principal blob identities matched the current remote source before editing.
- 37 session transport/storage regressions passed; the original session implementation failed the first transient-error regression as expected.
- Focused TypeScript 5.8 checking of changed modules and the fixture passed against existing React/Node definitions. This is supplemental, not a replacement for repository TypeScript/build.
- JavaScript syntax and workflow YAML/shell checks passed.
- The local managed Chromium refused navigation to the loopback fixture with `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was altered or bypassed. The local browser result is FAIL/environment-blocked, not UAT success. The authorized GitHub CI workflow must run the browser checks in Chromium and WebKit and report its actual results separately.

Adversarial cases include response loss, malformed data, quota failure, single-flight refresh, identity mismatch, late success/denial, explicit sign-out, fresh-load access denial, same-session retry, role/staff removal, HTML/error redaction, and zero external requests in the fault-injection harness. Physical devices and hosted Firebase/Vercel acceptance are separate and remain unverified.

## Hosting boundary investigated in parallel
Read-only candidate run `36051164690` inspected `officebookingauthoritypreview`; the sanitized metadata contains one ready container and only the environment key `LOG_EXECUTION_ID`, with no explicit separate Firebase project/database/storage identifiers. This is insufficient evidence to reuse it safely for Field writes. No application endpoint was invoked and no service was repurposed. Artifact `10830486806` download SHA256 matched `40d5401aa1b645aece65b5b7c3d36e7dfdb9fd699c2019cce3dfe1b38c4906e2`.

Vercel project metadata retrieval still reports a connector schema mismatch (exposed `projectId` versus expected `idOrName`). This is not evidence that the owner's account lacks permissions. No new provider or tunnel is used. The approved Vercel preview remains unavailable until hosting/data isolation is actually resolved; do not label these component regressions a public preview.

## Review and release
A separately recorded Solo Maintainer Adversarial Review is required; it is not independent review. Review the complete diff and actual calling contracts and record exact-head remote results in PR 526. No merge, auto-merge, production deployment, permission expansion, billing activation or customer writes are authorized by this checkpoint. A source-only rollback is possible without data migration, and must not restore the previously rejected tunnel publisher.
