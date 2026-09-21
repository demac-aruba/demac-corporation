# Central Projects: reproducible lost-response verification

## Scope / authority

Bounded continuation on `feature/projects-canonical-integration`, after repeated interrupted
conversation turns. This checkpoint changes test harness code only, plus its contract tests
and CI invocation. No operational component, registry writer, auth, CORS/rules, customer,
appointment, Field report, migration, default-off flag or deployment path changes.

## Evidence and correction

At head `5194bb3`, run `35399151388` failed while waiting for the pending-operation banner.
The displayed response was already the recovered receipt at version 5. The one-shot socket
fault stopped affecting responses after the first commit, so a repeated transport request
could recover before the test observed the deliberately ambiguous state. The trace does
not identify every browser transport decision; this is not evidence of a production outage.

A test-only scoped fault now persists for the exact project command until explicit test
release. Headers and a deliberately truncated body exercise response consumption failure.
Every successful intercepted receipt must refer to the same exact payload/request ID and
version; only one may represent a new commit. Repeated receipts must be replays.

The browser sequence now additionally verifies the server commit while the UI is uncertain,
compares the exact per-user pending journal before/after reload, checks new writes are
blocked, then releases the fault and explicitly retries. Recovery must clear the journal
only after a verified acknowledgement and must not increment the project version again.
This helper is never imported by the application or deployed backend.

## Separate adversarial self-review

Reviewer: implementation author, ChatGPT; not an independent review. Compared the exact
baseline blob and edited harness. Existing Chromium/WebKit, role, stale-version, import
preview, cross-user, mobile, zero-page-errors, external-network and protected-collection
assertions remain in force. No exceptions are filtered, tests skipped or failures waived.
Test fault invariants have their own negative tests (mutated request, duplicate commit,
wrong version, premature recovery) plus a real loopback HTTP failure/replay contract.

Local Node 22.16.0: four helper tests passed, none failed/skipped; harness syntax passed.
Full ERP/Auth/Firestore/browser results are pending CI at commit time; record exact-head
results in the PR before claiming this checkpoint complete. Network isolation and emulators
remain mandatory. A passing checkpoint is not whole-module release approval: automatic
Scheduling handoff, Field actuals, planning/cost parity and real backup/recovery are pending.
