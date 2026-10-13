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

## Cloud result and separate diagnostic review

Main run `38418601440`, merge `43f9ab899ea02621239d91085b71c7de4bbcd976`,
verified the exact owner identity and active administrative profile. It then failed at
`create-encryption-key` before reaching the deploy command. No Intuit call occurred.
The original output intentionally withheld CLI response text, so a permission cause is
not yet established and must not be invented. Resource creation could have partially
completed; inspect metadata before retrying or replacing anything.

A separate Solo Maintainer Adversarial Review of the diagnostic follow-up verified:
`--diagnose` cannot enter installation, create secrets, deploy, change IAM or read payloads.
Its fixed calls project permission booleans, named key/version metadata, production function
existence and a tightly timed/key-filtered failed-operation audit. Logs request only method
and status and emit only numeric codes plus named allowlisted permissions, never messages,
principals, request bodies or secret data. Missing audit access is reported as unavailable,
not as an inferred cause. Permission probes are diagnostics, not authorization gates.

The diagnostic marker has precedence over the installation marker, including if both are
present. This follow-up is merged with `[merge-only] [diagnose-qbo-production]`; no resource
creation retry is authorized by that marker. Nine installer tests (including two new
diagnostic/error-redaction tests), source syntax and diff checks passed. Existing 44
connector tests remain part of CI. No backend/source/configuration change.

## Resumption review after QBO_READY — 2026-10-13

Separate Solo Maintainer Adversarial Review against current main
`5ecb0489298b9ddf02b7af1da7c6b7d03c2e3b5d`. The owner supplied the successful scoped
bootstrap output. Inspected the complete resumption diff, unchanged installer deploy and
existing-key paths, disabled backend entry point and HTTP authorization callers. Workflow
YAML before/after parses identically: only a resumption comment changes. Documentation
distinguishes observed owner completion, prior metadata evidence and pending cloud proof.

53 focused tests, reviewed-source comparison, script syntax, Functions validation including
its existing pre-hook, workflow semantic comparison and whitespace checks passed. No source,
dependency, IAM command, permission, authentication guard, release check or required gate
was changed. The production backend still equals reviewed PR #584. The current-main pin,
existing-function stop, key labels/version checks and other-function inventory guards remain.

Pass for the previously authorized isolated disabled installation, merged with
`[merge-only] [prepare-qbo-production]`. Do not replay the stale earlier installation SHA.
The installer must report encryptionKeyCreated=false for the completed owner preparation;
it must not rotate secrets. If any resource appeared or changed, stop and inspect it instead
of deleting/overwriting or weakening a guard. Cloud deployment/accessor readiness remains
unverified until this run. No production OAuth, financial write/read or frontend activation
is included. The existing shared-runtime limitation and separate activation gates remain.
