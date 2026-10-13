# Review: Automatic booking forecast and actual work

## Review mode
- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review
- Reviewer: `/root/projection_review` (separate agent; no implementation edits)
- Builder: `/root`
- Base: 6689c6f2; branch fix/automatic-booking-projection
- Request/acceptance: ../tasks/automatic-booking-projection-20261013.md
- Authorities/rules: Booking/Pricing/Appointment finance, OPS-SCHED-CHARGES-001/002.

## Findings and corrections
| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Legacy explicit quotes would change purpose at commit and reject unchanged quote tokens | Explicit legacy purpose remains final; new projection marker is optional and fingerprint-bound; regression test passed |
| Medium | Historical agreed estimate identities/prices unavailable from an empty actual-work editor | Explicit Use scheduled work preserves existing line identity and agreed price for review; browser test passed |
| Medium | Malformed catalog tier/currency could throw and abort automatic booking | Validated shapes/currency/ranges; invalid configuration remains unpriced; regression passed |
| Medium | Receipt save discarded work draft; void could stale a simultaneous payment draft | Preserve both drafts across only the exact matching own version increment; later replay states never rebase silently; real frontend/facade tests passed |
| Low | Existing fixture appointment counts included new audit subcollections | Count top-level appointment documents and separately require exactly one charge event; idempotency assertions retained |

Reviewer final decision: ACCEPT, no blocking code findings. Reviewer independently ran
50 pricing/charges/editing tests, all passed, zero skipped. Neutral historical forecast copy
is present. Builder completed remaining browser/build gates after that review.

## Verification
- `npm run validate:firebase --prefix functions`: PASS. Explicit node syntax checks on appointmentCharges.js and new appointmentProjectionPricing.js: PASS.
- Charge/pricing/editing suites: 50 PASS, zero skipped. Includes minimum-vs-final isolation, legacy quote compatibility, invalid config, exact retries, authorization and lease conflicts.
- `npm run test:booking-authority --prefix functions`: 239 PASS before adding the dedicated automatic ordinary-booking test; final bookingAuthorityFirestore.test.js rerun: 15 PASS including that new test. Counts overlap; they are not additive.
- Actual loopback Firestore emulator (`demo-demac-charges`, no production credentials): 8 PASS, including atomic automatic minimum forecast and unknown-BTU final rejection.
- `appointment-charges-browser.cjs`: PASS at 1440×1000, 1366×768 and 390×844. Real components/transport/HTTP facade over synthetic transactional DB; all external requests blocked. Automatic minimum preview, deposit, actual service search/BTU, product add/remove, fractional quantities, receipt save + void while work draft survives, partial cash/POS/SUAVE, lost-response exact retry and history verified.
- `appointment-charges-loading-browser.cjs`: 37 PASS; read errors, stale responses, historical agreed estimate import, role/hold/cancellation restrictions, lease expiry, drafts/version conflicts, catalog failure/retry and search tested. With 1,000 catalog items/60 lines, local typing made zero authority/network requests; 40-result cap held.
- `npm run typecheck --prefix apps/erp-next`: PASS.
- `npm run build --prefix apps/erp-next`: PASS on final source. Build-owned tsconfig/next-env edits restored; no project configuration changes retained.
- Desktop/mobile screenshots reviewed; no page horizontal overflow. Synthetic evidence is in ../evidence/automatic-booking-projection/.
- React review: hooks unconditional; quotes ignore stale responses; search input labelled, keyboard Escape scoped; queries run in background; results bounded and local; server owns all prices.

## Decision and residuals
- [x] Pass
- [ ] Block / changes required

No production access/write, migration, QBO posting, invoice creation, inventory movement,
or live deployment occurred. Historical appointments with no projection are not backfilled.
Existing explicit legacy clients keep their old workflow until reload. Backend deployment
must precede frontend and verify every changed Booking Authority runtime consumer.
Once marked forecasts exist, recovery must preserve the projectionOnly final-pricing guard;
never roll back to a backend that can retain a minimum as a final price.

The owner explicitly authorized merge and deployment after the requested audit on 2026-10-13.
CI/production release evidence remains separate from local/emulator results.


## Production audit and release scope — 2026-10-13

- Read-only run38333372167, artifact11784136018 inspected Office, Project and both
  customer-agent runtime packages. Source, runtime settings, IAM and active traffic
  were verified without customer reads or production data writes.
- The exact live Office package passed100 baseline tests and107 candidate tests
  with its unchanged dependency lock and actual bootstrap smoke. The candidate
  differs in only appointmentCharges.js, bookingAfterHours.js and the new
  appointmentProjectionPricing.js. Recovery must preserve projectionOnly.
- This release covers Scheduling/Office booking, including normal booking,
  temporary holds, overtime and follow-up. Project historical imports and the
  customer-agent runtimes have older booking code without financial integration;
  they remain unchanged. Their automatic projection coverage is not claimed.
- Project's deployed package has no dependency lock. No Project update is part of
  this release; rebuilding that historical runtime would require separate review.
- The ordinary Office full-source workflow and prior finance activation workflow
  are not suitable: they can replace unrelated runtime code or saved settings.
  The controlled release patches only buildConfig.source, retains private ZIPs,
  verifies operation provenance/traffic/configuration/IAM and checks both domains.
- New main8b131db0 adds QuickBooks legal documents only; integrated before final CI.
- Broader CI exposed two stale test assumptions: booking BTU/manual projection
  inputs and collection counts including subcollection audit documents. Updated
  those scenarios to verify automatic tariff refresh, payment-note exact recovery,
  one saved appointment and one projection audit event. No test skipped or waived.
- Final local checks:32 booking-modal cases,18 previous/current-client cutover
  cases,15 independent booking-capacity cases and19 release/transport tests PASS.
  Earlier failed CI remains historical evidence; final head must pass before merge.
- Production authentication workflows are verified with synthetic data and real
  Firestore emulator transactions. Live smoke tests use public pages, assets,
  CORS and anonymous authorization denial; they do not create real test records.
