# ADR-20261026: atomic regular Van crew planning

- Status: Accepted for controlled rollout; final CI and publication proof pending
- Date: 2026-10-26
- Owner: ERP maintainer
- Related: [task](../tasks/van-roster-bulk-20261026.md), OPS-VAN-PROFILE-001/002,
  OPS-STAFF-SCHEDULE, OPS-STAFF-ATTENDANCE

## Context and decision
Per-Van uniqueness and minimum-crew validation prohibit even a valid two-Van swap.
The editor therefore retains one fleet draft and submits a single authenticated
command to existing Office Booking Authority. Final crew validation and all affected
planned links commit atomically. `vans` remains the regular-crew source of truth;
embedded effective history describes prior membership without creating a parallel roster.
An existing private businessSettings subcollection stores idempotency/audit events.

The command is effective today in Aruba. Payroll derives the employee's recurring
schedule from the Van held on the requested date. It does not rewrite stored attendance,
compensation, rates, completed jobs or Field actuals, and it does not modify weekly rules.
Pending Work Orders, matching Appointments, Project links and staff/login compatibility
references follow the new crew. Booking transactions reject an outdated crew snapshot.
Explicit daily assignments are preserved and validated for final-state collisions.

## Alternatives
| Alternative | Reason not selected |
| --- | --- |
| Temporarily unassign and save each Van | Exposes incomplete fleet state and cannot safely synchronize dependent records |
| Permit duplicate workers permanently | Violates crew uniqueness and dispatch/payroll ownership |
| Update regular crew only | Leaves pending work and login metadata stale and changes historical payroll inference |

## Consequences and recovery
Server transactions enforce fresh provisioned roles, observed fleet token, final crew
readiness, exact planning links and absence of execution evidence. No partial success;
an uncertain response retries the identical request. Browser/Legacy direct crew writes
are denied while vehicle edits retain their existing authorized path. Audit and execution
history are private; fixtures contain synthetic data only.

Transfers are bounded and may be refused for started work, conflicting dated overrides,
an oversized schedule or exhausted embedded history. Multiple changes on one date keep
their audit; the last effective crew supplies that date's inferred schedule. Recorded
attendance preserves the day's explicit payroll decision. Intraday schedule splitting
and weekly-rule versioning are outside this change.

Rollback must not delete history or restore stale employee/work snapshots blindly. Use
a reviewed compensating crew command when work remains unstarted, or reconcile the
specific execution conflict. Retain production source/rules baselines before release;
do not roll back to a reader that ignores history after transfers have been recorded.

Before rollout: pass emulator/browser gates, compare deployed immutable source, prepare
the narrow source-only function release, deploy reviewed rules and ERP, then perform
read-only smoke checks. Existing WhatsApp Van destinations are preserved; participant
enrollment is an external integration gap requiring resolution before a claim of fully
automatic employee messaging. Review this decision before first production transfer.
