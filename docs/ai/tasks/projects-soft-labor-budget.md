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

A booking may display an amber warning without an additional approval gate. The ordinary
Confirm/Temporary Hold action is the operator's decision to continue. A forecast does not
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
- Warning in the live appointment drawer; do not classify budget overrun as form-invalid.
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
Central storage, multi-device reconciliation, all support-Work-Order links and lifecycle
reconciliation remain PR #514 work. This focused fix does not claim to finish that work.
No production browser snapshot was obtained; no client data was exported or migrated.

## Safety and recovery

Only additive fields are introduced; old Project records remain readable. Do not delete
local storage, overwrite estimates, modify customer identity, create test bookings in
production or restore an old full backup over new work. The existing no-merge requirement
remains. A future approved release can revert the code commit without data migration; older
code ignores added snapshot fields. Reverting the fix also restores its known blocking
behavior and must be an explicit incident choice. PR #514's real backup/restore work is
still outstanding; this document does not claim that backup was performed.

## Required evidence before release

New budget acceptance tests, existing Project/phase acceptance, full ERP types/build,
Booking/Scheduling/Field regressions and browser interaction checks using synthetic data.
Review the complete final diff and preserve the existing shape of canonical booking calls.
No green check substitutes for checking the requested 66/63/6 scenario and real-slot conflict
behavior. Verification results and remaining gaps will be recorded in the PR, not prefilled.
