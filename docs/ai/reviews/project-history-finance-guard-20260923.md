# Review: in-place Project historical capacity and evidence guard

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: `/root/field_hours_audit` (independent read-only code review, 2026-09-24).
Implementation author / agent: Codex Builder (`finance_guard`).

The reviewer did not implement the runtime changes. This review is a code verdict, not authorization to deploy.

## Scope reviewed

- Request/acceptance criteria: `docs/ai/tasks/project-history-finance-guard-20260923.md`.
- Diff/commit: uncommitted `fix/project-history-commercial-guard-20260923` based on `38542864`.
- Affected callers/integrations: Project API, Booking Authority Appointment/WO/locks, Project planning links, Field, local ERP financial mirrors, ERP Next UI and CI.
- Authorities and rule IDs: Booking Authority, Project Registry, Field Operations, operational Finance, QBO accounting; OPS-SCHED/OPS-TEAM.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| High, addressed in Builder patch | Old cancel/replacement API | New edits would change identity and leave stale summary counters, but some bookings are already cancelled. | Use in-place service for confirmed bookings; retain guarded `history_preview`/`history_confirm` only for recovery of an already-cancelled clean source, rebuild its Project counter from canonical Work Orders. |
| High, addressed in Builder patch | Field execution and first Visit race | Query-only evidence could miss a concurrent deterministic first Visit. | Read its deterministic document in the transaction and query legacy Visits by WO/Appointment; block any Office Review or Field actual. |
| High, addressed in Builder patch | Added capacity | An existing lock with missing `active` is ambiguous; a legacy WO may occupy Van/crew without a lock. | Only reuse a lock with `active === false`; check same-day WOs and fail closed on ambiguous overlapping crew/interval. |
| Medium, addressed in Builder patch | Project summary and retry | A stale `scheduledFutureHours` counter and replayed historical result could contradict canonical state. | Derive budget/usage from all linked WOs; derive unposted counter separately; return original `replayedEntry` and current state separately. |
| Medium, addressed in Builder patch | Project/phase identity | Appointment, WO or planning-link metadata can disagree with the published claim after another Scheduling change. | Compare present Project/phase IDs and link date/start/end/Van/crew with the canonical booking; fail closed on disagreement. |
| High, residual release control | External QBO | Local documents cannot establish absence of an external invoice/payment. | Require and audit operator no-billing attestation under the owner's current no-active-billing policy; do not represent it as QBO verification. A separate authoritative check is required before external billing is active. |
| Follow-up, preexisting | Project-linked reschedule | Ordinary Scheduling reschedule can change Appointment/WO/locks without updating Project link metadata. The new correction detects the disagreement and refuses the write, but cannot reconcile it. | Provide a separate atomic Project reschedule/link repair path; do not weaken the fail-closed check in this release. |
| Follow-up, scale | Source selector | The selector validates linked appointments sequentially; Projects allow up to 150 links under a 60-second API timeout. | Page or batch verification before relying on this selector for large Projects. No incorrect write results from a timeout. |

## Verification

- Independently run: `npm run test:booking-authority` in `functions` (172/172 PASS, using the existing local dependency path), `npm run typecheck` in `apps/erp-next` (PASS), `npm run validate:firebase` (PASS), release-guard unit tests (6/6 PASS), `node --check` on the emulator/browser scripts and `projectSlotUsage.js` (PASS), and `git diff --check` (PASS). Builder reports the combined focused service/lifecycle set 24/24 PASS; the reviewer separately observed the in-place focal suite 9/9 PASS before the final frozen delta, which is included in the later 172-test run.
- Security and permission cases: Project-only identity, fresh role, direct-write deny emulator case.
- Business-invariant cases: exact same Appointment/WO, whole slots and lunch anchors, budget acknowledgement, posted/unposted Project summary, no Field/financial actual mutations.
- Retry/concurrency/idempotency cases: exact replay after later billing and another correction; divergent request ID, lock/WO conflicts, transaction evidence reads.
- Failure/recovery cases: failed/malformed evidence and ambiguous lock/claim block before writes; retry same request ID after uncertain response. The restored legacy API is limited to an already-cancelled, unexecuted and unbilled Project source; the in-place path remains mandatory for confirmed bookings.
- Unverified areas: isolated Firestore emulator/browser CI (Java is unavailable on this host), production ERP build on the final diff, and external QBO state. The revised bounded release guard has unit coverage, but its live cloud-source checks cannot be proven by local mocks.

## Decision

- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Block / changes required

Code review found no remaining new P1/P2 correctness defect in the scoped in-place operation or guarded legacy recovery. **Merge/deploy remains blocked pending the required isolated Firestore emulator, two-browser-session and final ERP build CI gates.** A green unit suite or this review is not a substitute. The owner's selected scope corrects booked Van slots, not individual technician actual hours, Field records, Attendance, payroll or QBO; do not describe it as a complete actual-work correction. Finance/owner must revisit manual no-billing attestation before external billing goes live. No rollout date established.

Human approval still required before production deployment or any irreversible action.
