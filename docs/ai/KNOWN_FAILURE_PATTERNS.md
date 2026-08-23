# Known Failure Patterns

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
