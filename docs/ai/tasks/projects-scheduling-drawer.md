# Projects: wire the existing Scheduling drawer to the shared registry

Owner authorized continued implementation; whole-module merge/activation conditions remain unmet.
Deep Review, Solo Maintainer Adversarial Review. No production writes or migration in this increment.

## Accepted scope and boundaries

Keep the existing modal/side drawer, customer/property selection, service bookings, after-hours,
backdated restrictions, support-slot selection, recipient choices and Booking Authority. Add a
separate default-off NEXT_PUBLIC_PROJECTS_BOOKING_ENABLED flag, gated by central-registry activation.
When enabled, the Project picker reads a bounded page of central plans and separately verifies the
selected plan/activity. It never loads or falls back to the browser Project store. Its central
choice is a narrow presentation shape, not a fabricated BrowserProject with zero actuals.

Bind Project/phase/version/current operator to the existing availability input; retain the existing
signature and epoch guards. Validate the returned offer context before enabling Confirm. Submit
through the existing Office functions and previously tested atomic Project backend. Confirm and
hold never call the post-booking local Project reducer for a central selection. Verified responses
must include the complete primary/support Work Order set.

Preserve the original estimate and imported planning units. Central forecasts use complete,
version-correlated allocation evidence, including every selected Van. Partial/unreconciled totals
are explicitly unknown. Exceeding budget warns and permits otherwise valid booking; it cannot grant
physical capacity or manufacture worked time. PR #515 remains the legacy advisory-budget correction.

A token-free session journal retains exact confirmation intent. It is not another Project store,
new source of truth, automatic writer or background queue. The same user's unresolved command is
restored even when new central bookings are disabled. New confirmations in this drawer are blocked
until verified recovery. Auth and unknown failures are ambiguous; narrow atomic precommit rejection
codes may clear a first never-committed intent. A rejection after earlier ambiguity cannot clear it.
No automatic replacement, local actuals posting or estimate inflation occurs.

## Required acceptance

Actual client-module tests: complete acknowledgement, corrupt/replaced journal, lost response,
reload/exact replay, user separation, permission/session changes, storage failure, baseline and
partial coverage. Real React drawer + actual Office and registry adapters + Auth/Firestore emulator
scenarios: confirmed, held, multiple Vans, stale version, physical conflict, lost response/recovery,
registry outage without local fallback and read-only UI. Browser requests stay loopback; the test
uses synthetic CRM/crew presentation and a deterministic capacity provider, not real appointments.
Existing full Booking/Field regressions, combined PR #515 integration, ERP types/build and central
workspace browser gates must remain enabled. Local transpilation is not a full typecheck.

## Rollout and remaining scope

Only branch code changes. No flags, rules/IAM, Functions exports or production deploy are changed.
Keep original browser records. Actual original-browser/cloud backups, restore rehearsal, historical
reconciliation, Field actual time/completion, phase/template/cost parity and final rollout are still
required before module release. The central picker is not usable in production until these gates
and the dormant server endpoint/flags are deliberately activated after approval.
