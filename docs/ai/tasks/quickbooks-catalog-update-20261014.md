# Task: activate the existing owner-only catalog reader

Deep Review. Christian authorized merge/deploy after review and continued the catalog
stage on 2026-10-14. Scope: publish PR597's reviewed reader and UI, enabling only the
explicit Customer/Item/Account read flag. No accounting writes, persistent mappings,
customer creation, accounting imports, inventory changes or new financial authority.

The separate updater must reject unrecognized installed source, owner, company,
revision, secrets references or entry point. Preserve runtime settings, IAM and all
other functions. Retain verified private baseline and candidate before the narrow
source/environment patch. Recover accepted/lost/failed operations by provenance, not
blind duplicate deployment. Keep the first-install refusal untouched.

Acceptance: exact source checks; owner/service/realm pinning; inactive and enabled
flag compatibility; retained immutable ZIP privacy; operation success, live source,
revision and serving traffic proof; anonymous access denials; synthetic catalogs,
reports/OAuth regression, UI/browser/types/build checks. Real catalog content remains
an owner-session acceptance step; CI must not obtain owner credentials or read it.

Integrate main1349282 (PR600) preserving recovered invoice draft descriptions.
No change to actual-work or payment commit paths is required for this update.
