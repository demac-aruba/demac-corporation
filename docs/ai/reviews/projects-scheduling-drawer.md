# Adversarial self-review: Scheduling drawer / central Projects

Mode: Solo Maintainer Adversarial Review, by ChatGPT, not an independent review.
Reviewed the exact source snapshot from ee56f5c against local hashes before editing. Original
source archive checksum was verified. Temporary source/workbench tooling must be absent from
the final feature diff. No production backend/access/activation changes belong here.

## Findings resolved in implementation

- Do not adapt a central record into the full legacy BrowserProject: that would invent actuals.
  Use a narrow selection shape; keep the legacy budget plan separate for PR #515 compatibility.
- A six-hour work line can allocate additional support Van time. Forecast the sum of every
  selected assignment's minutes, not just the primary work-line duration.
- Never equate partial first-page activity with total commitments. Unknown coverage stays unknown.
- Imported slot duration must survive centralization; preserve its validated scheduleEstimate,
  rather than unconditionally changing 30-minute planning slots to 60 minutes.
- A post-success browser link recreates the original split-write defect. Central success verifies
  the atomic receipt, never calls the local Project mutation, and refreshes the existing agenda.
- Losing an acknowledgement must not enable another booking. The per-user exact intent persists
  through refresh and blocks replacements until explicit verified retry. Auth errors alone do
  not prove absence of a preceding commit. Cleanup errors retain the same command.
- Extra object properties must not be spread into a recovery record. Only command/expectation
  are serialized. Malformed or foreign-user records remain preserved and cannot be submitted.
- Check current session user and permissions before and after network completion; late responses
  for a changed actor must not update the visible drawer. Closing does not cancel a committed write.

## Verification and residual limits

Fourteen focused actual-client tests pass locally on Node 22.16.0 using TypeScript transpilation;
full types remain a separate CI gate. Initial broad-fixture tests exposed overbroad object spread;
fixed serialization instead of weakening strict record validation. Syntax checks cover every
new/changed TypeScript file. Browser/emulator and combined-runtime results must be recorded on
the exact published source head before claiming this increment validated. Required assertions
and existing gates are not skipped or weakened.

New booking and registry flags default off. The operational code changes only the existing
frontend drawer/recovery callback and preserves structured Office error metadata on Error
subclasses. Existing privileged writers, availability, capacity locks, notifications, actual time,
CRM identity, financial and inventory authorities are not rewritten.

Remaining: close all CI/browser findings; central Field/lifecycle/template/cost parity; actual
backups and historical reconciliation; deploy/activation review. A green increment is not a
whole-module release approval. SessionStorage can be lost when a browser session ends, so an
unresolved result then requires server receipt reconciliation, not recreation from memory.
