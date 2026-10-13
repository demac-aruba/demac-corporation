# Task: Install the designated owner's disabled production connector

## Context and authorization

Deep Review: credential provisioning, owner authorization configuration and an isolated
production backend deployment. Christian explicitly authorized reviewed merge/deploy for
this connection while protecting real QuickBooks data, then supplied the real Company ID,
confirmed QuickBooks Advanced and supplied the exact ERP sign-in address on 2026-10-13.
Continue that authorized setup without requiring another general merge/deploy approval.
This installation never activates OAuth, accounting synchronization or reports.

## Scope and authorities

- Read exactly one Firebase Auth account by the supplied business sign-in address, then
  read its matching `users/{uid}` profile using only active, role and email fields. No
  user-list scan, login impersonation, password/reset/email, role or profile mutation.
- Stage the unchanged PR #584 backend with its dependencies/lock and one dedicated entry
  point. Pin the owner UID and real realm, and force the server gate to false.
- Create the missing 32-byte random base64 encryption key in Secret Manager through stdin,
  never logging it or writing it into source. Do not rotate or replace existing secrets.
- Deploy only the new `quickbooksConnection` function. Firebase may bind access to the
  three named production secrets for its runtime identity and configure this function's
  public HTTP invocation; application auth/owner checks remain mandatory. Do not change
  project IAM, security rules or operational function definitions. Reuse the platform's
  existing default runtime identity, verified against the sandbox.
- Preserve Auth/roles, QuickBooks accounting authority and `FIN-QBO-SANDBOX-READ-001`.
  Existing connection ADR applies; no new ledger, collection or source of truth.

## Acceptance

- [x] Unique exact Auth identity plus active allowed role; missing/disabled/mismatched
  identity fails before cloud resource mutation. UID remains within the runner/config.
- [x] Reviewed source pin, no root entry points/hooks, disabled realm/owner configuration,
  version-1 secret pinning, pre/post other-function inventory and metadata verification.
- [x] No frontend flag, provider authorization, transaction, report, stock or customer write.
- [x] Focused security/failure tests and existing production/sandbox regression tests pass.
- [ ] Actual cloud owner lookup and isolated deployment complete successfully.
- [ ] Published source, runtime configuration and public denial/disabled probes verified.

## Recovery and residual risk

Existing resources/versions are never deleted or rolled back. If key creation succeeds
but deployment fails, retain the labeled version-1 key for a reviewed retry. If the function
exists, stop before deployment and inspect its metadata/source; do not overwrite it on a
rerun. A failed verification does not activate the server or frontend. Concurrent unrelated
deployments cause inventory mismatch and require inspection, never automatic rollback of
someone else's work. Main advancement stops the release before writes when detected.

Default-runtime reuse follows the existing Functions architecture; secret access is bound
to that identity, not a distinct IAM identity exclusive to this function. No claim of IAM
isolation from other code using the same privileged runtime is made. A dedicated runtime
identity and collection-level data-access design are a separate hardening decision.

Real Intuit credential correctness, company country/eligibility, policy/questionnaire and
disclosure review, and owner-driven connect/disconnect/reconnect acceptance remain pending
before enabling real use. Passing local mocks does not establish live interoperability.

## Verification

53 focused tests (9 installation tests and 44 existing connector/sandbox tests), syntax,
reviewed-source and workflow/diff checks are required before reviewed merge. The main-only
installation uses the existing cloud identity after validation; PR jobs receive no cloud
credentials. Merge markers: `[merge-only] [prepare-qbo-production]`.

## Resumption after owner bootstrap

On 2026-10-13 the owner completed the scoped Cloud Shell bootstrap and supplied the
`QBO_READY` result. The previous diagnostic run `38419860300` established that the
deployment identity could not create the key itself and that no production function
existed. Resume the unchanged installer from a new reviewed current-main merge, using
the existing-key recovery path. No secret rotation, extra IAM privilege, backend source
change or frontend activation is part of this resumption. Acceptance remains pending
until actual deployment and verification succeed; the screenshot alone is not proof of
a deployed function or a QuickBooks connection.
