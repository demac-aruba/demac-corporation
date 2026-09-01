# ADR-SCHED-CAP-001: Booking Authority owns complete allocation; boards project it

- Status: Accepted for implementation on the audit branch
- Date: 2026-09-01
- Owners: DEMAC owner / Scheduling engineering
- Related task/rules: `tasks/scheduling-capacity-authority-deep-review-20260901.md`, OPS-SVC-001, OPS-SCHED-LUNCH-001, AD-008, AD-009
- Supersedes/superseded by: Supersedes fixed-four-Van and independent browser-capacity assumptions wherever they conflict with this decision.

## Precedence rule

Later approved ADRs may supersede this decision. Until then, a read projection may explain or visualize capacity but may not approve a booking independently of Booking Authority.

## Context

The LIVE board offered an elapsed same-day start while Booking Authority rejected it before capacity evaluation. The generic provider reason hid that temporal rejection. Separately, the generic capacity engine accepted arbitrary Vans only when it received them; numeric-only identity/projection filters removed future Van IDs first. Repeated local capacity interpretations have allowed the board, appointment workflows, and authority to disagree.

## Decision

1. A board tile is a **start slot**, never proof of a complete allocation.
2. Booking Authority resolves the requested work into a **resolved workload**, evaluates the **complete allocation**, and returns either allocation options or structured rejections.
3. Exact-target rejection records use an allow-listed machine contract: code, stage, Van, date, start, attempted work/capacity end, owned slots, optional blocking Work Order ID/slot, and bounded operational details. The operator receives a safe message derived from the code.
4. Canonical Work Orders and capacity locks remain the committed occupancy source. Offer commit is revalidated transactionally and idempotently.
5. Read projections consume canonical identity/status/slot semantics and fail closed when required operational state is unavailable.
6. Van IDs are opaque canonical registry keys. Numeric `VAN-N` aliases remain supported for historical data, but capacity behavior must not depend on fleet size or a numeric-ID regex.
7. Client-side request sequencing may suppress stale responses, but it never replaces offer versioning or transactional revalidation.

The capacity flow is:

```text
UI request (preferred Van/date/start + work lines)
  -> Office Booking Authority
  -> resolve canonical workload
  -> evaluate complete allocation against canonical snapshot
  -> allocation option OR structured rejection
  -> UI projection/explanation
  -> transactional commit revalidation
  -> canonical Appointment + Work Orders + capacity locks
```

## Alternatives considered

| Alternative | Benefits | Costs/risks | Why not selected |
| --- | --- | --- | --- |
| Count adjacent green board tiles in React | Quick visual fix | Creates another capacity authority and races stale data | Violates the authority boundary |
| Special-case Van 4 / Other 180 | Small patch | Does not address elapsed starts, diagnostics, status drift, or future Vans | Reproduces the recurring bug class |
| Keep numeric Van whitelist and extend it per Van | Low immediate change | Every fleet change requires code and can silently drop Work Orders | Violates the future-proof requirement |
| Make every board tile call a mutation-grade availability check | Strong parity | Excessive latency/read load and poor UX | Projection parity plus final authority revalidation is sufficient |

## Consequences

- Positive:
  - One authoritative bookability decision and explainable denials.
  - Complete allocation is visible instead of a misleading one-hour open block.
  - Fleet growth does not require scheduling code changes.
  - Board/authority drift becomes testable.
- Negative/tradeoffs:
  - Additional diagnostic data and parity tests increase the contract surface.
  - Projection code still needs a lightweight current-time display rule; tests must prove it matches the authority boundary.
- Security/privacy: rejection data is allow-listed and must not include customer/contact/address content.
- Scalability/operations: availability reads remain date-scoped/cacheable; mutation checks remain live and transactional.
- Migration/compatibility: existing response fields stay valid; new workload/rejection fields are additive. Numeric historical aliases remain supported.

## Verification and rollout

- Acceptance evidence: required 22-case authority matrix, board parity test, and future-Van proof A/B/C.
- Observability: stable rejection codes/stages in authority responses and bounded internal metadata.
- Rollback or forward recovery: revert the PR before merge; no schema migration is necessary.
- Review date/triggers: re-review when workday/lunch/route policy changes or when a new scheduling consumer is introduced.
