# Task: Immediate invoice-draft amounts while server validation continues

## Context and scope
Owner explicitly requested a deep performance diagnosis and optimization of the
appointment actual-work invoice editor. Each input previously discarded the whole
quote, waited 300 ms, and then masked every amount until a full authority response.
A controlled Chromium run with 1200 ms synthetic authority latency measured 1879 ms
from quantity entry to the visible amount; even the unchanged unit price disappeared.

Deep Review. Branch `fix/instant-invoice-pricing`, base main `b8e7bc13`.
In scope: provisional line rendering, quantity arithmetic, scoped price reuse,
background validation, and focused performance/regression tests. No backend changes,
production-data mutations, migrations, payment write changes, or QBO changes.

## Governance
Appointment charge authority and OPS-SCHED-CHARGES-001/002 remain unchanged. The
backend alone quotes and confirms monetary records; projections never establish final
debt. Existing prices, receipts, expected-version checks, edit leases, exact retries,
Field reconciliation and PDF rules are preserved. No Legacy behavior is removed.
The in-memory display cache is not a new system of record or a durable quote.

## Acceptance and design
- Known prices remain visible; quantities, removal and repeated catalog selections
  recalculate immediately with integer thousandths and server-equivalent cent rounding.
- Unknown rows alone show consultation; incomplete/invalid totals stay pending.
- Provisional values have no quote token and cannot enable confirmation. Acknowledgment
  waits for the exact current server response. Errors, scope changes and superseded
  responses fail closed; saved receipts and paid status remain server-owned.
- Cache is bounded to 180 entries in the mounted editor, scoped by appointment,
  version, explicit revision and purpose. Historical/retained/manual/forecast prices
  never seed another line. Description changes do not request prices.
- Rapid edits coalesce; typing does not reload the appointment or catalog.

## Verification and recovery
Focused arithmetic/display tests, real-drawer browser latency/race/error cases,
full isolated HTTP-to-authority persistence flows, types and required integration CI.
All browser data synthetic; external requests blocked. No real customer writes or
communications. Compare old/new under the same 1200 ms fixture, not an unsupported
claim about all production network timings. Review the exact merged tree and deployed
source. Rollback the frontend to the verified pre-release deployment; no schema or
backend rollback required and no generated customer data is removed.
