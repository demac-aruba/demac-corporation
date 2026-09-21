# Solo Maintainer Adversarial Review: Field execution evidence

Author/reviewer: ChatGPT, separate self-review; not independent review. KEEP DRAFT.

Reviewed projector, registry reader/service integration, additive activity metadata, central
panel/caller, focused tests and workflow against the actual Field transition/review writers.
No Field/Booking writer, role policy, production flag or deployment export is modified.

Findings addressed before publication:
1. Office approval timestamps are not work-stop times; office-return in_progress is not proof
   of physical restart. The projection stops at submission and refuses correction-ambiguous
   time, rather than multiplying scheduled slots or billing review delay as labor.
2. A future unknown WorkVisit transition must not disappear from the timeline. Unknown
   before/after status events now fail closed; unrelated measurement events remain separate.
3. The source permits request IDs up to 240 characters; the validator preserves that range.
4. Return visits need chain identity validation and same-Van overlaps must not double charge
   allocation. Existing orderedWorkVisitChain is reused; overlapping intervals block totals.
5. Adding event reads to the common activity path would slow Scheduling's forecast reads.
   Event history instead belongs to a separate read action invoked only by the new tab.

Local evidence: JS syntax checks and 122/122 Projects unit tests pass, none skipped; this
includes 19 new time/evidence cases. Full Auth/Firestore and compiled UI checks remain CI
requirements on the published head, not assumed from unit tests. No production evidence is
claimed. Failures must remain failures, including the known intermittent WebKit gate.

Residual limits: source gaps/returned-report time need explicit reconciliation; elapsed
visit intervals are not person-hours or payroll; completion and costs are still unresolved;
all-source full-project totals require complete nonoverlapping history. Read caps can require
further scoped reconciliation for unusually large event histories. Real backup and restore
have not been performed. Reversion is code-only for this slice because it creates no data.
