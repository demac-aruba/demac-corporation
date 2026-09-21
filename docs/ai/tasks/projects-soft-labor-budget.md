# Projects soft labor budget correction

## Request and boundary

Christian reported that a six-slot Project booking was rejected because three hours of
an estimated labor budget remained. The owner clarified: estimates warn; they must not
prevent finishing a project. Continue normal Booking Authority validation, preserve the
original estimate, record the allocation and show projected/actual overrun separately.

Development branch: `fix/projects-budget-soft-warning`, based on
`cb01c4696a3a35dbc23c9989bc54473fa67356b5`. This is separate from Draft PR #514.
No production merge, deployment, backfill, database mutation or security-access change is
authorized. No new system of record is introduced. Scheduling/Field/CRM authorities stay
unchanged. Engineering mode: Deep Review, separate adversarial self-review before release.

## Rule OPS-PROJECT-BUDGET-001

The Project and phase labor estimates are advisory for booking more work. Valid whole
slots may exceed them. Preserve finite-number/identity/role checks, closed-project/phase
restrictions, dependency rules already enforced, real Van availability, transaction locks,
Booking Authority and retry/idempotency behavior. The owner has NOT authorized double
booking, changing daily operational capacity, fabricated execution, or re-opening a project.

A booking displays an amber warning and, on Confirm/Temporary Hold, requires the current
authorized operator to acknowledge the exact forecast. This is not a manager approval.
The 2026-09-21 clarification in PR #515 comment 5765420349 supersedes the earlier passive
warning requirement. Cancel creates nothing. Actor, Project/phase, forecast, offer, selected
option or workload changes retire the decision. Overtime consent remains separate. A forecast does not
turn into actual labor, a physical-completion percentage, or a higher approved baseline.
Changing an estimate remains a separate explicit workflow; estimates are never raised
silently merely to hide an overrun.

Examples: budget 66, recorded actual plus prior scheduled 63, new booking 6 -> 69 committed,
3 forecast over budget, booking may proceed if the Van is really available. Already at 69,
new booking 6 -> 75 committed, 9 forecast over budget. Budget 66 and recorded actual 70 ->
4 recorded-actual hours over budget, not automatically 4 more hours because of the forecast.

## Implementation scope

- Deterministic shared budget calculator, advisory plan result and non-negative remaining
  budget. Full overrun is computed against the original estimate, even when already over.
- Warning and explicit continue/cancel decision in the live appointment drawer; do not
  classify budget overrun as form-invalid. Reuse the existing calculator and Booking Authority.
- Project portfolio/detail show scheduled allocation separately from recorded actuals and
  preserve original budget. Forecast overrun flags review, not automatic lifecycle closure.
- Existing local assignment records receive an additive at-scheduling budget snapshot.
  Replays do not add another assignment, hours or snapshot. The latest local record is used.
- The phase preview booking path follows the same advisory budget policy; dependency and
  closed-phase checks are retained. Phase baseline allocation/edit rules are unchanged.
- Update only the acceptance assertion that enforced the owner-rejected hard budget cap;
  add positive overrun assertions and retain all availability/security/identity tests.

## Current limitations

Projects still uses browser storage. At-scheduling snapshots are operational evidence in
that existing store, NOT a durable immutable server audit log or verified Field actuals.
New primary/support allocations returned by Booking Authority are summed once and linked
through the existing per-Work-Order idempotent mechanism. Manual Other bookings currently
use one Van in the existing engine; this change does not invent support availability.
Central storage, multi-device/Field reconciliation and support added later by an independent
appointment edit remain separate work. This fix does not silently backfill historical records.
An ambiguous response freezes the open drawer and offers recovery of the identical request;
the recovery closure is in memory, not a durable cross-reload journal. Reload/crash recovery
must inspect the canonical agenda before any replacement request. No instant restoration or
complete reconciliation is claimed.
No production browser snapshot was obtained; no client data was exported or migrated.

## Safety and recovery

Only additive fields are introduced; old Project records remain readable. Do not delete
local storage, overwrite estimates, modify customer identity, create test bookings in
production or restore an old full backup over new work. The existing no-merge requirement
remains. A future approved release can revert the code commit without data migration; older
code ignores added snapshot fields. Reverting the fix also restores its known blocking
behavior and must be an explicit incident choice. PR #514's real backup/restore work is
tracked separately. A full Firestore export completed on 2026-09-21; the owner supplied
SUCCESSFUL and the overall_export_metadata object. Restore rehearsal and the browser-local
Projects snapshot are still unverified. Firestore export does not include browser storage.

## Operational release candidate, 2026-09-21

Read-only Vercel inspection resolves demac-aruba.com to deployment
`dpl_4XLDRZt8BWF8Xsay5sxubijiuumH`, commit `cb01c4696a3a35dbc23c9989bc54473fa67356b5`.
Remote main is `6d501d80d87e96ecb570e99716572b2c313e44ce`, the merge-only PR #516 overtime
integration. This branch still starts from the deployed base and adds only #515 plus its
owner-clarification patch. It introduces no Functions, rules, migrations, expenses or QBO.

A routine main merge can publish the entire main frontend, including PR #516. The
`[merge-only]` Vercel ignore command only skips commits carrying that marker; it is not a
permanent production freeze. The #515 diff does not match the Office/Work Order Functions
deployment path filters, so it cannot be relied on to deploy the new overtime backend.
Do not publish main with an unverified frontend/backend pairing.

The narrow route is an explicitly approved frontend release of this branch's reviewed
artifact with production configuration, retaining the deployment above for code rollback.
A preview is not automatically equivalent to production environment settings. Verify the
production build environment and domain promotion before executing either. No production
promotion, main merge or automatic deployment has been authorized by the clarification.
Code rollback must not restore Firestore over appointments created after the backup.
The required recovery checks are not waived by this candidate or by green CI.

## Required evidence before release

New budget acceptance tests, existing Project/phase acceptance, full ERP types/build,
Booking/Scheduling/Field regressions and browser interaction checks using synthetic data.
Review the complete final diff and preserve the existing shape of canonical booking calls.
No green check substitutes for checking the requested 66/63/6 scenario and real-slot conflict
behavior. Verification results and remaining gaps will be recorded in the PR, not prefilled.
