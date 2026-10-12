# Review: PR570 dwelling communication correction

## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review
- Implementation and separate review: /root. This is not an independent review.
- Owner explicitly requested Deep Review and conditionally authorized publication on 2026-10-12.

## Scope reviewed
Full PR diff, canonical location creation/snapshot, Work Order projection, notification service/trigger, manual communication authority, daily queue, same-day/support alerts, reference-update trigger and transactional queue; current main payment update PR571. Existing authority matrix, CRM-LOCATION-001, OPS-SCHED-REFERENCES-001, COMMS, role/recipient/legacy boundaries.

## Findings
| Severity | Evidence / impact | Resolution |
| --- | --- | --- |
| High release risk | Generic transactional workflow migrates old queues and realigns van groups; unrelated to this correction and violates the no-data-change release scope. | Dedicated source-only release; merge-only marker prevents generic deployment. No migration or queue sender is called. |
| Medium release gap | notifyBookingReferenceUpdate imports the changed daily formatter; omitting its deployment would leave attachment-update messages inconsistent. | Include this fifth existing function in bounded audit/release. |
| Medium integration risk | main advanced to payment overview PR571. | Integrated current main without conflict; CI on the combined source required. |
| Medium deployment drift risk | Functions may run different dependency/source generations; replacing all source from main can silently introduce unrelated backend behavior. | Download versioned live source, apply only reviewed text hunks + pure helper, preserve lock and every other file; test the candidate from each actual archive. Unknown/conflicting patches block release. |

| High release risk | The read-only Office source audit found no package-lock.json in its deployed source archive. A floating dependency rebuild would be unverified. | Release remains blocked until the exact lock is recovered from the immutable image serving the current revision and validated; never generate a replacement from version ranges. |

## Verification and invariants
- Local syntax gate passed; 239 booking/lifecycle/reference tests and 132 transactional tests passed; release/config canonicalization tests: 8 passed.
- Shared formatter is pure, selects four display fields and performs no reads/writes/network calls. 50,000 local formatting iterations: maximum batch average 0.00397 ms/message; this is a microbenchmark, not a production latency claim.
- No frontend requests, rendering, loading state or save path added. Existing asynchronous queue/background dispatch and authoritative success/error state remain intact.
- Snapshot precedence and absence cases, exact retries, language/recipient preservation, private-field omission, neighboring-unit/other-appointment rejection and support/reference sequence tested.
- No rule, permission, role, trigger eligibility, recipient list, idempotency key, work/financial mutation or actuals path changed.
- The isolated Firestore suite passed all 11 scenarios, including canonical booking → persisted location → confirmation/reminder preparation and later dwelling rename. Actual live-source candidate audits are required in the dedicated workflow before a release decision.
- Actual authenticated production delivery is deliberately not tested: owner prohibits production writes and customer messages. Successful preparation in isolated queues does not prove external WhatsApp delivery.

## Decision
- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Pending integrated CI and read-only live-source audit

Runtime artifact records before/after versions, source hashes, configuration/IAM preservation, scheduler and actual-domain boundary results. Deployment is blocked until critical evidence passes. Rollback preserves all operational customer/cita/queue records; see task recovery plan.
