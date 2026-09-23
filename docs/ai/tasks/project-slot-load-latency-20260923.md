# Task: Reduce current Project slot loading latency

## Context and scope
- Owner reports a multi-second `Loading current slots...` state and requests optimization.
- Deep Review, Solo Maintainer mode. Existing source performs one full-document GET per linked Work Order, six at a time; the UI waits for all waves.
- Start from production 3ef8d37b. Optimize only current slot source reads; preserve the scoped release and exclude unreleased main overtime.
- No changes to booking writes, slot calculation, attendance access, browser storage, Firestore Rules, auth or Field execution.

## Governance
- Booking Authority / workOrders remains the source of current allocations, cancellation, date and crew. Existing Project links and estimatedSlots remain authoritative for membership and advisory budget.
- OPS-SVC, OPS-TEAM, OPS-SCHED and OPS-STAFF-ATTENDANCE behavior and Legacy parity are unchanged.
- Use current user ID token through the existing transport; capability guards still run before any request. No admin proxy, persistent cache or new truth. No ADR required for a bounded read optimization.

## Acceptance and risk
- Read exact deduplicated Work Order IDs in bounded batches of at most 20, at most three concurrent requests. Request only nine fields needed by progress and crew detail.
- Respect unordered results and canonical resource identity. Only explicit `missing` is zero; denial, omission, malformed data and failed batches remain unverified.
- Preserve mount/focus/manual/60-second refresh and cancellation on identity change; backdated corrections remain reflected by fresh reads.
- Expected representative volume: 13 links, larger case 100 links, peak test 1,000 links. Target: 13 links use one request instead of 13/three waves; no per-collection scan. Failed batches stay visibly incomplete until the next existing refresh; no silent fallback or retry storm.
- Batch size is an application bound, not a claim that document count alone guarantees Firestore Rules access-call limits. Existing operations readers use the cached signed-in profile. No rules changed; provider rejection stays unverified.
- Latency evidence uses controlled synthetic delay and real transport serialization, not a claim about private production network timing. Capacity alert owner remains DEMAC operations; no new telemetry with private IDs.
- Rollback frontend deployment to 3ef8d37b; no migration or stored counters.

## Verification plan
- Exact REST POST/mask/token, shuffled found/missing, partial/malformed/foreign/duplicate responses, denial/recovery, invalid paths, bounds, abort and no-read capability denial.
- Existing projection and real Projects browser regressions, including chronological attendance and backdated changes in Chromium/WebKit desktop/mobile.
- Compare old six-reader path with batches at fixed simulated latency for 13/100/1,000 links. Report request counts and measured synthetic elapsed time.
- Typecheck, mandatory prebuild gates, Scheduling regressions and release build. Separate adversarial review and all applicable CI before authorized scoped deployment.
