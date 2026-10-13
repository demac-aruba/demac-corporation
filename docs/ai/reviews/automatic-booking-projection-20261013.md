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

Production publication remains subject to explicit owner approval in AGENTS.md. CI/production
release evidence is separate from these local/emulator results.
