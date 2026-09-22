# Review: Current Project slot budget and chronological details

## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review
- Builder and reviewer: Codex, separate implementation and adversarial passes. No independent-review claim.

## Scope and authorities
- Reviewed the complete feature diff, existing Project creation/link model, portfolio/planner callers, Firestore access rules, role capability mapping, Scheduling Work Order creation/move/cancel semantics and attendance ID/policy.
- No Scheduling/attendance writes, rules, indexes, Functions or source-of-truth changes. Existing estimatedSlots is the Van-slot budget; technician count cannot multiply it. Historical write authorization remains unchanged.
- Current linked Work Orders supply slots/date/Van/crew. Browser preview assignments do not count as live reservations. Daily attendance does not prove presence at a Project.

## Findings addressed
| Severity | Evidence | Resolution |
| --- | --- | --- |
| Medium | In-flight attendance workers could start further batches after access revocation. | Cleanup aborts subsequent batches and invalidates rendered data by principal, row identity and refresh revision. Unit test covers aborted batches; browser test covers revoked payroll access and stale-session responses. Already-issued reads may finish but cannot render. |
| Medium | A failed read must not turn an allocation into zero or an all-clear dashboard metric. | Per-record failure remains unverified, total is labeled incomplete and the overall risk count is withheld. Confirmed missing documents alone are marked removed with zero slots. Recovery re-reads the source. |
| Medium | Separate WOs from one appointment could be claimed by different Projects. | Cross-Project appointment claims fail verification, consistent with the existing Scheduling label projection. Exact Work Order/Appointment/Customer/Property checks precede crew exposure. |
| Low | Plain record prototypes and delimiter-joined claim identities can create ambiguous edge cases. | Own-property lookup, null-prototype transport records and JSON tuple identity; regression cases added. |
| Low | An absent attendance record could display stale clock times as if worked. | Clock interval is rendered only for Present/Late statuses. Missing records never become inferred Project attendance. |

## Verification
- PASS ERP typecheck.
- PASS 10 slot-progress acceptance groups: budget boundaries, backdated add/reduce/increase/move/cancel/remove, duplicate/conflicting links, invalid/missing data, crew changes, attendance corrections, privacy, bounded direct reads and abort.
- PASS real React Projects page in Chromium and WebKit, desktop 1440px and mobile 390px: 75/66 slots, red +9, chronological detail, correction refresh, focus refresh, historical link addition/removal, failure/recovery, access revocation, stale response suppression and no external requests. Screenshots visually inspected.
- PASS Projects preview, 21 budget advisory cases, 11 transport cases and phase planner acceptance.
- PASS live Scheduling/card attribution/Project labels, Dispatch and appointment lifecycle suites.
- PASS complete production build and all mandatory prebuild gates (employee schedule, attendance, Work Order attendance, Van profile, Projects, Task Tracker and new slot progress).
- CI/integration and staged deployment verification are recorded with the release report after the source commit.

## Decision
- [x] Pass with recorded scope limitations
- UI keeps allocation and physical completion distinct. The existing Field actuals integration is not implemented by this change.
- Only existing exact Project links are reconciled. A booking lacking a Project link cannot be guessed from customer/name/date. Projects remain in existing origin-specific browser storage; this change does not centralize them.
- Recorded WO crew is displayed as assignment evidence, not reconstructed historical Van membership. Existing payroll-sensitive roles can also see explicit daily attendance; other roles cannot fetch it.
- This projection does not rewrite older browser booking-advisory snapshots/counters or permit new historical Project writes. The new bar and details use current canonical reads regardless of those snapshots.
- No private production Project or attendance records were accessed during verification; synthetic browser tests and subsequent deployment-asset checks must not be represented as an authenticated production-data test.
- Frontend rollback is the prior combined a5cd9139 deployment. Existing owner authorization covers merge/deployment after passing checks; this change uses the current Van-slot rule, not a new technician-slot budget.
