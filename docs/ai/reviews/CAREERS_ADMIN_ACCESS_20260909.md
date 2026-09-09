# Careers administrative access — separate review

Mode: Solo Maintainer Adversarial Review, same maintainer, not independent. Baseline e09578d. Scope is the menu entry, protected route mount, existing-authority deployment entry, release script/workflow, and focused tests. Implementation and this review are separate passes.

## Static findings
- The removed variable was a presentation-only gate, not server authorization. The same super_admin role restriction remains; the route now waits for active Firebase identity before mounting effects. Existing careersAdmin checks revoked tokens and active admin records inside write transactions.
- Deployment stages only Careers and its dependency manifest. It rewrites package.main in the temporary staging directory, not the repository's shared Firebase bootstrap. Only careersAdmin is exported, preventing accidental public/worker deployment.
- Missing provider metadata or runtime identity aborts. The default bucket is resolved from actual existing runtime configuration or the provider SDK artifact, not guessed. Tokens/provider configuration are captured without log output.
- Existing live-approved admin deployments are not overwritten by the preparation script. Exact site origins, release OFF and retention OFF are explicit. No secret provisioning, role changes, data writes, source seeding or manual owner authentication.
- Hosted endpoint is reachable for Firebase-authenticated browser calls. Missing/invalid Firebase token and unapproved-origin probes must fail; a 200 without valid identity is a release failure. The workflow only deploys from main after its validation job.
- CI credentials are limited to the main deployment job; PR jobs use only synthetic local emulator data. No PR-controlled code executes with production credentials in the validation job.

## Verification disposition
Local release-configuration tests: 4/4 passed; syntax checks passed. Exact-head CI, existing browser screenshots and the post-deployment result must be recorded in the PR before final completion. No mandatory gate is relaxed, and no production readiness or owner-session save is implied by a successful build.

## Residual limits
Sender/antivirus/privacy/retention and physical-device/load requirements for public recruiting are unchanged. Drafts can be prepared, but Open publication remains blocked until setup is approved. Infrastructure permissions or missing metadata can still prevent deployment; report the actual failure rather than claiming successful activation. No new architectural authority was introduced, so ADR-CAREERS-001 remains applicable.
