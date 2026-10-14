# Review: Immediate invoice-draft amounts

## Review mode
- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review
Reviewer: `/root/projection_review`; Builder: `/root`. Reviewer changed no files.
Scope: complete frontend diff, directly affected quote/authority consumers and
OPS-SCHED-CHARGES-001/002. Base `b8e7bc13` includes the current production QBO runtime
`f511d905`; their intervening changes are documents only.

## Findings
No unresolved material correctness, data-loss, authorization or concurrency findings.
Minor acknowledgment-state observation: a failed quote disabled confirmation but left
the scope checkbox available. Corrected it to require a current canonical quote too.

## Evidence
- Independent browser: 4/4 focused scenarios, external requests 0, production writes 0.
  At 1200 ms simulated authority latency: quantity amount 47.5 ms; repeated selection
  125.8 ms. Canonical changed rate replaces the preview before review. Late response
  cannot overwrite it; explicit refresh clears prices; failure clears evidence.
- Reviewer independently compared 17 arithmetic/identity probes with real backend
  `inputLines`/`quoteLines`: rounding, invalid quantities, totals and retained/manual/
  projection isolation passed. These probes were temporary, isolated and read-only.
- Builder: 69 real-drawer scenarios, 7 real HTTP-to-authority browser flows, 45 backend
  charge/edit-session tests, 13 balance/preview/PDF checks, 8 recovery checks, types
  and diff whitespace check passed. Reviewer inspected browser/flow evidence.
- Before/after same controlled 1200 ms response: quantity display 1879.3 ms → 47.5 ms;
  repeated selection 98.7 ms in the full suite. Three rapid changes issue one quote
  request and zero appointment/catalog reloads. 1000-item/60-line search remains local.
- Source review: only the exact current authority quote carries the save token; preview
  never writes amounts, changes receipts, marks a visit paid or bypasses leases/version/
  idempotency. Scope and error invalidation, historical price isolation, bounded cache,
  complete totals and empty/invalid values verified. No backend/schema/config changes.

## Decision and limits
Pass for this focused change, subject to exact-head integration CI and deployment
verification. User's standing audit-then-merge/deploy authorization applies. No real
customer mutations or communications were used as tests. Measurements are controlled
synthetic results, not a production-wide latency guarantee. A first unseen item still
needs its authoritative rate; only that row waits and editing continues. Server
validation still runs before confirmation. Rollback frontend only, retaining all saved
work and payments; pre-release deployment `dpl_FBfeq8nhFRjtaQewskyewhzoG65a`.
