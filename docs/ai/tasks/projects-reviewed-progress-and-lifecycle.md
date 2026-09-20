# Finish reviewed progress, shared phase templates and project lifecycle

## Context and approval

Christian requested continuing Projects until the agreed module is merge-ready, with clean
architecture, no regressions, and real customer/appointment protection. This is Deep Review
in the existing `feature/projects-canonical-integration` workstream (PR #514), not approval
for premature merge, deployment, changing access, or migrating production records.

Baseline inspected: `fac788b` plus source-only checkpoint `c2ef461`. Source archive hashes were
verified before local editing. Existing phase closure, Booking handoff, Field reads, current
roles, exact retry receipts and optimistic versions are reused, not reimplemented.

## Authoritative boundaries

Projects owns planning, reviewed scope checkpoints, reusable planning templates and explicit
project lifecycle. Field remains owner of physical visit/report/time evidence; Inventory owns
stock movements; QuickBooks remains accounting authority. Actual costs/person-hours must not
be fabricated when upstream authorities do not record them. Current ERP Expenses/Purchasing
screens are previews and Inventory issues lack frozen cost valuation: this is a real dependency,
not permission to introduce parallel books or manufacture historical costs.

## Intended behavior

- Reviewed partial phase progress is cumulative, not an increment. Current approved Field
  evidence is required. A correction retains the prior checkpoint and its supporting versions.
- Partial progress never closes the phase, changes Field execution, unlocks dependencies,
  consumes stock, changes payroll or increases a baseline. Explicit acceptance remains separate.
- Unit/checklist progress is physical scope evidence; time or budget consumption is not a
  physical-completion percentage. Mixed phase measures are not averaged into a fake total.
- Company templates are optional editable planning aids, copied with fresh phase/checklist IDs;
  changes to a template cannot rewrite existing Projects. Library edits use the existing
  settings authority, versions and registry audit. No seeded mandatory template is introduced.
- Draft/Planned/Active/On Hold/Near Completion/Completed/Cancelled lifecycle stays explicit.
  Terminal transitions require reviewed operational evidence and do not cancel or mutate
  appointments. Reopening preserves closure evidence; booking restrictions stay deterministic.

## Safety gates

No production credentials or data in tests. Unit and real Auth/Firestore emulator checks for
same-request retry, contention, stale evidence, revoked roles, no partial writes, phase/general
work and protected operational records. UI tests must retain every negative assertion and
inspect both browser engines. Default-off deployment remains. Real browser/cloud backups,
restore rehearsal and historical reconciliation are separate prerequisites, not implied by CI.

## Verification

Results will be recorded only after execution. No claim of a full production backup, migrated
Project, actual verified hours, finance integration or completed module belongs in this task.
