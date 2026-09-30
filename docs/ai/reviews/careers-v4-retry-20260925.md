# Careers V4 retry: isolated integration and readable review notice

## Authority and scope
Continue PR 527 from 11a82a0e on its existing feature branch. Candidate confirmation,
classified private files, reviewed policy and original snapshots are already in that head.
The internal mailbox remains deferred by Christian. No merge, real mail, production
configuration/data, auth or security rule change is part of this increment.

## Observed failure and correction
Artifact 10862020068: Chromium completed the journey; WebKit reached the final review
but showed the actual 429 rate-limit message instead of the intentionally injected 503.
Both browser engines and their independent candidates used one hardcoded loopback
request identity. They accumulated more than 30 requests in one rate window.

The local emulator adapter now maps separately registered browser contexts to distinct
RFC 5737 documentation identities. The marker exists only between the controlled test
browser route and loopback HTTP adapter. It is not used by the deployed handler or
Firebase authorization. Unknown markers are rejected. No threshold or clock in the
browser journey was relaxed. Exact production rateLimit tests retain 30 allowed requests,
31st rejection, independent clients and next-window recovery; Firestore coverage includes
concurrent competitors for the last permitted request. The deliberate failure case now
requires HTTP 503 and connection-error, not merely a matching alert.

The review email notice used display:flex with three anonymous text children, producing
narrow columns in the failing mobile screenshot. One inline-flow child now keeps the
unchanged prose and email together. The real-browser screenshot helper asserts readable
paragraph width in addition to the existing overflow and success assertions.

## Separate adversarial self-review
Solo Maintainer Review, not independent review. Checked production http.js and service.js:
no public bypass header, changed limit or altered authentication. Registered metadata
is attached only to the loopback test API, not external origins. Existing CORS, route
isolation, zero-page-error, immutable answer/file and no-duplicate assertions remain.
Server callback references the client registry only after initialization and listen.
Test source/context data contain only generated test identities, not user credentials.

## Verification status
213 focused non-emulator local checks PASS, 0 FAIL, 0 SKIP. Next typecheck PASS.
A first local build failed because cached dependency symlinks crossed Turbopack's root;
real local dependency directories replaced those symlinks, without a repository change.
Final compilation and exact-head Firebase/browser verification must be completed and
recorded in PR 527 before calling this increment verified. Production mail/scanner and
physical-device checks remain NOT RUN; hosted persistent staging is not asserted here.

Rollback: revert this scoped commit; do not delete saved applications, snapshots or files.
