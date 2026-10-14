# Review: QuickBooks reader update

Solo Maintainer Adversarial Review, separate from implementation; not independent.
Reviewed the updater, original installer, source/transport/operation helper callers,
HTTP boundaries and GitHub workflow. This supplements the complete catalog and
appointment-preview reviews. User deployment authority persists; accounting writes
remain outside authorized scope.

Findings corrected before publication:
- An extra ACTIVE-only check in publish would prevent retrying a classified failed
  deployment. Allow FAILED/UNKNOWN only after the existing operation state machine
  proves a terminal failed attempt; source/config/owner checks still apply.
- A source-only operation match would overlook changes to environment. Require exact
  environment in request provenance as well as immutable source bytes.
- Artifact upload must not include staged source/environment. Upload only the safe
  summary and pin the artifact action to its verified v4 commit.

Fresh review checked first-run baseline identity, dependency/source reconstruction,
unknown revision/config rejection, minimal patch mask, owner/realm/secret refs,
private archive reuse, lost receipt and failed-operation recovery, success provenance,
serving traffic, anonymous request rejection and no Intuit endpoint in release code.
The original installer retains its existing-function rejection. Other functions are
compared before/after; no customer records or token payloads are read during release.

Local verification: 40 focused catalog/report/release/update/operation tests PASS;
44 OAuth/sandbox regressions PASS. The five new update tests cover config/identity
mutation, package delta, exact operation environment and anonymous-only probes.
Type/build/browser and exact-head CI are recorded in publication evidence below.

Residual limits: real Cloud Functions operation metadata must carry the complete
requested environment or publication verification fails closed. Main changes during
release block further publication. Unexpected installed source/revision blocks before
update. Live catalog content cannot be accepted from synthetic tests; the designated
owner's signed-in read is a separate remaining step. Automatic rollback is not claimed;
immutable baseline plus reviewed forward recovery are available.

Pre-publication verification completed: ERP typecheck and full production build/prebuild
PASS; production entry/catalog acceptance PASS; 19 preview/diagnostic and 8 recovery
checks PASS; catalog browser at1280/375 PASS; 8 preview browser cases and all7 actual
charge/payment flows PASS on merged main1349282. First preview-browser invocation used
the catalog harness environment names and stopped before running; corrected to that
harness's BOOKING_MODAL variables, then all cases passed. No required gate was skipped.
