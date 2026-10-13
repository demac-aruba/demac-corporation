# Review: Controlled production identity activation

## Review mode

- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Builder and reviewer: Codex, separate implementation and adversarial-review passes.
This is not an independent review or an Intuit security certification.

## Scope and review evidence

Reviewed the complete activation script, tests, workflow, three new helper exports,
country projection, updated disclosures, rollout task and ADR against the owner's
real-data protection condition. Re-read the existing HTTP handler/service, explicit
frontend actions, source packaging and before/after verification helpers.

- Backend source/dependencies remain pinned to PR #584; function capability is unchanged.
- Only current main in the known repository can perform a cloud update. PR validation
  receives no cloud credentials; setup/auth actions remain pinned to existing reviewed SHAs.
- Deployment uses the exact one-function URL and environment-only updateMask. No IAM,
  secret creation/rotation, user/profile write or Intuit request exists in the script.
- Owner Auth identity and active admin role are rechecked; realm and version-1 secrets
  are pinned. Original disabled revision and absent authorization are mandatory to enable.
- Live disclosures must match reviewed bytes before activation. Preview gets no production
  frontend flag; server owner authorization is the actual security boundary.
- Existing ERP tree matched the verified current production deployment. Navigation,
  scheduling, prices, customer records, billing, inventory and existing sandbox are unchanged.
- All service settings except the gate/generated revision and the entire buildConfig are
  compared after update. Other-function inventory must remain identical.
- Public probes contain no user credentials, OAuth state/code, financial payload or action.
- Disabling is a suspension, not revocation. Uncertain PATCH results are explicitly reported
  and not automatically replayed. A changed revision requires inspection/review.
- UI displays provider country or No informado, never fabricates regional edition.

## Findings and corrections

| Severity | Finding | Resolution |
| --- | --- | --- |
| Low | A completed operation returned by the final permitted poll could be reported as unknown. | Poll loop now evaluates that final response before timeout. |
| Operational | Local full build lost its execution process during an environment transport interruption. | Typecheck and focused transport checks were rerun successfully; complete remote CI/build is still required before publication. |

No unresolved material implementation finding. Release gates below remain mandatory.

## Verification

- 58 focused backend, sandbox, installer and activation tests passed; positive and negative
  state/owner/config/source-drift, bounded polling, error redaction and no-provider probes.
- Existing production transport acceptance passed (login return, isolation, browser proof,
  read-only landing, explicit completion/revocation, recovery and identity races).
- ERP Next typecheck passed. Functions validate:firebase, including prevalidation, passed.
- Source pin and JS syntax checks passed. Whitespace/diff check passed.
- Required PR CI/full build, production byte checks, actual runtime transition and external
  owner consent are not inferred from local tests; results belong in the release PR.

## Decision

- [x] Pass with recorded release gates and owner acceptance pending.
- [ ] Block / changes required.

Before publishing: required CI and complete frontend build must pass on the reviewed
commit, heads must be current, and the prior deployment must remain available for recovery.
Owner merge/deploy/continue authorization already exists; do not ask for general approval again.

Residual risk: broad Intuit OAuth scope is constrained by application code; cloud shared
runtime identity is inherited, not dedicated. Out-of-band console updates can race the
Cloud Functions API without a documented CAS precondition. Main workflow serialization,
source/config checks and a known recovery path mitigate this. Owner must perform real
OAuth and later disconnect/reconnect to establish provider lifecycle acceptance. No
financial write/report/synchronization or AI access is authorized by this release.
