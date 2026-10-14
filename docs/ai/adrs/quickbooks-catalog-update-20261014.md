# ADR: guarded update of the installed QuickBooks reader

Date: 2026-10-14. Status: reviewed candidate; publication evidence pending.

Use a separate updater; the initial-install script continues rejecting an existing
function. The only Cloud Functions PATCH fields are `buildConfig.source` and
`serviceConfig.environmentVariables`. Copy the current environment and set only
`QBO_PRODUCTION_CATALOG_ENABLED=true`. No IAM, secret versions, other function,
provider company or OAuth connector changes are part of this deployment.

Before the first update, require the original `quickbooksreports-00001-liy` revision
and exact source reconstructed from66bc53a plus the original pinned package manifest
and designated owner's non-secret environment. Candidate source is independently
pinned by the existing source check. Verify full package manifests; no new runtime
dependencies. Preserve every other runtime/build setting and the Cloud Run IAM hash.

Use the existing retained-transport helper/private recovery bucket and immutable ZIP
generations. The inherited appointment-finance path is transport storage only; no
appointment-finance release or data update is invoked. Both original and candidate
are retained, downloaded, hashed, extracted and checked for anonymous denial. Source
metadata containing owner ID remains in private archives, never CI artifacts/logs.
Only summary hashes, revisions, operation IDs and private archive references are saved.

Reuse the already tested operation state machine: settle an accepted operation;
recover a lost PATCH receipt by listing operations; retry only the exact failed
candidate; require successful operation, immutable source and live revision/traffic
proof. QBO's adapter additionally requires exact environment provenance. Unexpected
state stops the update for review. No blind repeat and no automatic rollback after
an uncertain outcome. Normal reads may maintain the existing encrypted OAuth state;
the release itself never invokes authenticated reader routes or accesses token payloads.

Recovery: first inspect the recorded operation and serving revision. Re-running the
same reviewed main workflow resumes/reuses the same retained candidate. If main has
advanced, review a new exact release; do not bypass the main gate. For deliberate
rollback, use the retained `summary.recovery` source ZIP/generation, a fresh verified
current environment with only the catalog flag set false, the same narrow field mask,
and the same operation/source/config/IAM/traffic checks. Never restore a database or
old OAuth tokens. A rollback request must receive its own reviewed implementation;
retained archives alone do not imply an automatic rollback was executed.

Source: Google Cloud Functions v2 PATCH accepts an explicit field mask and returns
an Operation; environmentVariables is a string map:
https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch
https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions
