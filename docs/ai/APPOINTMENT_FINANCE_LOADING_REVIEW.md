# Appointment finance loading and tab affordances — 2026-10-10

## Task / context

Builder: `/root`. Independent reviewer: `/root/financial_review`.
Mode: Deep Review, following the owner's optimization request and existing requirement
that appointment/financial updates preserve operating workflows and real records.
The owner previously authorized merge/deployment of this appointment update.
PR #567 builds on main `6b60226bf0fad2b85120ff2d04b8363e931629f9`, preserving #566.

Evidence: the financial workspace mounted only after clicking a tab and unmounted on
return to Summary. Each visit repeated the authoritative read. The initial single-line
loading message shrank the modal. Enabled tab buttons lacked a pointer cursor.
Backend inspection also found sequential reads, but no authenticated production latency
measurement attributes a particular share of the delay to those reads or cold starts.

## Scope and acceptance

- [x] Preload authoritative finance data when the appointment opens; retain the same
  workspace across Summary, Charges and History without repeat reads for fresh data.
- [x] Deduplicate concurrent read attempts; initial loading uses matching cards/panels
  without fabricated zero amounts. Preserve existing data during refresh.
- [x] Display last successful consultation time; refresh on return/focus/visibility if
  at least 30 seconds old. Suspend automatic refresh while a draft, payment, mutation
  or uncertain request is active. Failed reads retain data but block financial writes.
- [x] Preserve exact version/idempotency and Field reconciliation requirements; changing
  financial versions never silently upgrades an existing draft's expected version.
- [x] Read failures, permission denials and slow reads do not lock ordinary appointment
  navigation or dismissal. In-flight and uncertain writes retain existing modal locks.
- [x] Every enabled appointment tab has the hand cursor. Disabled semantics remain.

Out of scope: backend latency changes/deployment, migrations, monetary calculations,
new accounting screens, realtime subscriptions and global/persistent client caches.

## Governance / parity / failure mapping

Booking Authority remains the owner of appointment financial state and version checks.
`OPS-SCHED-CHARGES-001` remains unchanged: immutable original estimate, current/final
amounts, actual receipts, explicit Field reconciliation, versioned/idempotent mutations
and dated audit. QBO, Legacy monetary blockers and source-of-truth boundaries are intact.
The API actions, server authentication/authorization, Firestore schema/rules and stored
customer/appointment/payment records do not change.

The mounted workspace owns its read resource. The drawer keys it by appointment ID.
`LiveSchedulingOverview` keys its subtree by principal userId/active/capabilities, so
session/capability changes clear this cache and drafts. Late unmounted responses are
ignored; shared pending read promises also survive React StrictMode effect replay.
This is UI memory, not a financial authority. Server version/fingerprint validation
still decides whether a write is valid if another operator changes data between reads.

Draft edit and payment versions are captured independently when each form starts.
Manual refresh may retain a draft while marking a conflict; saving is blocked until the
operator leaves and restarts against the current record. Field acknowledgment stores
the explicitly reviewed fingerprint; new evidence invalidates the checkbox. Read errors
are separate from mutation errors. A read never clears an uncertain request or its ID.
Successful mutations still force an authoritative reload, without optimistic balances.

## ADR — local read resource, no shared cache

Status: Accepted for this scoped UI update. Owners: ERP Scheduling maintainers.
No existing domain ADR is superseded; no source of truth is introduced.

Decision: preload and deduplicate within one mounted workspace, use successful-read
age to revalidate on navigation/focus, preserve authoritative snapshots visibly, and
fail closed for financial writes after read errors. Never auto-refresh active drafts.

Alternatives: a global query cache would require additional principal/identity eviction
and broader dependencies for this one surface; backend parallelization could improve
first-read latency but needs measured evidence and separate release/recovery validation.
A spinner alone would leave repeated network work and modal collapse unresolved.

Tradeoff: opening an appointment now performs one financial read even if Charges is
never selected. Repeated tab visits within 30 seconds reuse it. There is no polling.
A first click before prefetch completes still waits for the server; the skeleton keeps
navigation usable. Data is not realtime: manual refresh remains available, and writes
always receive server version checks. Review the backend if measured first-read latency
remains materially slow. Owner: ERP Scheduling maintainer, triggered by production evidence.

## Verification

- TypeScript and production build: PASS. Exact-head CI is a release gate recorded in PR.
- Existing detail browser suite: 17/17 PASS, now including financial draft preservation
  across Summary in addition to Charges/History, and lifecycle/reference/communication
  parity, pending-write locks and desktop/mobile geometry.
- Existing real financial transport/facade suite: PASS at 1440, 1366 and 390 pixels,
  including pricing/BTU, final scope, four payment methods and unknown-outcome retry.
  Independent reviewer also executed this suite successfully.
- New real drawer + financial component + hook browser suite: 10/10 PASS. Includes
  development StrictMode, delayed prefetch, dedupe, fresh tab reuse, stable skeleton,
  refresh failure/recovery, version/fingerprint conflicts, payment draft preservation,
  uncertain request exact retry, appointment/session isolation, late response discard,
  close during read and denied prefetch without blocking the overview.
- Controlled 1,200 ms authority delay: clicking after prefetch displayed finance in
  94 ms desktop / 82 ms mobile in the builder run. This measures fixture UI behavior,
  not production server response time. Repeated tab switches issued no additional read.
- Visual inspection: actual component screenshots on desktop/mobile and initial loading.
  Icons, DEMAC colors and the premium card/panel layout are retained.
- Synthetic browser adapters prohibit external network access: zero production writes,
  customer modifications or messages. No live financial write smoke was performed.
- New suite is a required ERP CI step with retained synthetic screenshots/results.
  Existing checks remain enabled; final CI IDs and release evidence belong to PR #567.

## Independent review and release

Review uses `REVIEW_TEMPLATE.md` lenses: full diff/callers, authority, stale reads,
StrictMode, version/fingerprint conflicts, pending retries, auth scope and recovery.
Findings during design: stale drafts must pin their expected versions; Field review
must pin its fingerprint. Both are implemented and covered by the new browser suite.
Final independent review: PASS, no material findings remain. Reviewer independently ran
10/10 loading cases, 3/3 financial viewport flows and diff checks, and inspected the
skeleton screenshot. Generated Next configuration changes were excluded from the commit.
Exact-head CI and deployment verification remain release gates in PR #567.

No backend/config/security deployment or migration. Merge using `[merge-only]`, verify
merged tree equals the tested tree, and explicitly deploy `demac-corporation-web`.
Rollback: redeploy the previous frontend; canonical data needs no reversal.
Residual limit: first-response server/network latency is not eliminated or measured
in production by these controlled browser tests. Do not claim live-data E2E coverage.
