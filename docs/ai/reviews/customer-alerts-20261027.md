# Review: private customer alerts in CRM and scheduling

## Review mode
Solo Maintainer Adversarial Review. Reviewer and implementation author: Codex. This is a separate pass over the full change, not an independent review.

## Scope and findings
Reviewed the original owner request, canonical ownership, all new service/transport/UI files, facade routing, both appointment drawers, CRM integration, Firestore default-deny, fixtures and source-only release scripts. Owner explicitly authorized implementation, merge and deploy; no customer-data migration is authorized or required.

| Severity | Finding | Correction / evidence |
| --- | --- | --- |
| Medium | A slow pre-confirmation lookup could leave unrelated booking fields editable while an older handler was awaiting its result. | The drawer now disables its editing regions and close/actions during that lookup. Identity/actor signatures and sequence guards additionally discard stale responses. |
| Low | Reusing appointment detail for the same customer could retain the prior appointment's unit default. | Clear the unit on appointment change and key the alert manager by appointment identity. Unit ownership is still validated server-side. |
| Low | The CRM history tab could reuse the initial collapsed state. | Synchronize expanded state when the tab/customer changes. |
| Test integration | Older project-budget fixtures only intercepted direct drawer imports, allowing the new hook to reach the real authentication transport. | Intercept the alert adapter at its nested import boundary; unexpected mutations still throw. Do not disable budget or authority assertions. |
| Test integration | The existing capacity popover can cover visit disclosures after adding the alert notice. | Exercise its visible close/reopen controls, explicitly wait for required choices to open automatically, retain all support-choice and allocation assertions. |

| Test integration | The backdated booking browser harness called the old booking API directly, bypassing the production facade that owns alert commands. | Route alert commands through the real facade against the same demo emulator, preserve the fixed historical clock for booking, and assert that the lookup occurs without creating incidents. |

## Adversarial checks
- Canonical owner and unit validation prevent an incident from being created for another customer's property. Direct identity matches survive moves and cannot be dismissed as another occupant.
- Phone/address matching is exact normalized evidence, not proof. Exceptions are scoped to another customer, observed keys and alert version; a third occupant or new evidence still warns. No global address ban or deletion occurs.
- Fresh role checks run before reads and inside write transactions. Browser writes/reads are denied by the existing catch-all Rule, including admin sessions. Comment rendering is escaped React text.
- Request receipts are checked before stale versions, preserving exact retries after lost responses. Concurrent status changes have one winner. Reasoned state changes keep the original incident and immutable events.
- Searches and history are bounded; an oversized match set raises a visible error instead of silently reporting no warning. Lookup errors block current office confirmation/hold until rechecked.
- Continue/decline only record the decision. There are no writes to clients, properties, appointments, Work Orders, payments or messaging collections from this feature.
- Release uses the real live package as baseline, only overlays customerAlerts.js and officeBookingAuthorityFacade.js, tests its real entrypoint, and preserves config/IAM/traffic. Private recovery archive, immutable source generation, exact main/ref gate and operation resumption are inherited from the reviewed release mechanism.

## Verification
Local: 28 focused service/facade checks, 264 booking regressions, CRM acceptance, ERP typecheck and production build, eight real-UI-to-facade synthetic scenarios. Existing booking, appointment-detail and payment-workspace browser regressions are run, including new nested alert confirm/hold decisions. No production identities or records are fixtures.

Source audit: https://github.com/demac-aruba/demac-corporation/actions/runs/40579422640. Exact deployed baseline passed 168 tests; candidate passed 182 plus real-bootstrap smoke. Only the intended two runtime modules differ; locked dependencies, config, IAM and traffic were verified.

Firestore emulator: customer-alert CI at commit 65c1cf0 passed real transaction replay, concurrency, indexed matching, new-occupant exception, unchanged existing records, and direct-client read/write denial.

## Decision and release gate
No unresolved correctness/security finding in the inspected implementation. Merge and publication remain conditional on all required final-commit CI checks passing; later failure is blocking. The PR records final check results and release evidence.

Residual limits: advisory enforcement is in current ERP office create/hold flows, not an automatic ban or a universal change to other booking channels. Matching is deliberately exact and unit-aware; it does not infer spelling variants or resolve duplicate customer identities. History UI shows the most recent 50 events while retaining all records. No authenticated production mutation test is run against real customers. Recovery restores previous source/UI without deleting incident records.
