# Task: Owner-only QuickBooks production identity connection

## Context and authorization

Christian requested continuing the real DEMAC connection after confirming Aruba eligibility
on 2026-10-13. His existing merge/deploy authorization is conditional on preserving real
customer and accounting data. Only identity authorization/verification is activated here.
The backend's disabled installation completed in run `38428683358`, revision
`quickbooksconnection-00001-taq`, from PR #589. Production frontend gate is absent.

Mode: **Deep Review**, infrastructure and production-authorization boundary.
Review mode: separate **Solo Maintainer Adversarial Review**, not independent review.

## Scope and authorities

- Existing `quickbooksConnection` only: runtime gate false -> true, or recovery false.
- Exact owner is resolved through the supplied-email Auth lookup and matching active
  admin profile. Realm remains `9130352327074466`; no user/role changes.
- Source remains the reviewed PR #584 package. Source, build, secret references, owner,
  runtime identity and every unrelated runtime setting must remain unchanged.
- Frontend displays Country from CompanyInfo without guessing the subscription edition.
- Updated terms/privacy describe real identity access and explicit revocation. Pages
  remain public by direct link, noindex, outside public navigation.
- QBO remains accounting authority. No invoices, payments, expenses, reports, stock,
  financial balances, operational ERP records, webhooks, background sync or AI/MCP access.
- Sandbox behavior, runtime and source stay unchanged.

## Acceptance

- [x] Local source pin, syntax, transport/authorization and update-boundary tests.
- [ ] Required CI and separate adversarial review complete.
- [ ] Production disclosures published before activation; script compares exact bytes.
- [ ] Existing owner/company/source/secrets verified before/after runtime update.
- [ ] Other function inventory unchanged, five public denial/CORS/cache probes pass.
- [ ] Frontend enabled only in production and public entry/sign-in return verified.
- [ ] Owner completes Intuit consent, checks company/country and confirms in original tab.
- [ ] Owner-driven disconnect/reconnect verifies real provider lifecycle.

Cloud and owner-dependent items require observed results, not unit-test inferences.

## Delivery and recovery

Use a reviewed branch and PR. The currently published ERP tree at
`2456f2f48623e210aa075da77c4c759e07185da2` matches the `apps/erp-next` tree in main
`aeaa9bb504e89779f49316c4e3fe644912fa4795`; no unrelated frontend feature is bundled.
After required checks/review, publish the exact reviewed frontend commit with only the
production `NEXT_PUBLIC_QBO_PRODUCTION_ENABLED=true` flag. Backend remains false during
publication. Merge with `[merge-only] [activate-qbo-production]` to run the isolated
main-only workflow after validating live disclosures. Recheck heads before release;
do not overwrite concurrent changes.

The workflow serializes with the initial installer. The script requires current remote
main, original disabled revision and no existing production authorization document. It
updates only `serviceConfig.environmentVariables`, preserving the map except the gate.
A config-only PATCH preserves the original source archive, including its disabled `.env`;
future code redeploys must explicitly review that gate. No provider call occurs in release.

Recovery: set the frontend flag false and republish the verified frontend. A reviewed main
merge touching the activation workflow with `[merge-only] [disable-qbo-production]` runs
the same source/config checks and suspends the runtime gate. Disable takes precedence if
both markers appear. It does not revoke Intuit credentials, delete records or undo consent.
Use the owner revoke flow for disconnection. Never blindly retry an uncertain PATCH;
inspect its result. Initial activation refuses changed revisions or existing authorization.

Residual concurrency: Cloud Functions PATCH has no documented compare-and-swap option;
workflow serialization and immediate snapshot checks detect drift, but an out-of-band
concurrent console change still requires operator coordination.

## Evidence

- 58 focused backend/installer/activation tests passed locally without provider calls.
- Source pin checks preserve the reviewed backend and dependency lock.
- Verified rollback deployment: `dpl_HHYxEWTGWnqvLH3qRBGkBuDdrTRm` on demac-aruba.com.
- Local build was interrupted by execution-environment transport failure; remote build
  and required CI must provide complete build evidence before publication.
- Final CI, deployment and cloud run IDs will be recorded in the release PR.

Bounded runtime update reference:
https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch
