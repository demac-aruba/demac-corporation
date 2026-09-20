# Projects merge readiness — 2026-09-20

## Decision and exact source

**Full requested delivery is not ready for merge/publication.** The authorized local
implementation and isolated integration work below is complete and reviewable; missing
source decisions, staging and real recovery gates have not been waived. No push, main/PR
merge, deployment, activation, permission change, migration or real-data write occurred.

- Continuation: `feature/projects-completion-audit-20260919`, based on #514 at
  `a99402ece30f7042105daea1feac8d34174b1453`.
- Application HEAD: `0fd500fbe2363fcfc091688d7432aa8fd1a53ba0`.
- New commits: `56795766` (lifecycle intent, recovery, atomic remaining-work association)
  and `0fd500fb` (preserve per-line text when editing scope).
- Previous application commits `9ab34aae`, `70a83eef`, `27458a10` remain included.
- #515 stays separate at `3622bc5a4871b6ce7019af02f7354a5cc23171ee`.
- Disposable local integration used `git merge --no-commit --no-ff` of #515 into
  application HEAD; no conflicts. Exact combined tree:
  `e464d4dc138a94aaeea75d3fbc955b5651e58b0c`. This is an actual checkout/build/runtime
  verification, not only merge-tree analysis. No remote branch was advanced.
- Main reference remains `cb01c4696a3a35dbc23c9989bc54473fa67356b5`. Remote #514/#515
  were still draft/open/unmerged. The 15 passing remote workflows at a99402e are historical;
  local continuation checks must not be represented as new GitHub check runs.

## Closed defects and authority

Booking Authority now binds availability to the observed canonical appointment token,
actor, appointment and change kind. Both preflight and commit revalidate that binding.
Cancellation requires the observed token. Stale offers, altered availability under the
same lifecycle key, retagged create/hold offers and terminal primary/support work fail
before writes. Existing availability, identity, crew and capacity rules still apply.

Atomic actor/request/payload receipts in existing bookingIdempotency allow exact committed
cancel/reschedule recovery before checking a now-closed offer or later appointment state.
Recovery returns the current appointment without another mutation or notification request.
Same key with different intent rejects. These guarantees also cover concurrent retries.

Actual edit, reschedule and cancel callers persist the original command before transport
in a UID-scoped session journal. Invalid/mismatched acknowledgements and lost responses
retain the command; reload retries it exactly. Authentication changes before/after calls
cannot clear another user's journal or overwrite the current Firebase session during
token refresh. Failed storage prevents the write. A successful commit is not treated as
failed merely because refreshing the parent screen failed.

The same canonical GET supplies visible scope and its concurrency token. Cleared text
is not restored from the stale board. Reschedule preserves each work line. Edit preserves
each description/instruction until that shared field is explicitly changed; distinct
original line text is protected when adding scope. Legacy generated descriptions update
when quantity or work type changes. UI explains when an edit applies to all lines.

Remaining-work scheduling now derives Project/phase from the original canonical link,
binds source partial-outcome revision, and atomically writes the original consumed outcome,
follow-up appointment, primary/support Work Orders, locks, Project link/event and receipt.
There is no second post-booking link transaction. Ordinary follow-ups still work with
Projects off. Exact replay verifies source/link provenance and current authorization;
legacy incomplete provenance fails closed for reconciliation. No historical repair ran.

The production Office facade and partial wrapper share the same Booking instance and
Project adapter. PROJECTS_REGISTRY_ENABLED still defaults off. Projects HTTP/registry
remains intentionally unexported from Firebase bootstrap/index; deployment integration,
explicit origins and activation must be completed under the release gate, not inferred
from emulator adapters. No claim of deployed central adoption is made.

Operational move now updates appointment/assignment/Work Order capacity-end fields to
the actual owned slots, including lunch gaps. Recorded work end remains separate.
Activity accepts canonical scheduledSlots arrays as well as supported integer counts;
it does not infer execution time. Earlier immutable Field Van attribution and exact
optional AWG planning-budget fixes remain in force.

## Final isolated verification

Node 22.23.2 is the Functions target. Next 16.2.11, Playwright 1.57.0,
firebase-tools 15.30.0 and Java 21 stayed unchanged. Combined ERP builds also passed on
Node 24.18.0, matching the current Vercel ERP build setting. No manifest/lock update.
Both task-installed binaries removed during the previous disk incident were restored.

| Check | Result and boundary |
|---|---|
| Full ERP build | PASS on combined tree, Node 22 and 24, including all six existing prebuild suites |
| ERP typecheck | PASS; generated Next config restored after builds |
| Firebase source validation | PASS on Node 22 |
| Projects units | 202/202 PASS on combined checkout |
| Projects + affected lifecycle/partial/facade contracts | 290/290 PASS on Node 22 |
| Booking Authority regression | 163/163 PASS |
| Field Authority | 354/354 plus 47 pretest scenarios PASS |
| Transactional WhatsApp | 117/117 PASS; no real delivery |
| Operational move | 9/9 PASS, capacity end 16:30 and lunch-gap 14:30 asserted |
| Combined budget / phase planner | 20 budget cases PASS; phase planner acceptance PASS |
| Lifecycle journal / Booking journal / handoff | 13 / 14 / 18 PASS respectively |
| Combined real Auth/Firestore | 70/70: registry24, import18, Booking bridge11, public facade3, client handoff3, Field execution11 |
| Combined central browser | Chromium/WebKit PASS; real HTTP adapter + Auth/Firestore, 390px, revision, stale state, lost response/reload/exact retry, pause and cross-user reads |
| Combined Scheduling drawer | 18/18 Chromium/WebKit; real client and Auth/Firestore, deterministic capacity-provider fixture |
| Combined lifecycle browser | 20/20 Chromium/WebKit; actual components/client/facade and real scheduling provider + Auth/Firestore |

Lifecycle browser presentation fixtures are limited to communications display and day-cache
visuals. Actual Booking capacity/commit is real emulator code. Network is loopback only.
Response loss is injected after commit; recovery asserts identical command and unchanged
appointment/Work Orders/locks. The mixed-text and generated-description regressions are
real browser-to-server cases. Prior Field UI 16/16 evidence uses explicit synthetic transport.
No physical device, deployed TLS/CORS/index or real WhatsApp execution was certified.

One initial combined build rejected an external dependency junction; the checkout received
a real copy of the same installed ERP dependencies and both full builds passed. One budget
script invocation used the wrong working directory; rerunning from apps/erp-next passed
without changing any assertion. Next's generated config changes were not committed.
CI adds public-facade/lifecycle contracts and combined browser verification, retains existing
gates, and uses Node 22 for Functions. Production workflows were not changed or disabled.

Independent read-only review: Laplace closed the lifecycle/atomicity/caller review, then
identified and verified fixes for cleared text, distinct line text and legacy generated
description handling. Final scoped verdict: no pending findings; static review, not an
independent emulator run. Epicurus audited actual cost/time sources, identified automatic
release effects and required the combined and target-runtime checks now completed.

## Performance evidence and limits

Repeated the same baseline a99402e/current benchmark on Node 22 with 50 distinct synthetic
users, concurrency 4/10/25/50, three alternating batches per route, 2,670 measured requests,
zero errors, unchanged protected collections. SDK query/snapshot counts did not increase.

| Route, concurrency 50 | Baseline/current p95 ms | Queries / max document snapshots |
|---|---|---|
| list_plans | 359.2 / 353.6 | 1 / 22 |
| get_plan | 129.7 / 159.9 | 0 / 3 |
| get_activity | 280.2 / 360.8 | 3 / 23 |
| get_execution | 356.8 / 339.9 | 4 / 39 |
| get_materials | 304.7 / 288.6 | 1 / 47 |

The detail and activity tails increased in this run; this is not claimed as an overall
speed improvement. Registry service/domain source is byte-identical to baseline; activity
has the scheduledSlots-array compatibility change. In-process warm emulator results do not
establish a production SLA or visual selector latency. Current lifecycle timings are in its
browser evidence, but controlled before/after visual selector, HTTP availability/confirmation
and deployed performance validation remain part of B. Earlier Node 24 results are preserved
separately, not presented as measurements of this final combined run.

## Deployment mapping and automatic effects

Vercel get_project still fails internal idOrName validation. A read-only signed-in browser
inspection resolved the previously unknown project settings without revealing variable values:

| Surface | Current setting / production evidence |
|---|---|
| demac-corporation, prj_gPKFUmmlG0KzQ0rW9lxUHMde165x | Repo root, Other framework, Node24, automatic builds; production cb01c / dpl_7RiRCRrbfxhmfzsFQFBLWCcJbpxw |
| demac-corporation-web, prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7 | Repo root, Node22; saved dashboard commands still Expo/dist, but production overrides use ERP Next / apps/erp-next/out; production cb01c / dpl_4XLDRZt8BWF8Xsay5sxubijiuumH |
| Both actual production overrides | npm install --prefix apps/erp-next; typecheck + build; output apps/erp-next/out, matching vercel.json |
| ERP environment | Only EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET listed, all environments; no linked shared variables; no PROJECTS variables |
| Web environment | Seven EXPO_PUBLIC_FIREBASE_* variables apply to Production and Preview; no linked shared variables; no PROJECTS variables |

ERP falls back through next.config.ts to Firebase project demac-corporation. Web Preview
and Production share Firebase variable definitions. Existing previews are therefore **not
isolated staging evidence**. Current configuration does not prove historical build-time flags;
server businessSettings/flags/indexes remain unverified. Firebase browser access stops at
a signed-out Google account. No credentials were requested, extracted or changed.

Pushing the continuation to the connected repository can create Vercel previews. Merging
to main has production effects independent of Projects flags: Office Booking, Field,
Work Order Application and WhatsApp producer workflows deploy. The WhatsApp workflow also
runs migrateLegacyMetaTransactionalQueueToWacli.js and realignVanScheduleGroups.js against
demac-corporation. Do not describe an inactive-Projects merge as code-only. Their execution
is outside the present authorization. Release review must explicitly resolve these effects;
do not disable checks or silently alter production gates to obtain a merge recommendation.

The new lifecycle protocol rejects old cached clients/offers that lack observed tokens.
Deployment must coordinate backend and current frontend/cache refresh; stale writes must
remain rejected. Routine cancellation/rescheduling may be temporarily unavailable during
an uncoordinated rollout. Preserve previous code/config artifacts, but do not restore old
unsafe writers over adopted central data without a reviewed compatibility decision.

## Remaining gates and required owner input

| Gate | Status / concrete closure |
|---|---|
| A: agreed implementation/review | Corrected slice and combined source reviewed. Full scope still lacks approved historical material valuation, project expenses and individual approved project time. Identify authorized system/file plus stable document/line/currency/status and Project/WO keys, or owner explicitly changes this delivery's scope. Catalog prices, demo expenses and attendance are not substitutes. |
| B: integration and staging | Local combined PASS. Need named isolated Firebase/staging project, authorized access, deployment entrypoint/origins/flags/index verification and controlled browser/HTTP performance evidence. No live activation is authorized. |
| C: data and recovery | Need original Projects/templates browser origin/profile, Matthijs canonical IDs, protected DB/Storage/source exports, relational reconciliation and isolated restore exercise. Synthetic dry-run/recovery is not a real backup certificate. |
| D: publication authority | Not granted. Present exact candidate, environment, staged operations and automatic migration/deployment effects for owner approval only after preceding applicable gates close. |

Rollback must distinguish code, pausing new writes and data restoration. Existing writesPaused
preserves reads and committed receipt recovery in emulator. Preserve post-backup operational
work; do not replace the current database with an older dump or revert central adoption to
stale localStorage. Actual RTO/RPO remain unmeasured. No migration is proposed as implicitly
approved, and real legacy missing links/provenance require reviewed reconciliation.

Existing employeeTimesheets.workOrderAttendanceSegments includes partial after-hours
segments; the finding is insufficient integrated coverage, not an absence of every time
record. Those segments do not establish complete approved person/project execution.

Next work depends on the source/scope decision and isolated environment access. Keep the
commits and evidence; transfer reviewed continuation commits to #514 only after push effects
and release scope are approved. Recheck both PR heads immediately before publishing. #515
remains separate; the combined tree records compatibility, not a remote merge decision.
