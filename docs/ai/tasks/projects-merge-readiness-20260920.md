# Projects merge readiness — 2026-09-20

## Current operational-cost scope — owner clarification

QuickBooks and the future photo/audio expense assistant are **not prerequisites** for
operational Projects. The [2026-09-20 scope](projects-operational-cost-scope-20260920.md)
supersedes earlier source/scope requests that made accounting integration a blocker.
Confirmed manual expenses are valid operational evidence; paid/accounted/reconciled/synced
states are separate. No new expense ledger or AI capture was implemented.

Current application candidate: `cf7b141d63b09d7c36236cee2506318224c6afc2`, including
`625704e8` (audited monetary revisions and original-source preservation). Material budget
creation/revision retains original/current, exact AWG cents, provenance and reason/actor/time.
Older unknown originals remain unknown; imported baselines identify the captured snapshot.
Metadata cannot silently change the amount. Expenses do not inflate budgets; Van/slot/time
planning remains separate. Existing local expense/cost rows are visible read-only with
provenance, missing currency and local-only status. Unverified allocations do not yield
certified balances or zero spending. Inventory's absent historical valuation is no longer
described as a dependency on QBO.

Loading the active browser planner no longer deletes filtered originals. Both local writers
preserve raw source and reject malformed/duplicate storage; selection rereads current data.
Scheduling's legacy bridge preflights the original before booking. Shared locking and
post-network revalidation preserve later costs, while the existing pending-link limitation
remains explicit. Raw-backup/import tooling is reused; no real migration occurred.

Independent reviewers audited actual sources and active write callers. Two P1 findings
(client action allowlist and remaining legacy destructive writer) were fixed and rechecked.
See [review evidence and residual limits](../reviews/projects-operational-cost-preservation.md).

The initial combined source attempt conflicted only in the portfolio risk-label area.
The follow-up keeps recovery metrics outside the unchanged shared metric block, preserving
both semantics. Further combined review found incomplete local hour records could crash
#515's strict arithmetic. Those sources now enter recovery without writes; 18 invalid
variants were independently checked in memory and missing-hours recovery ran in browsers.
The companion #515 commit `530b7cb0fbe433cd96525b737cb54617d0d9bf44`, based on remote
`3622bc5a`, fixes only its browser harness's explicit synthetic/default-off environment.
Combined CI pins that successor and includes its browser suite. Publish the companion first
only after release authorization; no remote has been advanced. Final actual combined tree:
`966b0d2e9102c15a7da474444fa251e72a7de711`, conflict-free and not committed as a merge.

| Current verification | Evidence and exact boundary |
|---|---|
| Final combined ERP | Full Node22.23.2 and Node24.18.0 builds PASS, all seven prebuild suites; generated config restored; Node22 typecheck PASS |
| Projects / affected contracts | 210 Projects and 230 overlapping focused contracts PASS; includes lifecycle/partial/facade/Field bootstrap; Firebase source validation PASS |
| Booking / Field | 163 Booking; 354 Field plus 47 pretest PASS on ca8bc3d1; relevant Functions code is identical in final candidate |
| Auth/Firestore | 72 PASS: registry26/import18/bridge11/public3/handoff3/execution11 at 625704e8; relevant backend/client contracts unchanged in final candidate |
| Real Functions HTTP | Final tree: 9/9 PASS, actual bootstrap export selected alone; Node22/Auth/Firestore, protected collections unchanged |
| Central client journal | 19 PASS, including exact monetary amount/reason across reload; six response-loss-injector controls PASS |
| Budget / phase / original storage | 20 budget acceptance cases, phase planner and raw-storage preservation PASS; final build runs preservation including invalid time sources |
| Final central browser | Chromium/WebKit PASS on Node22 build: material/time revisions, original/current, explicit clearing, lost response/reload/exact retry, local expense provenance, malformed/modified-sample/missing-hours originals, 390px |
| Central drawer / lifecycle browser | 18 / 20 PASS on ca8bc3d1; later local storage-shape guard is separately exercised by final local recovery and budget browser |
| Legacy budget browser | 10/10 PASS on final combination, Node22; companion standalone 10/10 PASS on Node24. Real drawer/local writer with explicitly synthetic authority; actual capacity conflicts still reject |

Independent review of the final combined fixes reports no remaining scoped findings.
Historical results below retain their original SHA; the current ERP source has changed
and does not inherit the older endpoint-era build/browser certificate. All reported runs
are local; no new remote CI checks, real backup, staging deployment or production validation
are implied. `pruebas-costos-operativos.json` and the output manifest record final provenance.

Final benchmark v2 on `966b0d2e`, generated 2026-09-20T11:40:22.051Z: Node22, 50 distinct
synthetic users, concurrency4/10/25/50, three alternating batches, 2,670 measured reads,
zero errors and unchanged protected collections. At concurrency50, p95 base/current ms:
list163.8/149.3, detail82.4/79.0, activity259.2/266.5, execution363.5/335.9,
materials214.3/207.3. Query/max-snapshot counts remain 1/22,0/3,3/23,4/39,1/47.
This is a warm in-process emulator measurement, not a causal speedup claim or HTTP/visual/
production SLA. Small fixtures, one role, no concurrent writes/pagination and limited tail
sample size remain constraints. Prior endpoint v2 is retained as historical; v1 remains
superseded because its wrapper dropped transaction options.

**Publication remains gated by isolated deployed staging, real-source backups,
identity/relationship reconciliation, isolated restoration and final owner authorization.**
The owner clarification preserves these gates. Available manual Van maintenance costs do
not have verified Project allocations and cannot be arbitrarily distributed. Individual
approved time coverage remains limited; neither QBO nor a future expense assistant is a
dependency for accurately presenting that limitation in the current operational scope.

## Previous endpoint checkpoint — historical exact source

**Full requested delivery is not ready for merge/publication.** The authorized local
implementation and isolated integration work below is complete and reviewable; missing
staging and real recovery gates have not been waived. No push, main/PR
merge, deployment, activation, permission change, migration or real-data write occurred.

- Continuation: `feature/projects-completion-audit-20260919`, based on #514 at
  `a99402ece30f7042105daea1feac8d34174b1453`.
- Application HEAD: `376cf709654545208b4f64957b582e5e5117c40b` (real registry entrypoint).
- Candidate including corrected benchmark: `632e2498e19df6f544eb25233a2f0c75678a4e3f`.
- Earlier application commits: `56795766` (lifecycle intent, recovery, atomic remaining-work
  association) and `0fd500fb` (preserve per-line text when editing scope).
- Previous application commits `9ab34aae`, `70a83eef`, `27458a10` remain included.
- #515 stays separate at `3622bc5a4871b6ce7019af02f7354a5cc23171ee`.
- Disposable local integration used `git merge --no-commit --no-ff` of #515 into
  candidate HEAD; no conflicts. Final actual combined tree:
  `7b7880ed2f2b8293bde7650b4c16a4383775f4ab`. Endpoint verification ran on the immediately
  preceding tree `9fdc0ccc5ad91d4c00703df70e09213578116c86`; their only difference is the
  benchmark correction. The prior full-build/browser tree is
  `e464d4dc138a94aaeea75d3fbc955b5651e58b0c`; its entire apps/erp-next tree is unchanged.
  These are actual checkouts/runtime tests, not only merge-tree analysis. No remote advanced.
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
Project adapter. PROJECTS_REGISTRY_ENABLED still defaults off. Firebase bootstrap now
exports projectsRegistry through the existing HTTP adapter/service, with bounded resources,
lazy initialization and revocation-aware Firebase authentication. New PROJECTS_ALLOWED_ORIGINS
configuration defaults empty and permits only explicit origins. Invalid configuration fails
closed without breaking bootstrap discovery. No real origin or flag was configured.
The deployment adapter keeps allowLegacyImport:false; existing import safeguards were not
weakened. See [the prepared endpoint/release contract](projects-registry-endpoint.md).
Deployment, real import/recovery and central adoption remain unverified/unapproved.

Operational move now updates appointment/assignment/Work Order capacity-end fields to
the actual owned slots, including lunch gaps. Recorded work end remains separate.
Activity accepts canonical scheduledSlots arrays as well as supported integer counts;
it does not infer execution time. Earlier immutable Field Van attribution and exact
optional AWG planning-budget fixes remain in force.

## Final isolated verification

Node 22.23.2 is the Functions target. Next 16.2.11, Playwright 1.57.0,
firebase-tools 15.30.0 and Java 21 stayed unchanged. Combined ERP builds also passed on
Node 24.18.0, matching the current Vercel ERP build setting. No dependency or lockfile update.
Both task-installed binaries removed during the previous disk incident were restored.

| Check | Result and boundary |
|---|---|
| Full ERP build | PASS on combined tree, Node 22 and 24, including all six existing prebuild suites |
| ERP typecheck | PASS; generated Next config restored after builds |
| Firebase source validation | PASS on Node 22 |
| Projects units | 206/206 PASS after adding actual bootstrap/default-off/configuration cases |
| Latest combined focused contracts | 226/226 PASS: Projects, lifecycle, partial, facade-partial and Field bootstrap |
| Actual Firebase Functions HTTP | 9/9 PASS on candidate and #515 combination, real Node22/Auth/Firestore; protected operational collections unchanged |
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

The broad build/browser/regression rows above were executed at 0fd500fb/e464d4dc and are
retained with that provenance. The new endpoint changes no ERP source or Booking/Field
implementation. Its affected bootstrap/transport gates were rerun at 376cf709/9fdc0ccc;
the benchmark alone was rerun at 632e2498/7b7880ed. These are not remote CI runs on a new SHA.
The Functions emulator loaded only projectsRegistry, selected from the actual bootstrap,
so no operational trigger could react to fixtures. An initial harness invocation rejected
rules outside its temporary project; copying the current rules unchanged fixed packaging.

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
Laplace then independently reviewed the actual endpoint/runner/CI. A PATH reproducibility
finding was fixed by pinning child Node to the runner's Node22 and asserting the test runtime;
the final combined HTTP run passed. No pending scoped findings. Epicurus independently
reviewed the benchmark correction and output; neither reviewer ran those emulator suites.

## Performance evidence and limits

Methodology v2 supersedes the earlier Node22 and Node24 results: the old instrumentation
discarded transaction options and accidentally measured read-write transactions. The wrapper
now forwards the service's readOnly option and asserts it for every measured request. The
new run is tied to 632e2498/combined tree 7b7880ed, generated 2026-09-20T04:47:42Z.
Repeated the same baseline a99402e/current benchmark on Node 22 with 50 distinct synthetic
users, concurrency 4/10/25/50, three alternating batches per route, 2,670 measured requests,
zero errors, unchanged protected collections. SDK query/snapshot counts did not increase.

| Route, concurrency 50 | Baseline/current p95 ms | Queries / max document snapshots |
|---|---|---|
| list_plans | 128.5 / 145.0 | 1 / 22 |
| get_plan | 64.9 / 84.6 | 0 / 3 |
| get_activity | 187.2 / 204.1 | 3 / 23 |
| get_execution | 335.8 / 302.1 | 4 / 39 |
| get_materials | 256.7 / 275.2 | 1 / 47 |

Four of five p95 values increased in this run; this is neither a global speed improvement
nor sufficient evidence to attribute the differences to code. Registry service/domain logic
is unchanged from baseline (only the deployment comment changed); activity
has the scheduledSlots-array compatibility change. In-process warm emulator results do not
establish a production SLA or visual selector latency. Current lifecycle timings are in its
browser evidence, but controlled before/after visual selector, HTTP availability/confirmation
and deployed performance validation remain part of B. Earlier Node22/24 outputs are preserved
as superseded methodology-v1 evidence, not current service-latency measurements. At concurrency
4, p95 and p99 both equal the maximum of only 12 samples. The fixture repeatedly reads one
Project, has one user role, no concurrent writes and no complete pagination traversal.
Counters describe instrumented SDK snapshots, not billing; one transaction attempt does not
exclude internal RPC retries. The lower absolute times versus v1 do not prove product optimization.

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

## Remaining gates after the scope clarification

| Gate | Status / concrete closure |
|---|---|
| A: agreed implementation/review | Operational scope is now explicit: preserve and expose available budgets/manual evidence with source limitations; QBO and AI capture are future work. Audited revisions and preservation fixes reviewed. Shared expense allocation/valuation and full individual time are not fabricated. See current-candidate verification above; no new expense authority was invented. |
| B: integration and staging | Local combined and actual Functions HTTP PASS; deployment entrypoint prepared. Need named isolated Firebase/staging project, authorized access, deployed origins/flags/IAM/index verification and controlled browser/HTTP performance evidence. No live activation is authorized. |
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

Next release work depends on isolated environment access and original-source recovery evidence. Keep the
commits and evidence; transfer reviewed continuation commits to #514 only after push effects
and release scope are approved. Recheck both PR heads immediately before publishing. #515
remains separate; the combined tree records compatibility, not a remote merge decision.
