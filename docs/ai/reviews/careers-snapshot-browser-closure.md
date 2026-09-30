# Snapshot browser closure: evidence, not transport substitution

## Scope and authority
Continue the authorized original-submission block on the Careers feature branch.
No changes to runtime source, stored evidence, permissions, mail or production.
This is a separate Solo Maintainer review by the same implementer, not independent.

## Observed failure
At ec16ba4e and 7f783b33, canonical submission/read/reload and original-answer DOM
assertions succeeded. Diagnostic artifact 10844450647 showed Chromium HEAD fetch
failure events AFTER actual HTTP 200 text/html metadata; page errors were empty.
The strict all-requestfailed assertion added during recovery conflated these
bodyless metadata events with failed application operations.

The 71aac6d1 test-only HEAD forwarding experiment removed Content-Length while
preserving real upstream status. Artifact 10844041461 still reproduced the same
events. That hypothesis was refuted: the adapter and its now-unused transport
unit tests are removed, not retained as another compatibility patch.

## Corrected verification contract
Do not intercept, rewrite, replay or fulfill any request differently. The installed
Next 16.2.11 static-export source awaits HEAD metadata and then fetches the exact
route's __next._tree.txt. Count a Chromium bodyless metadata event as consumed ONLY
when its actual same-origin HEAD/fetch response was HTTP 200 text/html, the driver
reported exactly net::ERR_ABORTED, AND the same phase completed the actual GET 200
for that precise route tree. Record every raw event and its corroborating tree.
All other errors remain failures, including GET/POST/API/asset interruption,
HEAD without headers, HEAD rejection, wrong origin or absent/failed route tree.
The final assertion is zero unresolved operation failures, not a claim of zero
raw driver events. Zero page errors and every snapshot, authorization, private
file, draft and duplicate-prevention assertion remain mandatory.

## Adversarial checks
27 audit tests include all failure exclusions, mismatched phases/routes/origins,
HTTP 404/503, incomplete proof, mixed accepted/failed events and unchanged raw
records. They replace only tests for the discarded transport experiment, not any
product gate. Combined existing 141 contracts plus these 27: 168 PASS locally,
0 FAIL, 0 skipped. Syntax/diff checks pass. Actual browser verification at the
new pushed commit is still REQUIRED; no result is inferred from these unit tests.

## Residual boundaries
This does not certify every browser/network failure as harmless, nor change Next
or production servers. New uncorroborated events still fail. Final CI evidence is
recorded in PR #527 after execution. Mail, approved privacy, categories, persistent
owner staging, complete visual acceptance and production approval remain separate.
