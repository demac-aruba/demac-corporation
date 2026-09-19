# Projects navigation acceptance: evidence-based oracle correction

## Scope and authority

Owner authorized continuing Projects until merge-ready. Deep Review, Solo Maintainer
Adversarial Review (implementation author; not independent). This increment changes only
test code/CI and this evidence record. No application logic, prefetch behavior, auth, CORS,
Booking/Field authority, project records, production configuration or deployment is changed.
Whole-module release remains blocked by remaining functionality and real recovery gates.

## Reproduced cause, not a speculative workaround

Pinned Playwright v1.57.0 `wkPage.ts::_onConsoleMessage` maps `level=error` console entries
whose source is JavaScript to `addPageError`. That is broader than an uncaught exception.
Primary source: https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/webkit/wkPage.ts

Minimal workflow 35456316850, artifact 10588182994 (SHA-256
5edeabce2e652cd51c501d426792aacb2dc2a88991a72289dbbd3256d45db462), reproduced the
same family with plain native fetch and no ERP/Firebase: pagehide fetches produced
16 WebKit pageerrors and zero DOM uncaught events; a caught CORS rejection produced
one pageerror and zero DOM uncaught events. Deliberate throw/rejection controls produced
both pageerror and DOM evidence. Chromium did not report the handled cases as pageerror.

Full ERP workflow 35464474625, artifact 10590947388 (SHA-256
0a733d98733613b9899f4d92945fa7a1eef028f0e20b4a100fe0897ed006f4a5), supplies the missing
application correlation. Its four raw WebKit diagnostics each immediately follow an
observed exact-URL GET with `rsc=1`, `next-router-prefetch=1` and a segment header from the
SAME departing document. They occur during beforeunload followed one millisecond later by
non-persisted pagehide, then a replacement document starts and becomes active. No DOM error
or unhandledrejection was recorded. This is distinct from a live-page CORS/API failure.
Local analysis of that unchanged archived trace classifies all four as candidates; it does
not retroactively certify the failed run, because active-document probes were absent there.

## Corrected acceptance contract

Replace the unqualified assertion that all Playwright pageerrors are uncaught application
exceptions. This corrects a demonstrated observation error; it is NOT an ignore-list,
skip, retry-to-green, production fix or permission to disregard real network failures.

A diagnostic is retained (never deleted) as departing-document prefetch evidence ONLY when:
- the engine is WebKit, the exact native message/stack URL is the loopback origin and an
  RSC asset path, not an API, arbitrary static asset, external service or other port;
- the nearest lifecycle record is that precise GET with both RSC/prefetch headers, a segment,
  and a departing document identity; one request can account for at most one diagnostic;
- document-start, beforeunload, non-persisted pagehide and a new active document are proven;
  cancelled unload, resumed document, interleaved new document and missing/late evidence fail;
- there are NO genuine DOM errors/unhandledrejections anywhere (even during departure);
- the EXACT referenced asset URL can be fetched with a non-empty 200 body, no redirect,
  from the current active browser document. A failed probe fails the suite.

All remaining pageerrors stay fatal. Every raw event remains in the existing network artifact;
the verdict records indices, document/request identity and active-read proof. The classifier
reruns after probes so new errors also fail. Exception count is cross-checked against the
original raw ledger. The normal application flow, lost-response/reload/exact-replay asserts,
cross-user checks, import preview and protected-collection comparisons are unchanged.

Fifteen deterministic tests cover the valid correlation plus misleading lookalikes, active
pages, other origins/ports, POST/API calls, missing headers, cancelled unload, bfcache,
missing documents, duplicate errors, stale timings, genuine DOM exceptions and failed probes.
Additionally each full browser run deliberately throws AND rejects on a separate blank page,
then verifies that both still fail the new oracle via independent DOM and Playwright signals.
Those controls do not catch or prevent the generated events.

## Separate adversarial review

Reviewed the complete scoped diff after implementation, against exact original script blob
891d0632304dc10a601d82594b3e93e1390cc443 and CI blob
93082cc667cd753148745ac5b87e03e1a51433da. No operational writer or application file changes.

Challenged cancelled beforeunload, a real thrown error with the same text, an API failure,
wrong port, pagehide from another document, reused evidence, duplicate messages and a 404
asset after reload. All remain blocking. Positive browser controls are mandatory in both
engines and failure artifacts retain the original raw network/exception data. The loopback
boundary deliberately prevents using this exception to dismiss production diagnostics.

Local Node 22.16.0: syntax checks and 15/15 classifier tests passed, zero skipped. Exact-head
CI/browser outcomes must be recorded in the PR checkpoint; this file does not pre-claim them.
No local browser execution or production access was used as evidence.

Residual limitation: this is pinned Linux browser-test behavior, not real iPhone/Safari or
deployed TLS/CORS certification. The 250ms document-lifecycle correlation intentionally
fails closed outside the proven pattern. It does not establish that all browser network
errors are harmless, or that the entire Projects release is complete.
