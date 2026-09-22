# Isolated dwellings preview runbook

Project must be exactly demo-demac-dwellings. Never run the seed, tests or gateway against a real Firebase project. No service account or production secrets are used.

## Start and restore
1. Install dependencies in apps/erp-next and functions. Use Java 21 and Firebase CLI for the emulator suite.
2. Export environment: GCLOUD_PROJECT=demo-demac-dwellings; FIRESTORE_EMULATOR_HOST=127.0.0.1:8297; FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9297; FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9397. GOOGLE_APPLICATION_CREDENTIALS must be absent.
3. firebase emulators:start --only auth,firestore,storage --project demo-demac-dwellings --config firebase.dwellings-preview.json --import=../dwellings-emulator-data --export-on-exit=../dwellings-emulator-data
   Omit --import only for a genuinely new environment.
4. For new environments, set a private random DWELLINGS_PREVIEW_PASSWORD (16+ characters), then node functions/test-support/dwellingsSeed.cjs. An existing fixture marker causes the seed to retain data. Accounts are demo-office@demac-preview.invalid (super_admin) and demo-tech@demac-preview.invalid (technician/DRIVER-1). Never commit the password.
5. Build ERP Next with NEXT_PUBLIC_ISOLATED_PREVIEW=true and ALL public Firebase fields overridden: API_KEY=demo-key, AUTH_DOMAIN=demo-demac-dwellings.firebaseapp.com, PROJECT_ID=demo-demac-dwellings, STORAGE_BUCKET=demo-demac-dwellings.appspot.com, MESSAGING_SENDER_ID=000000000, APP_ID=demo-dwellings, MEASUREMENT_ID empty. Set NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED=false and NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT=preview. npm run build --prefix apps/erp-next.
6. node functions/test-support/dwellingsPreviewServer.cjs serves loopback 4397. Only this gateway may be tunneled. Auth/Firestore/Storage/hub ports stay loopback; do not publish emulator UIs.
7. cloudflared tunnel --url http://127.0.0.1:4397 --no-autoupdate --protocol http2. This produces a temporary HTTPS URL. Test /__preview/health, password login, roles, persistence and the no-production-path checks at that exact URL.

The gateway snapshots emulator Auth/Firestore/Storage to ../dwellings-emulator-data every 30 seconds. Keep this directory private. Export-on-exit supplies an additional checkpoint. Never delete or reset this directory to rerun UI checks. Restart requires sign-in again because issued-token allowlists are intentionally process-local.

## Evidence commands
- npm run typecheck --prefix apps/erp-next; npm run build --prefix apps/erp-next.
- npm run validate:firebase --prefix functions.
- node --test functions/propertyLocations.emulator.test.cjs with the isolated env above. This clears ONLY demo-demac-dwellings-test, never the review project.
- Node test suites listed in the review; no existing tests disabled.
- Browser scripts in functions/test-support/dwellingsBrowser.cjs, dwellingsMobile.cjs and dwellingsFieldBrowser.cjs use PLAYWRIGHT_MODULE (or installed playwright), PREVIEW_URL, PREVIEW_CREDENTIALS_FILE and PREVIEW_EVIDENCE_DIR.
- Credentials JSON is local only: office, technician, password. Browser/API evidence omits tokens/passwords.
- dwellingsGatewayCheck.cjs consumes the browser-created booking-result.json; it verifies actual assignment, Storage, registration and report identity. Replays keep equipment IDs stable.

The frontend gateway routes only explicit demo Firebase destinations. CSP limits connections to this origin. Backend factories bind only to local emulators; no Firebase triggers, queue consumers, scheduled workers or external message/billing integration runtimes are loaded. Direct database writes and non-evidence buckets are denied.

## Review route
CRM → DEMO Owner A → Properties → DEMO Garden House → Apartment 1 (or unclassified A/C). DEMO Owner B has a 23-dwelling complex and another simple property. DEMO Owner C has 40 dwellings.
Scheduling → an available BOOK slot → search DEMO Test Lane 100 → Garden House → explicitly choose dwelling → requester/access → work quantity → validate/confirm. Inline Create customer/Add property and Add independent dwellings return to the same modal.
Technician account → Field → assigned Apartment 1 visit → verify access/requester/area. Existing synthetic evidence depicts a placeholder image, never a real customer's equipment.

## Rollout boundary
Read ADR-20260921-property-dwellings.md. No data migration is required for compatibility. Grouping separate existing Properties, classifying old A/C, production deployment and any rule/access changes require a separately approved dry-run/recovery plan. A Draft PR, preview review or design approval does not authorize those operations.
