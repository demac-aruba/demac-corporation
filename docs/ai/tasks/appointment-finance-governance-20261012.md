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
- [ ] Verify actual deployed Office, Inventory and customer-sales consumer source/dependency/configuration baselines and recovery archives.
- [ ] Prove coordinated backend/ERP/Legacy/rules cutover, including old open clients and forward recovery; then nondestructive post-deploy checks.

## Verification

Latest local integration: 180/180 tests (finance, catalog, ordinary/emergency/Project booking, reservations and inventory), plus 11/11 actual Firestore/rules cases. Real ERP+Legacy browser flow covers blank vs zero, lost response/exact retry/one audit, disabled in-flight editing, stale writer/draft retention, read-only role, catalog outage with operational data hydrated, 90-minute legacy duration retention, cross-client persistence and a list response captured before but delivered after a successful write. All passed. Financial client/facade flows rerun at 1440/1366/390 after catalog integration: 3/3 passed, including four payment methods and lost-response replay.

Earlier unchanged-surface evidence: 6 Project release/compatibility cases, 35 controlled finance UI cases, 17 detail drawer regressions. ERP Next and Legacy typecheck plus production/web builds passed. Build-generated Legacy patch output and Next config rewrites were removed from the commit; checked-in catalog browser and rules tests were rerun afterward. Java 17 originally blocked the emulator; isolated Java 21 resolved that gate rather than waiving it. Local Node is 24; exact-head CI must repeat under deployed Node 22.

Synthetic 1000-item/60-line browser run: editor ready 309 ms; input-to-two-animation-frames median 47 ms, p95 81 ms; zero authority/network requests while typing; 40 result limit. These are loopback development-fixture observations, not production latency measurements.

## Release decision

BLOCKED, draft PR #572 only. Latest fetched main: `0dc09f3167150ed775018a6f257542961b21cddf` (PR #573 packaging verification, following PR #570). Production target remains https://demac-aruba.com, Firebase demac-corporation/us-central1, Vercel demac-corporation-web. No production data, rules or deployments were mutated by this task.

The former Office baseline without a lock was superseded by PR #570's explicitly approved reconstructed fixed dependency baseline; do not claim that the historical runtime was recovered byte-for-byte. Its original recovery artifact is 11774320564. Run 38308594583 partially deployed and then failed published-source packaging verification. Follow-up read-only audit 38309923175 passed, but resumed release 38310446182 also failed its release step after attempting all five targets. Its audit passed; completion and exact live state must be verified, not inferred from an earlier revision. Do not overlay this uncertain release or use generic whole-source deployment, which also contains unrelated mutation helpers.

New unpriced-value guards necessarily touch existing Inventory/customer-sales consumers. Updating only Office would leave old consumers treating null as zero; therefore all actual consumer runtime sources, rollback archives and boundary tests are release gates. Saved pricing settings also still override repository defaults.

Rules deny direct services writes to make CAS/claims effective. Old open ERP/Legacy clients cannot safely continue writing after that cutover; an old monetary client also lacks an appointment lease. A tested release/update-session mechanism is required before claiming uninterrupted operation. Recovery must keep the governed protocol and every new financial/catalog audit record; never restore a database backup or reopen unguarded writes as an improvised rollback. Owner authorization is present but conditional on these critical checks. No merge or deploy is claimed.
