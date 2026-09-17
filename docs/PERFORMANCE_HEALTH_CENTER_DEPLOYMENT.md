# Performance telemetry deployment boundary

## No operational bootstrap change
The reviewed monitoring PR leaves `functions/bootstrap.js` identical to the mainline operational version. Several existing main-branch workflows watch that file, so adding telemetry there would unnecessarily redeploy Booking, Field or WhatsApp. Instead, `performanceTelemetryEntry.js` initializes Firebase only for the new telemetry service.

`performanceTelemetryPackage.cjs` stages an allowlisted source bundle outside the repository. The bundle contains exactly:
- index.js (the standalone entry)
- performanceTelemetry.js
- performanceTelemetryCore.js
- performanceTelemetryService.js
- package.json (only firebase-admin/firebase-functions)

CI installs the dependencies in that isolated directory, verifies that only the intended HTTP function is exported, and retains the generated package-lock.json with the source artifact. The deployment job consumes THAT artifact, not the whole functions directory. No production credentials are used to build or test the bundle. No business-function source, notification worker or migration enters it.

## Retention/index provisioning
Only the new, explicitly named telemetry collections receive TTL or index-exemption configuration. The documented gcloud field update flag is `--disable-indexes`; `--clear-indexes` is not supported. Disabling the indexes on the aggregated metrics map does not disable the separate bucket-time index used by the dashboard.

TTL is asynchronous. The existence of an expiresAt field alone is not proof that a database TTL policy is active. The deployment job must successfully submit the TTL/index configurations before deploying the endpoint. Operational collections and security rules are not altered.

## Startup sampling without startup authorization side effects
A newly authenticated browser may finish its first Schedule read before telemetry policy has returned. Up to 10 seconds of initial, allowlisted observations are buffered in bounded memory. This is not upload authorization: flush still requires a successful authenticated policy response, a valid existing ERP token, and the server ingestion transaction checks the collection switch. Denied/failed policy drops this initial buffer. Credentials are never renewed, written or cleared by telemetry.

## Evidence and limitations
The isolated browser suite uses the actual built ERP with intercepted operational network responses and real Auth/Firestore emulators. The `get_van_schedule_groups` test fixture follows its actual `{ success, version, groups }` response contract; omitting `groups` had previously crashed the simulated Scheduling view. The production Scheduling component was not changed to conceal that fixture error.

The 50-sender test measures telemetry ingestion concurrency in an emulator. It is not a claim that the entire production ERP has passed a 50-user load test. Actual production latencies and baseline coverage begin only after a separately approved deployment.

Rollback consists of pausing telemetry or reverting code. This module does not implement or certify a real customer/appointment backup, one-click data restore, or instantaneous recovery. That separate protection is still a gate for the later operational optimization project.

References:
https://docs.cloud.google.com/sdk/gcloud/reference/firestore/indexes/fields/update
https://firebase.google.com/docs/firestore/ttl
