# Review: Appointment finance and catalog governance

Current release decision: GO; backend and ERP production activation are complete.
See the final evidence at the end. Earlier blocked decisions are historical checkpoints.

## Review mode
Independent code review by /root/financial_review, implementation by /root, plus builder full-diff/consumer checks. Final late-read correction was independently accepted: favorable code checkpoint with no remaining blockers identified in the reviewed scope. This is not production release approval.

## Findings and corrections

| Finding | Correction / evidence |
| --- | --- |
| Matrix/catalog label could diverge from selected service | Server-owned names, legacy fallback and spoof regressions. |
| Empty catalog price silently became zero; stale forms could overwrite | Null-aware parsing, server CAS on full document hash plus revision, frozen form snapshot, exact retry and audit in ERP/Legacy. |
| Customer tools/reservations/Inventory still coerced null to zero | Shared canonical money interpretation, unknown Inventory valuation, consumer regressions. Independently rerun 49/49 passed. |
| Versionless legacy service/fallback code escaped uniqueness checks | Claim/legacy scan uses the actual booking consumer normalization; compatibility regression passes. |
| Catalog transport failure blocked all Legacy operational hydration | Independent catalog request and explicit error/loading state; browser holds/fails that request and verifies updated clients/orders. |
| A delayed catalog read could visually undo a confirmed local write | Successful create/edit/delete invalidate prior read versions; ERP refresh fenced too. Browser captures an old list before saving and delivers it afterward. |
| Reused deleted ID could attach new identity to history | Private durable identity marker prevents reuse across operators; audit survives delete. |
| Legacy name edit could round an existing 90-minute service to 120 | Preserve untouched duration and canonical definition; real Legacy browser persistence passes. |
| Lease focus/recovery/expiry corner cases | Visible renewal, same-activation retry, generation fencing and finite expiry guards; controlled UI and Firestore cases. |

Independent reviewer executed 49/49 tests, reviewed 180/180 integration and 11/11 emulator/rules evidence plus both clients. Three initial P1 findings are closed. The P2 late-read correction was independently reinspected and closed after the browser regression passed. Latest main `0dc09f3167150ed775018a6f257542961b21cddf` was integrated into the feature branch without conflicts; its three-file packaging-verification change does not alter these domain paths. No customer writes/messages occurred.

## Evidence

180/180 local domain/integration tests; 11/11 real Firestore/rules cases; ERP+Legacy catalog browser flow; three financial browser viewports after catalog changes; ERP/Legacy typechecks and builds. Earlier unchanged-surface evidence: 35 controlled financial UI cases, 17 drawer regressions, 6 Project compatibility/release cases. All stated completed gates passed. Build-generated unrelated files were removed; browser/rules rerun against cleaned sources. Node 22 exact-head CI remains mandatory.

React review: functional state updates; stale-result fencing; form controls disabled only during dependent save; explicit server acknowledgement; drafts retained on failure; no lease during prefetch; bounded rendered picker results and no network per keystroke. Existing financial styles/icons are retained. Checked real synthetic browser screenshots. Catalog uniqueness scans pages of 200 only when a legacy code has no claim; total work remains O(catalog size) in that transition, not constant time. No claim of measured production latency.

## Historical release decision: BLOCKED before preparation

Effective saved tariffs, exact runtime/source recovery of every touched consumer, final exact-head CI, and coordinated backend/ERP/Legacy/rules cutover with old-session handling remain critical. The concurrent dwelling release has a passed source audit but failed resumed publication 38310446182; the live result needs explicit verification. Do not overlay it or assume rollback happened. Do not merge or deploy this candidate until these gates are resolved. Owner approval already exists conditionally.

## Release preparation continuation, 2026-10-12

Independent release reviewer `/root/release_review` found a redundant fixed-price
precheck that rejected valid matrix services with no fixed base price. It now
delegates every supported matrix declaration to the canonical resolver. The
reviewer reran 45/45 pricing, audit and tariff-plan cases and the 10/10 browser
cutover cases. The builder also reran 11/11 real Firestore/rules cases.

The browser cutover harness bundles the actual former-main ERP/Legacy clients
and the candidate. Four old financial write paths fail with a reload explanation
and preserve their drafts; old catalog writes are denied, and Legacy operational
hydration continues. A previously committed old payment retry causes no duplicate;
after reload, both new catalogs and the leased payment path work. Reload is
deliberate: drafts stay in the old open page but are not automatically transferred
across a browser reload. These are isolated synthetic tests, not production writes.

Audit run 38313662102 read all five deployed consumers without invocation or
mutation. The saved pricing document is absent (Firestore NOT_FOUND), so the
bounded plan creates the 15 approved rows only with `exists:false`; an existing
document uses `updateTime`, preserves typed unknown fields/durations, rejects
duplicates, and is idempotent. No tariff write has occurred yet.

Office has verified source and a valid lock. Field and both customer consumers
have valid locks absent from repository history, so their raw archives were
withheld from public artifacts. Inventory has verified source but no lock; its
immutable historical image returns 404. This is a failed historical-dependency
recovery check, not a recovered baseline. A separately reviewed reconstruction
and real recovery evidence remain required before it can be deployed.

The Inventory and Firebase rules workflows now respect `[merge-only]`, retaining
their ordinary deployment paths. This prevents those writes from racing a
coordinated cutover. Final exact-head CI and release preparation remain pending.

Preparation run 38315094298 failed an archived `demacServicePricingRules` test
because that dormant fixture imports the retired scheduling module. This failed
check is not recorded as passed. Independent traversal of the actual Office and
Inventory bootstraps found 151 and 70 reachable modules, no missing local imports,
and no path to that fixture; no non-test repository consumer imports it. Runtime
scope was corrected to preserve that dormant file and test the actual pricing
consumers instead. Repository default tests remain mandatory CI. Candidate Office
tests use the current helper only as an isolated fixture, restore archived bytes
before the real bootstrap smoke, and never include fixture changes in a deployed
archive. Preparation now also checks this reachability in every downloaded bundle.

The same run verified effective recovery privacy through the complete project
ancestry (one project, no parent), plus bucket IAM and uniform access. No recovery
objects or production behavior were changed before the failed baseline test.


### Verified preparation and final cutover fence

- Run38316064795 (fdf145a8) completed all five actual-source baselines/candidates:
  188 baseline and226 candidate tests, real Node22 bootstrap/native/CORS/auth smoke,
  original dependency locks preserved where available, and private immutable recovery
  packages verified by generation, SHA and download/extraction. Inventory retains its
  explicitly reconstructed pinned baseline; historical dependency equivalence remains
  unknown. No production behavior or tariffs changed in preparation.
- Active Firestore rules source matches reviewed baseline2ed66f4d. Monitoring read-only
  run38316568330 showed missing superseded-revision series, which is not evidence of
  zero instances. The monetary exclusivity race therefore uses a deterministic fence.
- Actual previous handler was raced against fresh grants for all four financial commands,
  both commit orders:18 total previous/current-client cutover cases pass, with no duplicate
  exact retries. Current browser suite36/36 passes, including stale-prefetch and draft
  preservation. Independent reviewer reproduced13 focused and36 browser cases and found
  no fence/handshake/notification blocker. Versions now include grants, not just events.
- Main advanced to4175285f with separately approved QuickBooks and slot-history changes.
  They were merged intact. The next preparation pins the newly published Office history
  bundle744a4c40 and exercises its history action in both baseline and candidate;
  source-only overlays preserve all other deployed code and original dependencies.
- Activation remains gated on refreshed retained packages, final exact-head CI,
  independent release-script review, current source/config/IAM and coordinated promotion.


### Interrupted-release review and harness correction

The independent release reviewer found that ACTIVE-only preflight could not recover a
lost accepted PATCH or terminal FAILED/UNKNOWN source update. A dedicated tested
adapter now discovers only exact-target, exact-source-generation update operations,
resumes running work without duplicate PATCH, permits forward recovery only for a
classified failed reviewed attempt, and requires successful operation response/revision
provenance before treating requested source metadata as deployed. Seven mock orchestration
cases cover lost response, running resume, failed/unknown states, absent provenance,
verification/poll failures and partial rollout; all22 release/preparation/planner tests pass.
Generic Firestore rules deployment now uses the same production concurrency group, and
Office activation waits65seconds after the rules release; ERP promotion waits610seconds.

Run38317509610 (83a4a423) succeeded with188 baseline +234 candidate checks and private
archives, including actual Office revision00084-vak. Builder inspected the baseline count
and found Node22 had not executed a newly selected history test absent from the archived
source. The test harness now asserts every selected test exists and supplies that unchanged
history test as an isolated-only baseline fixture. Preparation216dd676 repeats all checks;
its complete retained summary must replace the preliminary evidence before activation.
No failed or missing required check is waived. Shipped runtime bytes are unchanged by
this validation-only correction.

Final repeated preparation216dd676/run38318268340 passed427 assembled-source tests (193 baseline,234 candidate), including all65 Office baseline tests. All archives are privately retained and verified. Missing-test gate is resolved by execution, not waiver. The reviewer independently passed22/22 orchestration tests and issued technical GO. Read-only run38318399395/artifact11777613562 confirms the real Google metadata.requestResource and response are direct v2 Function objects with name/storageSource and published revision fields. Final CI and coordinated activation remain gates; no production deployment is claimed here.

Final emulator gate on3b3863bb exposed one stale assertion expecting no jobCharges after
a fresh lease. The reviewed fence deliberately initializes canonical empty version1.
The a8fa5a9a test-only correction now asserts the entire empty state, returned version1,
and zero payment/event documents; all concurrency/renewal/release and read-only checks
remain. Reviewer: approved, no gate waiver. Local11/11 and all exact-head GitHub workflows
passed. Preparation38319141879 on the same head repeats427 tests and all recovery/smoke
checks; artifact11778051399 SHA256560c680659af396aa70bedb5ba20d61a770b9d752ba095bfcefdeb7df6f87a46
supersedes the prior prepared evidence. READY preview dpl_27jCEa2yZDGMkUqHRc8vQB2oThGq
serves the expected protected login with200. Final docs-only head CI, merge/source
equivalence, coordinated production release and post-promotion verification remain.

### First activation result and transport-only correction

Final PR head bd2597f7 passed15/15 workflows. Merge3ab832a0 preserved concurrent
dwelling release evidence; independent review passed41/41 relevant tests and all11
merge validation workflows passed. Controlled run38320718009 stopped before any
tariff/rule/UI activation: source-only Inventory PATCH copied the prepared tar to a
normalized function-source.zip and failed with error3 invalid ZIP. Read-only run
38321225811 proves the copied archive SHA equals the retained candidate and all five
functions remain on their original ACTIVE revisions with100% traffic. Earlier generic
StorageSource documentation described tar.gz, while the specific Functions upload
contract requires ZIP; actual operation evidence resolves the discrepancy. This was
a failed release attempt, not a successful deployment or a waived gate.

The new transport helper preserves the prepared runtime bytes and private tar recovery,
generates a deterministic ZIP with full extraction-manifest equality, and retains it
under the same privacy/CAS/immutable-generation checks. Provenance checks now verify
Google's normalized source by downloading only the exact expected function object and
generation and requiring SHA256 equality to the reviewed ZIP. An unknown running
update still blocks. Successful response revision and source must equal the live
function, in addition to unchanged config/IAM and100% traffic. Tests cover wrong bytes,
wrong bucket/function/generation/time, direct and normalized lost-response/resume,
live source divergence, deterministic binary preservation and public-access refusal.
Builder28/28 passed; independent review and exact-head CI are pending at this checkpoint.

Independent reviewer repeated28/28 and syntax checks, approved transport/provenance/
recovery, and identified one diagnostic output issue: arbitrary operation error text
must not be copied into future artifacts. Resolved by fixed categories invalid_zip
or unspecified; the historical pinned evidence contains only the reviewed benign ZIP
failure. No runtime/package changes were required. Exact correction-head CI remains.

### Accepted-operation verification and bounded re-read

PR579/correction012df484 and merge2979d5e0 passed their applicable CI with identical
trees. Run38322029114 verified all five private ZIPs, then stopped because the initial
accepted Inventory operation did not satisfy the provenance check. Read-only run
38322416928 proves the same operation subsequently completed successfully: mirrored
ZIP SHA785330393418f5fa63e7f80c8d8c54619b11bd3f62b3878c0feeea90f064314c,
Inventory ACTIVE00005-nup with100% traffic. Other consumers remain baseline, and no
tariffs/rules/UI activation occurred. We cannot identify the initial differing field
because it was not retained; the safe summary now captures presence flags.

The follow-up reads only the accepted operation identity to completion using the existing
bounded90-read/30-minute loop, then requires the original exact-source/provenance checks.
This does not assume Google's complete metadata will appear within30seconds. Wrong bytes, another operation,
or absent proof still fail and no PATCH is repeated. Independent reviewer passed30/30,
syntax and the predicate against real completed-operation evidence; GO after exact CI.
The next run must prove Inventory's current configuration/IAM/source/traffic and reuse
the successful operation before advancing the remaining sequence.

### Final release and production verification

PR580 final head6fdf4353 passed all three applicable workflows; merge1e3153b6 retained
the exact reviewed tree and passed merge CI. Independent reviewer verified30/30 focused
checks and the bounded completion/provenance gate. Run38323120937 then completed both
safety and publication successfully. The reviewer independently downloaded artifact
11780885333, matched ZIP SHA599a71c59678c8f02a46d589ab268272cb1551389ee7acab6fe7808375b11325,
and confirmed complete/readyForErpPromotion, 5/5 runtime proofs, zero repeated Inventory
updates, 15 saved tariffs, exact governed rules and all transition/propagation intervals.
No backend blocker remains. The 427 actual-source preparation tests remain applicable.

Direct promotion of the preview was rejected422; it was not treated as successful.
The reviewer accepted the bounded adaptation to rebuild the exact approved preview
with production settings, stage it without moving production domains, verify it, then
promote that exact build. Production dpl_6xLMiVwQrsTozBCLWXke3QiFkepA is READY at a8fa5a9a;
application/functions/rules trees equal the released source. Before promotion the prior
domain deployment was confirmed after READY; login/scheduling/catalog, ten JS assets
and the compiled public Firebase project/auth/storage configuration passed. Explicit
promotion completed all three aliases, and domain lookup resolved the new production ID.
Unauthenticated public checks returned200 for the three routes and www login with the
expected bundle. Immediate scoped error/fatal runtime logs returned no groups. These
checks did not exercise real customer/payment writes.

The API accepted explicit autoassignment=false for staging and true after promotion;
the connector omits the field in read responses, so its original value and direct
readback are not claimed. The reviewer accepted this evidence together with observed
domain behavior, without an additional test deployment. Final backend and production
summaries are pinned in docs/ai/releases. Old open-client draft/reload limitations and
Inventory historical dependency equivalence remain documented, not waived or hidden.
