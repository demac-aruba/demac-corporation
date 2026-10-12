# Review: Appointment finance and catalog governance

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

## Release decision: BLOCKED

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
