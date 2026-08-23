# Known Failure Patterns

These entries are historical regression guards. They document behavior already observed so
it is not reproduced; superseded behavior is not an implementation instruction.

| ID | Pattern | Prevention/detection |
| --- | --- | --- |
| FP-001 | Source patch scripts reapply or drift | Never run casually; inspect generated diff; prefer direct reviewed source |
| FP-002 | UI-only permission checks | Test denied service/data access directly |
| FP-003 | Stale availability accepted after display | Recompute capacity, route, staff, closures, and conflicts at commit |
| FP-004 | Duplicate customer messages from support work | One primary communication owner and idempotency key |
| FP-005 | AI carries an old intent into the current turn | Current-turn intent wins; preserve facts, not stale intent |
| FP-006 | AI invents price, duration, policy, or availability | Retrieve approved authoritative values or clarify/escalate |
| FP-007 | Provider retries duplicate writes | Verify origin; deduplicate by stable event/action ID; make handlers idempotent |
| FP-008 | Cached/projection state is treated as truth | Resolve writes through the domain authority and reconcile projections |
| FP-009 | Path-filtered CI misses a dependency | Review transitive consumers and run gates beyond the changed path |
| FP-010 | Push to `main` unexpectedly deploys production | Inspect matching workflows before push; require explicit deployment authority |
| FP-011 | Migration succeeds partially without reconciliation | Dry run, checkpoint, counts/totals, resumability, rollback/forward recovery |
| FP-012 | Legacy behavior copied as unexplained patches | Extract rule IDs and acceptance tests before ERP Next implementation |
| FP-013 | Van WhatsApp Group JIDs become associated with the wrong Van when identity is inferred from ordering or array position | Use stable canonical Van IDs and explicit JID mappings; verify uniqueness and fail closed when group identity is missing or ambiguous |
| FP-014 | Transactional WhatsApp provider drift selects Meta while production authority remains `wacli` | Read canonical provider configuration; never infer the provider from available adapters or code paths |
| FP-015 | Superseded Saturday 09:00-13:00 behavior reappears in one layer while the canonical calendar defines Monday-Saturday as normal operating days and Sunday as closed | Use one calendar authority and regression-test every consuming layer against the current operating-calendar rules |
| FP-016 | Full-day employee day-off logic reappears after being superseded by the canonical Van/team half-day and office-employee half-day model | Follow current authority and superseded ADR/rule history: technical recurring half-days belong to `vanHalfDaySchedules`; office/non-technical recurring half-days belong to `employeePayrollSettings`; dated absences remain separate |
| FP-017 | Appointment-to-Work Order projection loses customer-facing fields such as `customerFacingDescription` when downstream models rebuild fields | Define explicit field ownership and projection contracts; run end-to-end regression tests through Appointment creation and Work Order reads |
| FP-018 | Older code or PR assumptions resurrect architecture that a newer approved decision superseded | The latest approved ADR and current authority documents win; record supersession and never revive older architecture without a new approved decision |
| FP-019 | Broad Legacy CSS selectors affect ERP Next modules | Scope styles to their owning surface and perform cross-surface regression review |
