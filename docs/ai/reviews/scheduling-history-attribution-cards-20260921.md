# Scheduling review — incomplete delivery; release blocked

## Review mode

Solo Maintainer Adversarial Review. Builder and reviewer: Codex, separate implementation
and adversarial passes. This is not an independent review or approval for publication.

## Scope reviewed

Compared the complete task diff against active ERP web source `a053bb1f`, plus direct
callers in the create/details/overview components, canonical Work Order projection,
attribution transport, auth provider, scheduling moves, capacity and current Project bridge.
Booking Authority, identity, OPS-SCHED/TEAM/SVC and communications remain unchanged.

## Findings

| Severity | Evidence and impact | Resolution |
| --- | --- | --- |
| High, open | Projects and phase linkage live only in browser-projects storage; Office requests contain generic Other plus free text. No server project/phase membership check or cross-session link. | Historical project enablement and authoritative Project card identity remain blocked. Do not invent a registry or infer identity from notes. |
| High, open | Historical capacity provider reads current Vans/settings/crew with dated override fallback; missing override is not proof of historical regular crew. | Historical write requirements not established. No enabling of the Project backdating guard. |
| High, open | Next config defaults to production Firebase; Vercel web Firebase project configuration targets both preview and production. No independently verified hosted isolated backend/storage/communications contract. | No application preview deployed. Git deployments disabled for this task branch only; production configuration unchanged. |
| Medium, resolved | Generic attribution failure handling initially preserved names even after an explicit backend permission denial. Concurrent deduplicated readers could lose that denial if invalidation was raced. | Authorization denial propagates to all current waiters, cache is invalidated, metadata is cleared and principal is revalidated. Unit + browser negative case added. |
| Medium, resolved | A single-service primary Work Order contains only its Van quantity; using it for whole-appointment details undercounted split bookings. | Details aggregate the appointment quantity; each card overrides with its assignment quantity. Seven total / four primary / three support regression added. |
| Low, resolved | Unknown historical quantities and technical durations could inherit generic fallback values. | Presentation requires quantity/duration evidence; no artificial unit or service-work estimate for unverified/manual work. |

## Verified

- `npm run typecheck --prefix apps/erp-next`: PASS.
- `npm run build --prefix apps/erp-next`: PASS, with explicit synthetic Firebase build
  configuration and telemetry disabled; normal prebuild checks ran without skipping.
  Prebuild covered employee schedule/attendance/Work Order interpretation, Vans, Projects
  browser-state contracts and Task Tracker. These are automated simulations, not live data tests.
- `npm run test:live-scheduling --prefix apps/erp-next`: PASS, including new attribution
  and card projections; existing capacity/lunch/closure/Saturday/move cases preserved.
- `npm run test:dispatch --prefix apps/erp-next`: PASS (conflicts, route buffer, support,
  workday boundary, delay, departure, lunch capacity and support recovery).
- `npm run test:lifecycle --prefix apps/erp-next`: PASS (edit, move, cancel, reschedule,
  Work Order synchronization and primary/support behavior in existing simulation).
- `node --test functions/bookingAuthorityWorkOrders.test.js functions/bookingAuthorityFirestore.test.js`:
  18/18 PASS, 0 skipped. In-memory backend doubles cover existing transactional replay,
  conflicts, backdating acknowledgement/audit and communication suppression. They do NOT
  prove historical Projects are implemented or provider integrations are isolated.
- `scheduling-refresh-browser.cjs`: actual React view/cache/projection with synthetic
  read adapters in Chromium, 1440×1000 and 390×844. Each view observed for 90 real seconds:
  900 samples, 11 operational loads, four attribution loads, zero external requests.
  Initial and subsequent card heights stayed unchanged; names persisted through failure,
  expiration and focus refresh. Additional cases: range changes, late cancelled data,
  session switch, explicit backend permission denial and unmount. No browser errors.
- Browser evidence includes the actual Scheduling shell/readability CSS and both
  full-day multi-Van and one-slot blocks. Very long attribution text has a fixed-height,
  keyboard-focusable scroll region and full title; no hidden/clamped text is discarded.
- CI YAML, browser script syntax, branch deployment JSON and diff whitespace: PASS.

## Acceptance status

| Requested cases | Status |
| --- | --- |
| 1: historical Project cancellation + two-slot correction + durable Project link | BLOCKED: missing canonical Project/phase and historical authority |
| 2–5: Project permission/conflict/idempotency/silent integrations/no payroll effects | NOT RUN end-to-end; existing non-Project backend regressions pass only in memory |
| 6–8: attribution stability, failures, expiry, focus/week/session and stale result races | PASS at unit/component-simulation level; no live Firestore browser test |
| 9: two Vans, six slots each, correct reservation end | Slot/window/manual-estimate portion PASS in synthetic projection/browser; Project name/phase remains BLOCKED |
| 10: partial two-slot Project | Slot projection PASS; historical Project workflow remains BLOCKED |
| 11: ordinary + mixed-service meaning/quantities | PASS automated projection; no live customer test |
| 12: creation/edit/move/cancel/capacity/multihour/partial/lunch | Existing focused simulations PASS; complete isolated integrated acceptance NOT RUN |

No backend changes, rules changes, migrations, attendance/payroll/billing records, provider
messages or production data mutations were performed. Deployed frontend revisions were
confirmed through Vercel; active backend source is still unverified. No gate was weakened.

## Decision

BLOCK / incomplete owner request. The attribution fix and bounded card corrections are
reviewable in Draft, but do not qualify as the requested complete three-flow delivery.
Do not merge, auto-merge, deploy or repair production data. Resolve the authority and isolated
preview blockers, finish acceptance, and obtain separate owner publication approval.

## Safe review walks (component simulation only)

1. Historical Project: inspect the documented disabled control/selection guard and the
   browser-only link implementation. No write walkthrough is available; case remains blocked.
2. Attribution: run the browser script with isolated absolute tooling/output directories.
   It opens desktop/mobile contexts and performs 90-second refresh/failure/session scenarios.
3. Cards: inspect synthetic six-slot cards (08:30–16:30), one-slot service and automated
   two-slot/mixed-service cases. Other is not relabeled Project without canonical evidence.

The component harness uses no real Firebase backend and is not offered as the required
functional preview. Future release/rollback plan is in the linked task record.
