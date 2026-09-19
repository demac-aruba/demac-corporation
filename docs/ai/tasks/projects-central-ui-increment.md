# Projects central UI and transport increment

Owner instruction: continue Projects implementation, clean architecture, no release until
whole-module safety/functional work is complete. Branch: feature/projects-canonical-integration.
Deep Review applies; this increment is not permission to merge, deploy, activate or migrate.

## Scope

Connect an isolated `/projects/central` workspace to the existing registry service through
one HTTP transport boundary. Keep `/projects`, its browser records, Scheduling and Field
operational writers unchanged. The new route defaults off via the build-time flag and
requires existing Projects capabilities; server-side provisioned roles remain authoritative.
No new roles or Firestore rules, Functions bootstrap/export or production deployment job.

Implemented UI flows: paginated shared records; create/edit planning; custom phases;
existing-appointment reconciliation; canonical Work Orders/visits/review evidence;
identity-preserving import preview/application through the prior guarded registry commands.
Import has a separate UI flag plus the prior service/runtime/server owner checks. Selecting
a file never uploads it automatically; only an explicit preview sends the selected record.

An original capture is not a verified cloud backup. Archived source is not certified actual
labor or phase completion. Page subtotals are not portfolio/project totals. Partial/missing
measurements remain unknown, and failed loads are errors/stale data, never a clean empty state.
Budget overruns stay advisory and no baseline is silently increased to hide variance.

## Boundaries

`registry-http.js` is an adapter around the existing registry service, with exact-origin
CORS, Bearer input, bounded JSON, no-store responses and redacted structured errors. It
initializes no Admin SDK and exports no Cloud Function by itself. It has no independent
write rules or own identity store. Server activation remains default-off.

The client reads the existing authenticated session without renewing, deleting or changing
it. Expiry is explicit. Pending writes use one immutable serialized command and stable ID;
ambiguous outcomes block new writes until explicit same-request retry. A user-scoped session
journal retains pending intent across refreshes. It contains the submitted draft, including
private project content where needed, but NO authentication tokens. It is not an offline
queue, automatic writer, permanent local Project source, or source of execution truth.
Closing the browser session can discard sessionStorage: unresolved outcomes then require
server-side reconciliation, never blind replacement. A failed journal write prevents sending.
Known successful results are not recategorized as a failed save merely because a later read
fails. Account/role changes unmount old response and form state; late responses are ignored.

Existing CRM reference loader is reused only when creating a plan. This retains its known
full-reference-read limitation; it is not claimed as a new paginated CRM search or measured
performance improvement. Lists/activity are bounded at the registry boundary; no per-row
activity fan-out is initiated by the portfolio UI. No polling is added.

## Acceptance and verification

Required: typed DTO/build checks; client retry/session/journal tests; HTTP allow/deny/error
redaction; actual React/browser -> HTTP adapter -> authenticated registry -> Firestore emulator
flow; two browser engines/mobile; negative privileges, stale versions, lost response/reload,
read-only import preview, protected operational sentinels. All fixtures must remain synthetic
and all external browser HTTP must be intercepted. Verify final results in PR comments;
this initial task does not pre-claim a passing result.

## Remaining whole-module gates

Automatic Booking Authority context and atomic handoff are not complete. Do not replace
live Scheduling's Project picker with central data before that is complete. Field measured
time/physical progress and stock/finance-derived cost views, template parity, phase lifecycle,
real original-browser backup/restore rehearsal, actual historical reconciliation and production
activation/deployment review remain required. The current UI intentionally labels these limits.
