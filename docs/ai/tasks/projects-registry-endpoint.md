# Projects registry endpoint: prepared release contract

This is a reviewable deployment contract, not deployment authorization. No real
environment was configured, deployed, activated or migrated by this work.

## Source and runtime

`functions/bootstrap.js` now exports the exact `projectsRegistry` function from
`functions/projectsRegistry.js`. It calls the existing HTTP adapter and registry
service; there is no second planning writer. The ERP already addresses
`https://us-central1-${firebaseProjectId}.cloudfunctions.net/projectsRegistry`.

The function uses Node 22, us-central1, 256 MiB, a 60-second timeout and at most three
instances. Only the endpoint is exported; factories and test helpers are private.
Admin initialization is lazy after transport checks. Configuration validation is
also lazy so a malformed Projects origin cannot prevent discovery of other functions.

## Controls and release inputs

| Control | Default / requirement |
|---|---|
| Existing `PROJECTS_REGISTRY_ENABLED` | Runtime is disabled unless exactly `true`; shared with the Office Booking integration |
| Existing `businessSettings/projects-registry.backendEnabled` | Must be `true`; server rechecks on every transaction |
| Existing `writesPaused` | Stops new planning writes, preserves authorized reads and exact receipt recovery |
| Existing `bookingEnabled` | Booking integration control; not modified by this endpoint |
| Existing `NEXT_PUBLIC_PROJECTS_REGISTRY_ENABLED` | Client build control; does not authorize server access |
| New `PROJECTS_ALLOWED_ORIGINS` | Comma-separated exact HTTP(S) origins, empty by default; no wildcard, path, implicit preview domain or credentialed CORS |
| Existing import capability | Deployment adapter keeps `allowLegacyImport:false`; a DB flag or public UI flag cannot open real import |

`PROJECTS_ALLOWED_ORIGINS` is newly introduced configuration, not a claim that such
configuration already exists in Vercel/Firebase. It has not been set in a real environment.
Its allowlist is cached per function instance; changing it requires normal runtime
configuration rollout. Server activation/write-pause settings remain transaction reads.

Firebase ID tokens are verified with revocation/account-disable checking. Current active
roles are loaded from Firestore, including on exact replay. An omitted Origin is not
authentication: non-browser callers must pass the same token and role checks. Responses
disable caching and redact internal failures. Unknown service outcomes preserve exact
request recovery rather than inviting a replacement write.

The normal endpoint deliberately cannot commit a legacy import. Completing that release
capability remains dependent on the original-source backup, reconciliation, isolated
restore and explicit import authorization. Do not describe the import UI as activated or
the complete delivery as finished merely because this endpoint is now exported.

## Reproducible isolated verification

With the repository Functions dependencies installed, Node 22, Java 21 and
firebase-tools 15.30.0 in an isolated tooling directory:

```text
PROJECTS_UI_TOOLS=<isolated-tooling-directory>
node --test functions/projects/registry-bootstrap.test.js functions/projects/registry-http.test.js
node functions/projects/run-http-emulator.cjs
```

The runner creates an ignored temporary source directory and selects only the actual
`bootstrap.projectsRegistry` export. It does not rewrite shipping source or register
operational triggers. It copies the current Firestore rules unchanged and uses
`demo-demac-projects` with Functions/Auth/Firestore on loopback. Production credential
variables are removed; Node 22 is enforced for the CLI, runtime and test client. Generated
local logs are preserved for diagnosis and must not be published as evidence artifacts.

The nine real Functions HTTP cases cover preflight/denied origins, malformed credentials,
active provisioned roles, runtime DB activation, concurrent exact requests, lost response
recovery while paused, role/account removal, closed import and stale budget writers.
Protected operational collections are compared in full before/after. Separate bootstrap
tests cover default-off and absent/invalid origin configuration.

This is an emulator HTTP test, not a certificate for deployed TLS, IAM, indexes, browser
origins, quotas or production data. CI runs it both on the candidate and the disposable
combination with #515; those workflows have been prepared locally, not run remotely.

## Concrete release prerequisites

1. Apply the [recorded operational scope](projects-operational-cost-scope-20260920.md),
   which does not require QuickBooks or future AI capture. Record isolated Firebase project ID, database,
   region, ERP origin and authorized access. Current connected previews target production
   Firebase configuration and cannot substitute for this environment.
2. Preserve the exact code/configuration rollback artifacts and complete real-source,
   DB/Storage backups plus relationship-aware isolated restore evidence.
3. Review the selected function's IAM/invocation configuration and the explicit origin
   allowlist before any authorized isolated deployment. No broad Functions deployment is
   needed to validate this endpoint; operational triggers must stay out of fixture tests.
4. Verify deployed default-off behavior, then only under explicit activation authority
   validate the registry, Booking flags, revocation, retries, pause, required indexes,
   actual browser flows and before/after HTTP/visual performance.
5. Review main's automatic Office/Field/Work Order/WhatsApp deployments and WhatsApp
   migration scripts. Coordinate lifecycle-token backend/frontend/cache rollout.
6. Present the exact validated candidate and operations for final owner approval. Do not
   push, merge, activate import, deploy production or run a real migration by inference.

Pausing new writes, reverting code and restoring data are distinct operations. Do not
overwrite later bookings with an older backup or restore stale browser Projects over
central adoption. No live RTO/RPO or recovery completion is claimed.
