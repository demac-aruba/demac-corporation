# Review: new afternoon booking with possible overtime

## Review mode

- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Implementation author and reviewer: Codex. Separate adversarial pass after implementation;
this is not an independent review. Base: `246814113274bc50f4eda2d8795568ae82ae6b3b`.
Branch: `fix/new-booking-possible-overtime`. No production booking or customer message used.

## Scope reviewed

- Owner's Van 4 case: four Standard Services at 13:30 with three ordinary slots. Prior
  `OPS-SCHED-MOVE-OT-001` covered transfers, not new bookings. `OPS-SCHED-CREATE-OT-001`
  now covers explicit office creation; weekly-rest and emergency behavior remains covered.
- Complete implementation/test diff, ordinary availability caller, authenticated office facade,
  special booking transaction, duration/crew planner, canonical capacity projection and labels,
  cancellation/reschedule/move consumers, request recovery, Projects exclusion and recipient flow.
- Existing Appointment/Work Order authority and BAL/BAH ownership are reused. No collection,
  security rule, payroll authority, automatic-availability or production-data migration change.

## Findings

| Severity | Evidence and impact | Resolution |
| --- | --- | --- |
| Medium | A new capacity booking initially reused the weekly-rest visual classification incorrectly and then displayed an outside-capacity warning despite accepted planning. | Preserve the accepted planned-overtime flag and project its kind separately; persisted browser assertions verify the correct possible-overtime label and absence of the misleading warning. |
| Low | Synthetic auth recreated `refreshPrincipal` on every render, retriggering load/validation and preventing automatic availability assertions. | Stabilized only the test stub to match the real provider. Automatic validation assertions remain in place; no manual recheck workaround. |
| Low | Initial concurrency test called a nonexistent ordinary confirmation method; its unawaited competing transaction affected the next test. | Use the actual `createAppointment` API and await both competitors. The complete emulator suite passes. |

No unresolved product finding from the final pass.

## Verification

- 138 focused/transitive Node tests pass: special booking, operational move, appointment lifecycle,
  capacity availability, office authority/facade and scheduling provider/engine.
- Real Firestore emulator: all 10 shared planned-overtime tests and all 8 manual-transfer tests pass.
  Covers exact concurrent retries; normal versus overflow, overflow versus overflow and emergency
  races; read-only preparation; absent/invalid/technician authorization; changed crew/consent.
- ERP typecheck, live-scheduling acceptance (five reported suites), Firebase syntax validation
  and direct syntax checks of both modified planner/authority files pass. Final production Next
  build, including all seven configured prebuild suites, passes. Mandatory CI/preview checks
  must finish successfully before merge; exact release evidence is recorded in the PR.
- Real React agenda, real client transport and office facade against synthetic Firestore:
  all 14 browser scenarios pass. Three services still use ordinary capacity; four show 4/3 and
  17:30; scope changes retire the warning; declining confirmation creates no appointment;
  a deliberately lost successful response recovers the identical request and saves exactly one
  appointment with all four locks. Reload confirms the correct label. Desktop/mobile inspected.
  No page errors, external requests, attendance records or outbound message writes.
- Unit negatives include fitting workload, invalid/morning/rest starts, crossing midnight,
  changed actor/work/instructions, absent staff and interval conflicts beyond ordinary slots.
  Cancellation releases all four locks; replay does not resurrect a canceled booking.
- The additional `agent-browser` CLI smoke remains failed in this workspace because its daemon
  cannot start. The integrated Playwright/official Chrome headless-shell assertions above pass.
  This is recorded as a tool-environment limitation, not reported as a passing CLI run; no
  assertion, CI gate or CLI failure has been suppressed or weakened.

## Decision and residual risk

- [x] Product review passes, conditional on green release build/CI/preview gates.
- Production authenticated creation is intentionally untested to avoid creating an actual
  customer booking. Synthetic end-to-end verification exercises the same write authority.
- The estimate describes planned capacity, not payable overtime; actual attendance remains
  authoritative. Existing post-save notification behavior is retained, not triggered as a test.
- Rollback: revert this PR and redeploy the same application/function. No migration is needed;
  prior deployed readers already retain generic accepted `scheduledOvertime` reservations.
- Owner's earlier explicit merge/deploy authorization in this same Scheduling task applies to
  this requested correction. Verify exact merged SHA in function CI and production Vercel
  deployments and perform read-only public/auth-denial smoke checks before reporting release.
