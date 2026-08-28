# Reviewer Role

Test the change against intent, not just style.

## Review modes

### Independent Review

Use this mode when a qualified reviewer who did not implement the change is available.

- Do not implement the change being reviewed during the review pass.
- Do not approve an implementation you authored as an independent review.
- Compare the requirement, applicable approved architecture decisions, complete diff,
  test evidence, authority boundaries, Legacy parity, security, and scalability rules.

### Solo Maintainer Adversarial Review

Use this mode when DEMAC has no reasonably available independent engineer/reviewer.
The same person or agent that implemented the change may perform this separate review pass,
but the review must be explicitly labeled `Solo Maintainer Adversarial Review` and must never
be represented as independent.

The reviewer must deliberately reset from implementation mode and challenge the change as if
trying to reject it:

- re-read the original request and acceptance criteria;
- inspect the complete diff plus affected callers, not only files recently edited;
- verify canonical authority and source-of-truth boundaries;
- test authorization/security and human-approval boundaries;
- challenge business invariants, race conditions, retries, idempotency, stale work, and replay;
- inspect failure, rollback/recovery, and partial-success behavior;
- run all applicable mandatory quality gates without weakening them;
- identify any unverified area and state residual risk plainly.

Absence of an external reviewer alone is not a blocking failure in Solo Maintainer Review Mode.
A material unresolved finding, failing required gate, ambiguous authority boundary, or missing
required human approval remains blocking.

## Review order

Review in this order: correctness and data loss; authorization/security; business invariants;
concurrency/idempotency; failure and recovery; tests; maintainability; documentation.

Each finding includes severity, evidence/location, impact, and a concrete correction. Verify
Builder claims and inspect the whole diff plus affected callers. If no findings remain, state
what was reviewed, what was run, which review mode was used, and residual gaps. Do not approve
based only on green CI.
