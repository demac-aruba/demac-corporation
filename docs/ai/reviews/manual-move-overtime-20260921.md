# Review: controlled possible overtime for a manual Van transfer

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer: Codex, separate final adversarial pass after implementation.
Implementation author: Codex. This is not an independent review.

## Scope reviewed

- Complete task diff against cb01c4696a3a35dbc23c9989bc54473fa67356b5.
- Existing move candidate calculation, integrated confirmation, refreshed agenda/metrics,
  office facade/roles, operational transaction, reschedule, availability and after-hours.
- Booking Authority remains the scheduling writer; Firebase identity/office role guard,
  canonical capacity/calendar/crew, existing communication and payroll boundaries remain.
- Rule: OPS-SCHED-MOVE-OT-001. Legacy Expo, pricing, payroll, security rules and deployments
  are outside the changed surface; no migration or new authority was added.

## Findings

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| High | Operational move retry | Last-request-only replay could repeat an old move after a newer one | Atomic receipt in existing bookingIdempotency; exact replay and changed-payload tests pass |
| High | Capacity readers | Elapsed work may be shorter than assigned slots; an ordinary move could consume the protected tail | Existing availability and manual conflict readers honor accepted capacityEnd; focused regression passes |
| High | Emergency race | Separate emergency/move documents could permit overlapping writes | Shared existing BAH guard plus full Work Order interval checks; real emulator race has one winner |
| Medium | Later reschedule | Current estimate could survive a later ordinary placement | Clear only current marker through canonical lifecycle; preserve historical audit; regression passes |
| Medium | Consent presentation | Dense agenda font rules reduced warning readability | Scoped modal typography and overflow; final screenshot inspected |
| Medium | Failure notice | Network timeout does not prove the server failed before commit | Refresh canonical agenda and avoid claiming rollback on ambiguous network failure |

All recorded findings are resolved in the final diff. The reviewer challenged source lock
ownership, support relations, source revision changes, complete tail overlap, crew conflicts,
maintenance/closures/absences, same-Van misuse, historical/executed work and lunch gaps.

## Verification

| Gate | Result |
| --- | --- |
| Functions test:booking-authority | 158 passed, 0 failed |
| Functions test:transactional-whatsapp | 117 passed, 0 failed |
| Node 22.23.2 manual move units + real Firestore emulator | 30 passed (22 unit + 8 integration), 0 failed/skipped |
| ERP typecheck | Pass |
| ERP test:live-scheduling (including Saturday drag) | Pass |
| ERP test:lifecycle, test:booking-intelligence, test:booking-copilot | Pass |
| ERP production build and configured prebuild checks | Pass, demo Firebase configuration |
| Functions validate:firebase and changed JS syntax | Pass |
| Actual ERP browser + backend + emulator | Pass: cancel button/Escape/backdrop zero writes; double click one request; acceptance/full refresh/metrics; injected concurrent conflict |
| Browser network/errors and final images | No external requests or page errors; inspected modal and moved agenda |

The emulator rejects unauthenticated/invalid-token/technician calls through the existing
facade, stale/missing consent and changed retry payloads. Real transactions test exact
duplicate submission, competing moves, a regular automatic booking race, and an after-hours
race. Losers retain their original documents and locks. Injected transaction failure leaves
the complete original store unchanged. Source notification metadata survives; successful
replay writes no duplicate lifecycle/receipt. No notification transports run in the preview.

Evidence logs and screenshots are delivered with the patch. The isolated harness refuses
non-demo project IDs and non-loopback emulator hosts; browser outbound requests are blocked.
Synthetic authentication exists only in test-support, outside the production bootstrap.

## Decision

- [x] Pass for isolated preview and owner validation
- [ ] Approved for merge/deployment

Residual risk: production token infrastructure, deployed triggers, external WhatsApp delivery,
production-scale Firestore contention and real-data inconsistencies were not exercised.
Existing notification regressions pass, but do not constitute a real message delivery test.
Multi-Van/support bookings intentionally retain the coordinated-reschedule restriction;
this exception cannot split or silently reassign them. Normal manual move legacy leniencies
were retained; strict restrictions apply to the new exception.

Owner: ERP maintainer and DEMAC Operations. Due: before any approved release. Validate the
local preview, review deployment ordering (backend before UI), and plan latency observation.
For rollback before use, revert the task commit. After real accepted transfers exist, retain
the bounded readers/guards and disable new proposals with a forward patch; do not rewrite
appointments or erase audit. Human approval is still required for merge and deployment.

## Owner acceptance and merge-only integration

On 2026-09-21 the owner validated the synthetic Preview and approved the merge. After
being informed that main-push workflows also deploy production and run existing WhatsApp
queue/group migrations, the owner confirmed proceeding with the proposed merge-only path.

The merge commit must include the exact marker `[merge-only]`. The five production jobs
selected by this task's paths (Office Booking, Work Order, Customer Agent, Field Operations
and Transactional WhatsApp) reject that marker on a push. All validation jobs, steps and
triggers remain unchanged. Both Vercel configurations use the documented ignoreCommand
mechanism to ignore that marked revision. No workflow is globally disabled, no credential
or security rule changes, and no data migration runs for this merge. Future unmarked
commits retain the existing publication behavior; this is not a permanent release freeze.

The scheduling implementation approved in commit fec8cc66 is unchanged. Before merging,
verify the production-condition matrix, actual ignore-command exit codes, complete CI on
the final head, exact expected head SHA and unchanged base. After merging, verify skipped
production jobs, successful validation and canceled Vercel builds for the merge SHA.

Source: https://vercel.com/docs/project-configuration/vercel-json#ignorecommand — exit 0
ignores the deployment build; exit 1 continues it. The marker is not a GitHub skip-CI token.
