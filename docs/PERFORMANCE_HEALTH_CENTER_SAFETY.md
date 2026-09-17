# Performance & Health Center: release safety and operation

## Scope
Observation only. No Booking Authority, appointment, customer, Work Order, capacity-lock, reminder or dispatch mutation rules are changed. The UI is at `/settings/system/performance/` and is restricted to system administrators. Instrumentation runs across authorized ERP sessions, including office and field users, not on the unauthenticated public website. This is NOT the later scheduling/performance optimization project.

## Four release blockers addressed
1. The collector reads a currently valid token with a read-only accessor. It does not import the operational session refresh/clear helpers. Missing, expiring, malformed, denied or inaccessible credentials cause telemetry to skip/drop. A telemetry outage must never sign an employee out.
2. Compatible histograms are pooled on the server before calculating percentiles. The UI never takes the maximum/average of separate percentiles. p50/p95/p99 are explicitly labeled upper-bound histogram estimates, with sample-size cautions. The trend shows ONE named workflow. Release comparisons require an explicit pair.
3. Each immutable batch carries a stable ID and original observation timestamps. A Firestore transaction reads a receipt and writes receipt, rollups, rate limit and session atomically. Lost acknowledgement replay cannot increment a second time. Reused ID with different content is rejected. Late samples stay in their original time buckets.
4. No evidence is not health. Empty, insufficient, stale, paused and unavailable feeds cannot produce a green health certification. The UI suppresses stale filter responses, reports partial windows, and does not certify an entire database/hosting platform from browser response time.

## Collection and privacy budgets
- 120 queued observations + one in-flight batch, at most 80 observations per batch; maximum 3 attempts, backoff, 10-minute local expiry.
- Normal visible-session cycle: one policy check and at most one ingest per minute, never one request per support click. No polling while hidden (one best-effort final flush).
- Server payload maximum 60 KB; 12 new batches per authenticated user/minute. Receipt keys are user-scoped. Labels and units are allowlisted. No arbitrary high-cardinality identifiers.
- Four shards and 15-minute/hour/day rollups. Long windows use coarser rollups; dashboard reads at most 800 buckets and reports truncation. Auto-refresh is 1 minute for short windows, 5 minutes for 24 hours, 15 minutes for longer windows, only while visible.
- Rollups expire after 45 days; batch receipts, rate records and presence expire after 2 days. Deployment configures TTL on these new collections ONLY. TTL is asynchronous, not an exact deletion deadline. No business collection is subject to these TTL commands.
- No names, addresses, notes, raw routes, query strings, document IDs, tokens, IPs or request bodies are stored in the measurement payloads. Operator identity is used for authorization/rate limits; a pseudonymous hash is recorded for administrative collection-switch auditing. Hosting/provider access logs are separate from this module.
- The cloud function has at most 3 instances. A failed telemetry write is expendable; a business operation is not. Missing/dropped samples are surfaced rather than silently represented as successful requests.

## Meaning and limits of the KPIs
- Schedule Data Ready: data retrieval and projection completion, not the time the pixels were painted.
- Support Validation / Confirm: browser request start to response headers. Includes server/network time, not isolated Firestore execution time.
- Firestore Requests: observed HTTP operations, NOT billed document reads.
- Visible sessions are estimates; tabs are not necessarily distinct employees.
- Full-document navigation timing must not be labeled as SPA navigation data readiness. Login navigation is not relabeled as Scheduling.
- Cancelled requests have a separate counter; no successful latency sample is manufactured for them.
- Missing metrics, infrastructure CPU, actual backup/restore status and false-empty verification are explicitly unmeasured/unverified. No synthetic values, invented uptime, or fake restore success.
- Baseline sample gate: at least 5 observed days and 20 observations for each critical workflow. An administrator must also review devices, traffic, business-hour coverage and representativeness. This is not proof of causal improvement or 50-user ERP capacity.

## Fail-safe collection switch and rollback
1. Normal kill switch: administrator opens Backup & Rollback -> Pause collection. A versioned server-side control stops new writes inside the same transaction used for ingestion. The UI requires confirmation. Audit is telemetry-only. Clients stop on their next policy check (within 60 seconds in visible tabs); the server refuses ingestion immediately after the control commit.
2. If the UI is unavailable, an authorized cloud operator can set `PERFORMANCE_TELEMETRY_ENABLED=false` on ONLY the `performanceTelemetry` function/Cloud Run service using the existing operational deployment procedure. Do not change ERP authentication or business security rules. Keep `PERFORMANCE_ENVIRONMENT=production` unchanged.
3. Frontend emergency disable: set `NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED=false` and rebuild, or restore the exact previous reviewed Vercel deployment. The previously reviewed baseline commit was `caf01799a6eaf65e187dba9321cc3db74d3e6ef1`; choose the actual known-good deployment recorded at activation, not an outdated revision if other features have since shipped.
4. Restoring web/function CODE does not restore or overwrite DATA. Do not run a blanket Firestore import to undo telemetry. No operational schema migration exists in this PR.
5. Verify login, Scheduling, existing appointments, support allocations and daily dispatch using read-only checks. Any suspected business-data incident needs its own incident procedure and verified backup, not a telemetry action.

## Backup/restore is intentionally not certified
No verified business-data backup authority or one-click business restore is part of this observation release. The recovery screen must continue to say Not verified. Before the later optimization release, establish and rehearse customer/appointment backup and selective recovery in an isolated environment. Never claim an instantaneous data restore without a measured recovery rehearsal.

## Release gates
- Pure service tests: percentiles, permissions, no-data/stale states, original times, failed commits, lost ACK, conflict, budgets and server switch.
- Pure client tests: no auth writes, failed storage/network isolation, replay identity, bounded buffer, cancelled requests, exact response/exception preservation and effect setup/cleanup.
- Firestore + Auth emulators MUST use `demo-demac-health` with localhost hosts. Guards abort before SDK initialization for any non-demo target.
- Chromium and WebKit use the actual built ERP. All external APIs are intercepted locally; no production request is forwarded. Browser measurements traverse the real handler and emulator database, then render in the administrator dashboard. Screenshots use synthetic fixtures only. No HTTP traces/session tokens are published as artifacts.
- Standard ERP Next and operational regression workflows must pass on the final reviewed head.
- No merge or production deployment without explicit owner approval. Preview collection is disabled by default, and test/preview payloads cannot enter a production telemetry backend.

## Sources
Firebase transaction semantics: https://firebase.google.com/docs/firestore/manage-data/transactions
Emulator isolation: https://firebase.google.com/docs/emulator-suite/connect_firestore
React effect lifecycle: https://react.dev/reference/react/useEffect
Histogram aggregation: https://prometheus.io/docs/practices/histograms/
Browser request isolation: https://playwright.dev/docs/mock
