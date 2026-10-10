# Decision: Reuse Booking support for mixed workload

- Status: Accepted implementation of owner-requested behavior; production subject to all review gates.
- Date: 2026-10-10
- Owners: Scheduling / Field authority maintainers.
- Rule: OPS-SCHED-SPOTS-001.

The existing helper selector was limited to large Standard quantities. Extend that selector, rather than create another booking process. Keep catalog quantities and billable service work on the primary order. Selected helper windows contribute exact operational capacity using the existing nonbillable `adhoc_rescue` representation. Add `workloadSupport` to distinguish this deliberate allocation from legacy helpers, including persisted offers, appointments and support Work Orders.

Copying all services to each helper would duplicate Field scope and potential commercial reporting. Inventing a generic catalog service would create a fake planned intervention. Neither is valid. A narrowly marked helper projects no inherited planned service list; it can still use existing Field operational execution controls.

Morning overflow uses the existing overtime consent/token/idempotency path. Canonical ordinary spots remain intact; extra spots occur after the ordinary tail with lunch protected. The seven-unit Standard full-day policy and Project rules remain canonical.

Compatibility is additive: old records retain their projection. No backfill. Hold confirmation, reallocation and cancellation retain existing identities and release locks normally. Returning to ordinary allocation clears helper markers without replacing payment, invoice, communications or creation audit state.

Field's deployed dependency graph is deliberately retained during release. Deploy and verify its four-line projection guard before Office emits the marker. Keep the guard if rolling back creation UI/Office, since marked helpers may already exist. Revisit if future business policy explicitly distributes individual billable services to helper orders; that requires a separate ownership decision.
