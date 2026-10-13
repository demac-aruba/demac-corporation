# QuickBooks production preparation: metadata preflight

## Task and scope

The owner confirmed creating the production Client ID and Client Secret on 2026-10-13.
Verify their existence and enabled version metadata, inspect the third encryption-key
prerequisite, and inspect the isolated production/sandbox Function status. This is a
read-only preparation step, not production activation or an accounting integration test.

No domain authority, financial rule, customer state, ERP workflow, Firestore access or
existing sandbox behavior changes. `FIN-QBO-SANDBOX-READ-001` is preserved. Existing
owner authorization covers reviewed merge/deploy work; this release only runs metadata
GETs and publishes no application/backend. The merge-only marker suppresses Vercel and
unrelated automatic deployments. The separate preflight marker selects this read-only job.

## Separate Solo Maintainer Adversarial Review

Reviewer and implementation author: Codex, separate review pass; not independent.
Base: `14eda78996ca67497f7b86edd50ac965035018a1` (reviewed connection PR #584).

- Cloud credentials are used only after a reviewed merge to main. PR validation gets
  no cloud credentials. Existing Google Actions identity is reused without IAM changes.
- Exactly five fixed Google metadata GETs are possible. No URL argument, redirect,
  provider request, database request, secret payload access, shell interpolation or
  deployment command exists. Auth tokens and response bodies are never logged.
- Output is a positive allowlist of resource names, numeric enabled-version IDs,
  bounded revision labels and boolean status/configuration indicators. Secret values,
  client IDs, environment values and user/customer data are excluded.
- 403, 3xx, invalid JSON and oversized responses fail closed and are not interpreted
  as absence or successful credential verification. 404 identifies an absent resource.
- Read results report their limits: metadata proves neither that values are correct nor
  that real DEMAC can authorize. Versions are bounded to ten; truncation is identified.
- Missing encryption key and missing production Function are recorded prerequisites;
  neither is created implicitly by verification.

## Verification and decision

Four synthetic tests passed, covering endpoint/method allowlisting, redirect rejection, credential
and environment redaction, resource identity, and denied/missing/malformed/oversized
responses. Python syntax, workflow structure and whitespace checks passed before
saving. GitHub validation must pass before the main-only cloud check is run.

The existing standalone backend can be packaged from the exact reviewed source with
only `quickbooksConnection.js`, its two sibling modules, the existing Functions
manifest/lock and `main=quickbooksConnection.js`; root lifecycle scripts are removed.
The six-file local stage was prepared and checked against the exact source SHA;
all three backend syntax checks passed, scripts are empty and its environment contains
only `QBO_PRODUCTION_ENABLED=false`. No production values were copied or deployed.

Decision: pass for read-only metadata verification after the listed checks pass.
Outstanding before activation: verified real DEMAC Company ID and designated ERP owner,
encryption key, isolated backend rollout, current policy/eligibility/disclosure review,
and owner-driven real-company authorization acceptance. Accounting writes remain disabled.
Cloud results and any unresolved permission failures must be reported separately.
