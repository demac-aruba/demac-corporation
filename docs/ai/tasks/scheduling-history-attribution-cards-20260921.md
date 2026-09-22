# Scheduling history, attribution and card meaning

## Context and scope

Owner request: correct historical project bookings, attribution flicker and reservation
card meaning. Deep Review: permissions, historical truth, async concurrency and recovery.
Scope is ERP Next Scheduling and its direct Booking Authority dependencies. The original
request prohibited merge/deploy. After the incomplete scope and main conflict were explained,
the owner explicitly authorized resolving conflicts, merging and deploying the available
corrections. No dwellings, production data repair, new authority or historical Project write
has been authorized or implemented.

## Authorized integration and bounded release

Integrate with `main` while preserving its accepted manual-move overtime code. The merge
uses the existing `[merge-only]` mechanism so it cannot publish unrelated pending frontend
or backend changes. The production candidate is the previously reviewed and green-CI
`8a852d81d783c78a0838b4dc1efd161948b96600` tree based on deployed `a053bb1f`.
It contains attribution and bounded card-presentation fixes only, with no overtime release.
Build that exact tree using the existing ERP web project's production configuration, stage
without domain promotion, inspect it, and promote only after integration checks and merge.
Keep `dpl_DS6LepFpsKzBUdQ2Qm4AVxPDXyPk` as the frontend rollback artifact.

This changes release authorization, not the original feature completion status: historical
Projects and authoritative Project/fase labeling remain blocked. No complete isolated
three-flow preview or integrated Project acceptance is claimed.

## Baseline evidence (2026-09-21 Aruba)

- Vercel `demac-corporation-web.vercel.app`: READY production deployment
  `dpl_DS6LepFpsKzBUdQ2Qm4AVxPDXyPk`, source `a053bb1fa46eb116ea67f0cbe12f5b81b31e0a2b`.
- Separate `demac-corporation.vercel.app`: READY production deployment
  `dpl_7RiRCRrbfxhmfzsFQFBLWCcJbpxw`, source `cb01c4696a3a35dbc23c9989bc54473fa67356b5`.
- Remote main was `dbc65e2f0d3f70da839ca2195d3b8735a8beec32`. Its tree includes the
  pending manual-transfer overtime implementation absent from the active web deployment.
- Task branch starts at `a053bb1f`; independent clone preserves all other workspaces.
  No merge-only commits or pending overtime/dwellings changes are incorporated.
- Firebase deployed function source has NOT been independently confirmed. Repository
  analysis is not a claim that all backend functions share the frontend revision.

## Authority and rule mapping

Booking Authority owns Appointment/Work Order/locks. Firebase roles own access.
OPS-SCHED, OPS-TEAM, OPS-SVC and communication suppression remain mandatory. UI caches
are read projections only. No payroll, attendance, invoice or execution writes are in scope.

## Historical project write blocker — correction 1 is NOT implemented

The active source `browser-projects.ts` loads/saves `demac.erp-next.projects.preview.v1`
through browser storage. `linkProjectSchedulingAssignment` modifies that state, after the
canonical booking has already committed. The create drawer submits a manual `Other` work
line and textual notes, not a validated project/phase relation. Office Booking Authority
does not read a canonical Projects registry. Cross-session persistence, phase authorization
and atomic link recovery therefore cannot be promised by enabling the button.

Both `disabled={backdatedTarget}` and `chooseAppointmentSource` explicitly block the
historical project path. The initial one-hour block is NOT itself a confirmed limiter in
this baseline: `optionMatchesTarget` compares date/start/primary Van, never `target.end`.

`bookingAuthoritySchedulingProvider.loadSchedulingData` reads current Vans, staff,
business settings and half-day schedules, with dated overrides/absences. In the absence
of a dated override, `resolveAssignment` falls back to the current regular crew. That is
not sufficient evidence of historical capacity under the requested contract. Enabling
the write would require approved canonical project/phase authority and a proven historical
calendar/crew resolution contract (or an explicit missing-history rejection).

No new registry, parallel truth, automatic historical data repair or synthetic production
records have been created. The owner was asked whether an existing approved backend/branch
provides these authorities. This is an authority blocker, not a request to approve an unsafe
booking. Do not count this issue as fixed or its acceptance cases as passed.

## Implementation and verification plan

- Correction 2: session-owned expiring/deduplicated attribution cache; retain known values
  during fast refresh; apply only creator metadata onto current records; invalidate late
  work on range/session/unmount/local mutation; reserve stable attribution layout.
- Correction 3: preserve service-line evidence and assignment-specific capacity; suppress
  quantity/technical estimates where their semantics are not supported. Project naming and
  cross-session identity remain blocked by the missing canonical relation above.
- Run ERP typecheck/build (including existing prebuild gates), scheduling/lifecycle/dispatch
  regressions, new focused tests and real-duration browser component simulations. Clearly
  distinguish adapters/simulations from actual Firebase integration tests.
- Fresh separate Solo Maintainer Adversarial Review; no independent-review claim.

## Preview boundary and future publication

The active Next config defaults to production Firebase. Never deploy that default build as
an isolated preview. A functional acceptance preview needs separate Auth, Functions,
Firestore, Storage, deny-external-egress communication adapters and synthetic fixtures.
No currently proven isolated hosted backend is assumed. Browser component simulations do
not satisfy the requested three-flow functional preview or cross-session backend tests.

Before completing the original Project workflow: resolve the authority blocker, verify deployed backend source,
finish all acceptance cases in an isolated environment, review the final exact diff against
the then-current production tree, obtain owner approval, and deploy through the governed
release process. Roll back frontend by restoring its prior deployment; any later backend
release needs a compatible previous artifact and replay-safe recovery. No migration is
part of this task. Do not release incomplete project writes.
