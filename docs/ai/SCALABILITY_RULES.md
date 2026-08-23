# Scalability Rules

1. Design handlers for retries: stable idempotency keys, bounded attempts, and observable outcomes.
2. Avoid unbounded collection reads, in-memory fan-out, and per-row network calls. Paginate,
   batch within provider limits, and use indexed queries.
3. Keep request paths short; move slow or bursty work to durable queues/workers with backpressure.
4. Make schedules and event consumers safe under overlap, duplicate delivery, and partial failure.
5. Store canonical state once; derive caches and projections that can be rebuilt and reconciled.
6. Define limits for uploads, prompts, messages, reports, batch jobs, and retained event history.
7. Instrument latency, error rate, throughput, queue age, retry count, provider quota, and cost.
8. Isolate tenants/roles and hot records; use transactions only around invariants that need them.
9. Preserve trace/correlation IDs across client, function, AI tool, and provider boundaries.
10. Performance claims require representative data volumes and a recorded budget, not intuition.

## Mandatory fleet rule

Future code must not assume exactly four Vans. Fleet behavior must be data-driven. Do not
introduce new `[1, 2, 3, 4]` Van ranges, fixed four-element Van arrays, `/4` capacity or
completion assumptions, checks requiring exactly four Vans, or equivalent fixed-fleet logic.
Existing four-Van compatibility behavior is architecture debt to inventory and migrate; it
is not a design pattern to copy or extend.

Before launch, document expected volume, peak multiplier, provider quotas, degradation behavior,
recovery procedure, and the owner of capacity alerts.
