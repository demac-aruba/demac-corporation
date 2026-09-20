# Task: finish Projects without replacing Scheduling or Field authority

## Current checkpoint — 2026-09-20

See [the final continuation and merge-readiness record](projects-merge-readiness-20260920.md).
Application HEAD is `0fd500fbe2363fcfc091688d7432aa8fd1a53ba0`; actual combined #515 tree
`e464d4dc138a94aaeea75d3fbc955b5651e58b0c` passed Node22/24 builds,70 Auth/Firestore cases,
central Chromium/WebKit,18 drawer and20 lifecycle scenarios. Lifecycle stale-intent,
lost-response recovery, atomic Project follow-ups and caller text-preservation defects are
closed. Target Node22 and disk/dependency recovery are complete. Vercel mapping is now
verified read-only; previews share production Firebase configuration and main triggers
production deployments plus WhatsApp migrations. Source/scope, isolated staging, real
backup/reconciliation and publication approval remain open. Full delivery is not ready.

## Previous checkpoint — 2026-09-19 local / 2026-09-20 UTC (historical)

The older increment below is historical. Live verification: #514 draft/open/unmerged at
a99402ece30f7042105daea1feac8d34174b1453; #515 draft/open/unmerged at
3622bc5a4871b6ce7019af02f7354a5cc23171ee; main cb01c4696a3a35dbc23c9989bc54473fa67356b5.
All15 returned #514 PR workflows succeeded, run_attempt1. Not proof of deployed adoption.

Continuation branch `feature/projects-completion-audit-20260919`, isolated from existing
worktrees. Local application commits:
- 9ab34aae: existing estimate-revision UI/recovery, exact optional AWG cents, Service
  preservation, General Project Work even with phases, browser acceptance/portable assets.
- 70a83eef: immutable Field start/resume Van captured inside assignment transaction from
  known catalog alias; per-interval attribution never uses today's WO Van. Historical
  missing evidence preserves visit minutes but leaves aggregate unknown. No backfill.
- 27458a105de6f7e9368a1afb48697103a2bb4f31: reject rescheduling completed/invoiced/paid
  primary/support work before writes, including concurrent completion. No history reset.

No push, PR merge, deployment, activation, permission change, migration or real-data write.
Return reviewed commits to #514 after release gates close. #515 remains separate.
`git merge-tree --write-tree 27458a10 3622bc5a4871b6ce7019af02f7354a5cc23171ee` has no
conflicts: tree f0dd9310eea9b2688c1fe0328ef7d75d000e7ba4. Final combined build/runtime was
blocked by disk exhaustion before disposable checkout creation; prior CI is not a substitute.

Deep Review: independent read-only Epicurus (sources/UI) and Laplace (Booking/Field).
Epicurus found MAX_SAFE_INTEGER cent precision issue (fixed with BigInt) and ran25 focused
unit contracts PASS. Laplace found mutable historical Van attribution (fixed), completed
WO reset (guard added), reschedule replay and stale-offer gaps (still open). Known alias
requirement addresses reviewer warning about VAN-looking physical IDs. Final terminal guard
has builder adversarial tests, not an independently executed test by Laplace.

Verified synthetic evidence:
- Typecheck and full ERP build including all6 prebuild suites PASS. Generated Next config
  changes restored; final typecheck after restoration PASS.
- Central browser -> real handler -> Auth/Firestore: Chromium/WebKit PASS,390px mobile,
  original66h/current70h15m, Service metadata preservation, stale version, lost response,
  reload/exact retry during writesPaused, cross-user read and unchanged protected stores.
- Drawer18/18; Field component16/16 (explicit synthetic read transport); execution
  Auth/Firestore11/11; Projects units198/198; Booking157/157; Field354+47 pretest PASS.
- Focused Field audit/mutation/execution52/52; independent UI/asset/recovery controls25/25.
- Windows Next export produced nested segments for dotted requested URLs. Test-only index
  serves only existing exact assets, rejects ambiguity/missing files. Navigation oracle,
  active-read proof and DOM/pageerror controls are unchanged; no weakened assertions.

Node24.18.0/npm11.16.0, Next16.2.11, Playwright1.57.0, firebase-tools15.30.0, Java21.
Functions targetNode22 still needs target validation. No dependency manifest/lock changes;
child locks untracked, followed existing CI install with package-lock=false. No physical
devices, deployed CORS/TLS/indexes or real WhatsApp tested.

Performance script `functions/projects/performance.emulator.cjs`: same synthetic data,
50 distinct identities, concurrency4/10/25/50,3 batches/route, alternating base/current,
2670 reads,0 errors, unchanged protected stores. At50 users p95 base/current ms:
list175.2/160.4; detail115.8/113.2; activity330.5/292.3; Field454.0/519.2;
materials379.6/385.6. Query/snapshot counts unchanged; Field response+64 bytes for4 IDs.
Warm emulator in-process timing, not visual/HTTP/production SLA. Field tail increase is
recorded, not claimed as improvement. Selector/availability/confirmation latency pending.
Existing Performance & Health histogram instrumentation preserved, not activated.

Frozen remaining work / NOT READY:
1. No functioning QuickBooks adapter/historical valuation/project-expense source found.
   Attendance/after-hours/crew do not supply full approved person/project time. Asked
   Christian for actual systems/files and explicit WO/project keys; do not invent authorities.
2. Inherited Booking defects: lost-response reschedule retry rejects closed offer; UI
   creates new request/discards validation. Two stale offers can revert quantity4->2.
   Cancel lacks expected-state token. Finish existing bookingIdempotency actor/payload
   receipts, canonical snapshot preconditions and actual edit/picker/cancel recovery callers.
   Terminal guard does not close these distinct contracts. Isolated development authorized.
3. C: exhausted. Clean task baseline worktree removed via Git; recursive cache cleanup
   auto-review rejected ('blocked by policy'), not bypassed. Exact single task-installed
   files removed safely to save checkpoint: functions/node_modules/@img/sharp-win32-x64/lib/
   libvips-42.dll and apps/erp-next/node_modules/@next/swc-win32-x64-msvc/
   next-swc.win32-x64-msvc.node. REINSTALL BOTH after space recovery before further tests.
   Failed document write restored from HEAD before this checkpoint. Asked for>=2GB or
   another drive; preserve previous worktrees/browser data. Original application commits safe.
4. Vercel project detail fails internal idOrName validation; effective root/env/flags and
   Firebase backend/indexes unverified. READY Git previews a99402e, production cb01c
   confirmed. No push because preview isolation unknown. Need isolated staging project/base.
5. Original browser origin/profile/raw Projects+templates and Matthijs IDs unavailable.
   No real DB/Storage export or restore drill. Need protected backups, isolated relational
   restore validation and approved reconciliation; checksum/fixtures are not certification.
6. A partial; B incomplete; C incomplete; D not granted. No publication recommendation.

Rollback: code, writesPaused and data restore are distinct authorized operations. Pausing
in emulator preserved reads/exact committed recovery/ordinary Booking. Do not revert adopted
central data to stale browser copies. Verify old-code compatibility or forward-correct;
preserve incident/post-backup work; never restore a whole old database over newer bookings.
Actual RTO/RPO remain unmeasured.

Next: restore disk/reinstall2 binaries, finish Booking receipts/preconditions/UI recovery,
recreate isolated final combined checkout and run affected gates. In parallel obtain real
cost/time source, isolated staging identity and original browser/Matthijs canonical IDs.

## Context

Christian approved implementation after the Projects audit, requesting clean, efficient
engineering. Development starts at main `cb01c4696a3a35dbc23c9989bc54473fa67356b5` on
`feature/projects-canonical-integration`. Merge, production deployment, security-rule
changes and production migration are NOT authorized by this task.

The active Projects planner stores records locally. Scheduling confirms canonical work,
then independently attempts a local Project link. Field execution is not reconciled back.
The code and screenshot establish that gap; the actual records of the reported Project
have NOT been read, exported, backed up or corrected during this implementation.

## Scope

First increment: dependency-free raw backup/verification; an isolated recovery page;
a bounded server-internal read-only reconciliation service; focused tests and staged ADR.
The recovery page deliberately does not mount ProjectsPhaseWorkspaceV2 or call its sanitizer.
A preview origin cannot export another origin's storage. The original browser/profile is
required for the real backup. Verification of a saved file is not proof of a cloud backup.

Not in this increment: central registry writes/import; appointment mutation; live Field
hours posting; Materials/Expenses/Financials; deployment; production reads through an HTTP
endpoint; replacing or modifying the existing planner, Scheduling, CRM, Field or telemetry.

## Governance

Deep Review, Solo Maintainer Adversarial Review. See the separate review and ADR.
Scheduling/capacity remains Booking Authority; visits/reports remain Field Operations;
Customer/Property IDs remain CRM; Inventory and accounting keep existing authorities.
Recovery diagnostics are not a new source of truth and cannot apply changes.
The internal reader verifies a revoked-token-aware Firebase identity and provisioned
active `super_admin` profile. No client role/capability grants server access. Wider operator
access is intentionally not implemented in this first recovery slice.
Legacy is untouched. Raw legacy values, including unknown fields/invalid JSON, are preserved.

## Acceptance criteria

- [x] Export only the two Projects storage keys; never enumerate or export session storage.
- [x] Preserve exact raw strings, original IDs, unknown fields and invalid source JSON.
- [x] Independently verify saved backup integrity and report duplicate/invalid source records.
- [x] No import, cleanup, write, delete, scheduling action, message or stock/financial effect.
- [x] Reconcile explicit IDs; never join by customer name or infer all support work belongs
      to a Project/phase. Related Work Orders are review candidates, not automatically counted.
- [x] Deduplicate retries and source rows. Block totals on conflicts or partial evidence.
- [x] Include General Project Work; preserve return visits and cancellation history.
- [x] Distinguish planned duration/slots from actual labor and physical completion.
- [ ] Validate recovery UI on Chromium/WebKit/mobile and actual authorization in emulator.
- [ ] Obtain and verify the original browser backup and authorized canonical evidence.
- [ ] Reconcile the real reported project, then implement/validate central persistence.

## Plan and risk

1. Complete and validate this recovery slice. Preserve the original browser data.
2. Produce a read-only real reconciliation with per-record source IDs and discrepancies.
3. Implement central planning records and transactional, versioned, auditable commands.
4. Join all confirmed Work Orders through the existing authority; reconcile lifecycle changes.
5. Derive measured execution through the existing Field authority, not local preview reports.
6. Connect costs through existing Inventory/Finance authorities; test all affected workflows.
7. Obtain explicit approval for merge, deployment and any separately reviewed migration.

Backup checksums establish integrity, not authenticity or import authority. A backup captures
raw keys and detects immediate concurrent changes; it does not claim an atomic multi-key
snapshot across all browser tabs. Stop editing while capturing and review against live sources.
An eventual migration must preserve original files and IDs, dry-run first, reject collisions,
record provenance, and provide tested selective forward recovery/rollback. No automatic
restoration or data deletion belongs in this slice.

## Verification

Local Node v22.16.0: `node --test functions/projects/*.test.js` — 42 passed, 0 failed,
0 skipped. Syntax checks passed. Tests use synthetic fixtures and a strict read-only database
double; they are NOT production or Firebase emulator evidence. The environment could not
resolve GitHub for a full local clone; full ERP types/build and transitive checks must run
in CI on the published branch. Existing CI/gates are unchanged. UI/browser and emulator
acceptance remain pending; this branch is not ready for merge.
