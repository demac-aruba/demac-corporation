# Careers V4: complete the test-client preflight boundary

## Evidence and scope
Continue the existing PR 527 from 7a5bf155; do not reconstruct the delivered runtime.
The current CI log (job 108127830689) confirms Chromium's complete workflow passes.
WebKit cannot save its first draft because the loopback test adapter resolves an
unregistered identity before the production HTTP handler can process CORS OPTIONS.
The earlier rate-budget isolation remains necessary and is not reverted.

## Correction
Only browser-generated OPTIONS receives a loopback placeholder in the test adapter.
The unchanged production handler still checks the original Origin allowlist and
returns its original 204/preflight headers before service, auth or rate-limit work.
POST and every other method still require a previously registered test identity.
No public bypass, new allowed header, access rule or altered rate budget is added.

## Separate adversarial self-review
Solo Maintainer Review, not independent. Check both public/admin preflights, forbidden
origins, absent/invalid POST markers, distinct registered identities and the unchanged
30-request boundary. The existing complete browser journey, page-error assertions,
private-file ownership, immutable snapshots, prepared-mail sandbox and uncertain
submission recovery remain required. Do not treat passing unit tests as browser proof.

## Verification
Local focused tests: 219 PASS, 0 FAIL, 0 skipped; script syntax and diff checks pass.
Exact-head CI/browser/build artifacts must be checked after publishing this correction.
The internal mailbox remains deferred; no real mail, production activation or merge.
Hosted persistent staging and owner visual acceptance are not certified by this fix.
Rollback is a coherent revert of this test-only correction, with no data operations.
