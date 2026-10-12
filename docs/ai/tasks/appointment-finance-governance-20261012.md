# Task: Service-based visit charges and exclusive appointment editor

## Context

Owner clarification and conditional merge/deploy authorization, 2026-10-12. Operators select the performed service, exact BTU and quantity; they do not directly override prices. Reserve billing while Importes y pagos is open and show another operator's name. Preserve original estimates, historical financial evidence and all operational/customer records.

## Scope and governance

Candidate extends draft PR #572. Existing Office facade, canonical `services`, company pricing rules, `appointments.jobCharges`, private appointment coordination and immutable receipt/event paths remain authoritative. Rule: OPS-SCHED-CHARGES-001. No new ledger or invoice numbering. Financial roles are unchanged. No production migration, security-rule change, customer communication or production write was performed.

The selected service controls new prices and server-derived descriptions. Existing snapshots retain their unit price when line, service, preset, BTU and work-line identity match; a changed service or BTU resolves the current tariff. Historical retired catalog items remain viewable and quantity-editable but cannot be newly selected. The approved AWG matrix is:

| BTU | Standard | Deep cleaning | Standard back-to-back installation |
| --- | ---: | ---: | ---: |
| 9000 | 100 | 195 | 225 |
| 12000 | 125 | 195 | 225 |
| 18000 | 135 | 195 | 225 |
| 24000 | 145 | 195 | 250 |
| 36000 | 175 | 250 | 300 |

Defaults are aligned in Functions and Legacy Company Rules. Existing saved settings take precedence and are NOT rewritten by this change. A reviewed, version-checked settings update remains necessary before activation. Existing duration/commercial eligibility policy is not replaced; the added 9000 installation default uses the established installation duration (120 minutes), not a new owner-provided duration.

## Acceptance and observed evidence

- [x] One server lease per appointment, user plus browser activation, expiry/generation fencing, late release protection.
- [x] All four new financial mutation paths require the lease and expected version in the transaction.
- [x] A currently authorized exact committed-payment retry survives lease expiry without duplicates.
- [x] Matrix names cannot be spoofed independently of price; 15 approved defaults verified.
- [x] Snapshot retention, changed service/BTU, quantity changes, null pricing, explicit zero and original estimate preservation verified.
- [x] Actual components/client/facade over an isolated MVCC store complete booking, finalization and four receipt methods at 1440, 1366 and 390 pixels.
- [x] Controlled browser failures verify named read-only holder, draft retention, same-session recovery, late cleanup, hidden/focus heartbeat and expiry.
- [x] ERP and Legacy catalog maintenance uses server CAS, frozen editor versions, stable retry IDs and canonical booking-code claims, including versionless legacy definitions.
- [x] Blank price remains unpriced; explicit zero remains zero across appointment pricing, customer product projection, reservations and Inventory. Existing snapshots are not backfilled.
- [x] Catalog failure/late response cannot hold operational Legacy reads or overwrite a confirmed local catalog mutation.
- [x] Real Firestore emulator: 11/11 transaction/authorization/rules cases passed with isolated Java 21; no production credentials.
- [x] ERP and Legacy typecheck/build completed. Final post-review CI on the exact remote commit remains required.
- [ ] Verify/update the 15 effective saved Company Rules prices with a version-checked dry run and recovery, preserving existing durations/unknown fields.
- [x] Verify actual deployed Office, Inventory, Field and customer-sales consumer source/dependency/configuration baselines and recovery archives.
- [ ] Prove coordinated backend/ERP/Legacy/rules cutover, including old open clients and forward recovery; then nondestructive post-deploy checks.

## Verification

Latest local integration: 180/180 tests (finance, catalog, ordinary/emergency/Project booking, reservations and inventory), plus 11/11 actual Firestore/rules cases. Real ERP+Legacy browser flow covers blank vs zero, lost response/exact retry/one audit, disabled in-flight editing, stale writer/draft retention, read-only role, catalog outage with operational data hydrated, 90-minute legacy duration retention, cross-client persistence and a list response captured before but delivered after a successful write. All passed. Financial client/facade flows rerun at 1440/1366/390 after catalog integration: 3/3 passed, including four payment methods and lost-response replay.

Earlier unchanged-surface evidence: 6 Project release/compatibility cases, 35 controlled finance UI cases, 17 detail drawer regressions. ERP Next and Legacy typecheck plus production/web builds passed. Build-generated Legacy patch output and Next config rewrites were removed from the commit; checked-in catalog browser and rules tests were rerun afterward. Java 17 originally blocked the emulator; isolated Java 21 resolved that gate rather than waiving it. Local Node is 24; exact-head CI must repeat under deployed Node 22.

Synthetic 1000-item/60-line browser run: editor ready 309 ms; input-to-two-animation-frames median 47 ms, p95 81 ms; zero authority/network requests while typing; 40 result limit. These are loopback development-fixture observations, not production latency measurements.

## Release decision

Owner authorization is present, conditional on completed technical gates. Final candidate
preserves main4175285f (approved QuickBooks and slot history) and the actual deployed
Office history runtime744a4c40, with bounded source overlays across five consumers.
Target remains https://demac-aruba.com, Firebase demac-corporation/us-central1, Vercel
demac-corporation-web. No behavior, tariffs, rules, customer records or communications
have been changed by this task at this checkpoint. Private recovery packages are retained.

Actual-source preparation83a4a423 completed188 original-source and234 candidate tests,
real Node22 bootstrap/native smoke, and verified private archives for all five targets.
An additional baseline history test was not executed because the archived package did
not contain that newly selected test. The validation harness now explicitly rejects any
missing selected test and injects this compatible test only into its isolated validation
copy. Preparation216dd676 repeats the full gate; the pending replacement evidence must
be accepted before activation. This is a harness correction, not a waiver.

Independent review reproduced a pre-cutover payment race and verified the implemented
fresh-grant financial version fence. All four old financial commands are exercised in
both commit orders, with exact replay protection. Latest cutover18/18 and client36/36
passed; reviewer independently confirmed the handshake and notification neutrality.

The controlled release uses source-only PATCH and retained immutable generations,
current source/config/IAM/traffic verification, exact-operation recovery/provenance,
CAS15 saved prices and governed services rules. Generic rules publication shares the
production concurrency group. Rules settle before Office activation and before ERP
promotion. Interrupted deployments recover forward; records/audit are never restored
from a database backup and unguarded writes are not reopened.

Final release-script review, exact-head CI, refreshed preparation evidence and coordinated
production verification remain pending. Old ERP/Legacy sessions receive a reload notice
and preserve their open draft; automatic reload does not transfer unsaved drafts. The
updated Legacy source is maintained as the operational fallback; no separate live Legacy
deployment has been identified or assumed. Existing catalog reads remain available.

Final preparation run38318268340 at216dd676 completed193 baseline and234 candidate tests (427 total); Office baseline65/candidate91. All five real bootstrap/native smokes and private immutable archive checks passed. Summary artifact11777188590 SHA256546202bbf48e919dbd69baaa21a184c3f3de513a3880d0400e4d3973683997e6 is pinned in docs/ai/releases. Independent release-script review gave GO after22/22 tests. Read-only run38318399395 verified real request/response operation contracts; no remaining technical review blocker. Main12105b6d documentation/release-script update is preserved; application/function source trees are unchanged from4175285f outside this feature. Final exact-head CI and production verification remain required.
