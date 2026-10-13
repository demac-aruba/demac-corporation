# Review: Disabled QuickBooks production installation

## Mode and scope

Solo Maintainer Adversarial Review. Codex performed implementation and a separate full
adversarial pass; this is not an independent review. Reviewed against the owner's real
company/account instructions and existing reviewed merge/deploy authorization. Current
main `57a1b1bed76531b01656b97232c40b75852de490` was incorporated without changing its
catalog work. The backend remains byte-identical to reviewed PR #584.

Reviewed installer, tests, workflow, rollout/task documentation, the three backend modules
and their Auth/role/disabled-state callers. Identity remains Firebase Auth plus the governed
user profile; QuickBooks remains accounting authority. No business rule changes, new source
of truth, customer migration or Legacy change. Existing connection ADR and sandbox rule
`FIN-QBO-SANDBOX-READ-001` remain in force.

## Adversarial findings and corrections

- Tightened malformed Auth `disabled` handling: only absent/false is acceptable, rather
  than allowing any non-true value. Exact email, unique result, bounded safe UID, matching
  profile resource, active flag and allowed role are all required before installation.
- Added runtime identity comparison to the existing sandbox default identity; an unexpected
  identity stops the installation. This does not claim a dedicated least-privilege runtime:
  the platform default identity is shared. The only new credential bindings are the three
  named production secrets required by this dedicated function. No project IAM command exists.
- Recheck both credential versions immediately before deployment. Unexpected versions,
  pagination, disabled metadata, unknown existing encryption key or existing production
  function require inspection; none is silently rotated, reused or overwritten.

No unresolved material finding for this disabled initial installation. Real activation
continues to require the separate provider/policy/owner acceptance gates.

## Evidence

- 51 focused tests passed: seven installer security/failure tests plus all 44 existing
  production/sandbox tests. Source comparison and syntax passed.
- `npm run validate:firebase --prefix functions` passed, including its existing pre-hook.
  No root lifecycle scripts were run or required gate weakened.
- Workflow parse/structure checks and whitespace/diff check passed. PR validation has no
  cloud credentials; only reviewed main plus the explicit installation marker can deploy.
- Inspected the single `firebase deploy --only functions:quickbooksConnection` target and
  six-file source package: no operational index/bootstrap, lifecycle hooks, secret values
  or frontend gate. Environment generation cannot accept UID newline injection and always
  writes `QBO_PRODUCTION_ENABLED=false` with the owner-designated realm.
- Exact Auth lookup POST is a documented read operation; only one matching profile GET
  follows. No account list, password, user/profile write, impersonation, Intuit request or
  financial/customer-record read/write exists. Response projection excludes unrelated
  profile/Auth fields; UID stays inside runner configuration and is not logged.
- Key generation uses 32 random bytes, stdin and creation-only semantics. Existing labeled
  version 1 supports recovery after a failed deployment; an existing function stops a rerun.
  Logs emit fixed codes/boolean metadata, never raw CLI/provider/Firestore responses.
- Pre/post other-function snapshots and published-source equality detect concurrent work
  or unexpected deployment changes without deleting or rolling back other functions.
  Public HTTP probes have no user tokens or OAuth state and verify denial/disabled behavior.

## Decision and limitations

Pass for reviewed merge and the scoped disabled installation, under the owner's existing
connection setup and merge/deploy authorization. Actual cloud identity/permissions, key
creation, deployment and live probes were not claimed from tests; record their run result
separately. If a gate fails, leave both activation flags off and investigate the exact failure.

No real Intuit credential validation, consent, company read, financial report, synchronization
or ChatGPT/MCP access occurs. Country/policy/disclosure review and owner-driven
authorization/disconnect/reconnect are still required before activation. A new dedicated
runtime identity is an explicit future security decision, not silently added by this release.
