# Projects operational costs — owner scope clarification, 2026-09-20

This clarification supersedes any earlier requirement to connect QuickBooks before
finishing operational Projects. The owner authorized continued local implementation and
verification, not merge, production/configuration/access changes or real migration.
The existing staging, original-source backup, restore and reconciliation gates remain.

## Current delivery

Preserve existing project budgets, authorized revisions and manual expense/cost records.
A confirmed manual expense can support operational tracking without being accounted,
paid, reconciled or synchronized. Those are separate states. QuickBooks and the future
photo/audio assistant are not prerequisites for this delivery.

The shared registry distinguishes original/captured budget, current budget, revision and
period. `revise_material_budget` uses the existing Projects management permission, expected
version, write-pause/closed-plan rules and actor-scoped idempotent command journal. A reason
and UI confirmation are required. One transaction preserves the original and records before,
after, actor and timestamp in the existing activity history. Metadata/type edits cannot
silently change or clear the budget. Expenses never increase it automatically. Existing
records without an original baseline retain `not_recorded`; no historical approval is
invented. Imports identify a captured snapshot, not proof of the original approved budget.

The monetary budget is optional, exact AWG minor units. Clearing the current estimate is
an explicit revision to unknown, not zero; its original/history remain. Van-day/slot budget,
scheduled capacity and recorded execution time remain separate nonmonetary measures.
Exceeding the time estimate is advisory and cannot reject a slot with real availability.

The browser planner displays existing expense and cost rows read-only with provenance,
local status and missing currency visible. It does not add potentially duplicate expense
and derived cost rows. A local Approved label is not server approval. No verified shared
expense allocation is connected to the registry; its expenses, available balance and
overrun show that limitation instead of certified zeros. This is a source-coverage limit,
not a dependency on QBO or a newly invented expense service.

## Inspected sources and minimum remaining extension

| Source | Verified capability | Boundary |
|---|---|---|
| `projectRecords` / `projectEvents` / `projectCommandReceipts` | Governed budgets, reasons, versions, original/current, audit and exact retries; existing Projects authority | No expense ledger or accounting balance created |
| `demac.erp-next.projects.preview.v1` | Existing `expenses` and `costEntries`, including local approved/manual evidence | Browser only; incomplete currency, actor, attachment and allocation contracts; original must be backed up/reconciled before central adoption |
| `vanMaintenanceLogs` / `saveCanonicalVanMaintenanceLog` | Real manual operating costs tied to a Van, date, category, vendor, actor and timestamps | No Project/WO/phase/currency/approval/evidence allocation contract; do not distribute to Projects automatically |
| `inventoryMovements` | Existing Inventory quantities and traceable identity | Does not provide historical valuation; issue is not proof of consumption, current catalog price is not historical cost |
| Finance/ExpenseCapture DTOs and previews | Proposed screens and fixtures | Not a verified central expense writer or approved category catalog |
| Field visits / time evidence | Existing linked operational intervals with historical Van attribution | Not complete approved individual Project timesheets; no derivation from attendance, today's crew or receipts |

For later shared manual capture, first approve the smallest extension to the existing
governed operational-finance service: canonical operation ID, verified amount/currency,
date/vendor/concept, catalog category IDs, confirmation/permission contract, allocations,
private evidence references, idempotency and correction history. The audit found no approved
unified category/subcategory catalog; the several existing enums are not permission to
create a new catalog. This delivery documents that gap and preserves current sources;
it does not silently establish another financial source of truth or expand permissions.

## Preservation and recovery now

Loading the browser planner may project out sample IDs, invalid rows or duplicate IDs for
display, but never rewrites the original. A sample-looking ID can contain real user changes.
Unreadable/filtered originals pause saving and remain available to the existing raw-backup
workflow. Selection changes reread the original and cannot replace newer costs. Both local
write paths validate raw storage before saving and share the same browser lock; neither
silently normalizes away a Service budget or migrates unrelated data. Legacy Scheduling
checks the stored source before sending a booking and rereads it before linking. It remains
a legacy two-stage bridge; only the central bridge commits Booking and Project link atomically.

Reuse `functions/projects/recovery.js`, which captures both complete raw keys, and
`projectLegacyImports`, which retains raw/hash/origin/actor and existing reviewed import
receipts. Do not reconstruct or automatically merge records. No original browser/DB/Storage
backup or real restore has been performed here. Protected synthetic tests are not such proof.

## Future general expense capture — documented only

Manual entry, a private receipt/photo/document, and optional private audio/written note
will yield a draft. AI may transcribe/extract available values and propose classification
and destination; illegible or missing facts remain unknown. An authorized person reviews
and confirms or corrects amount, currency, date, vendor, concept, category/subcategory,
Van, Project and phase. No definitive expense is posted merely because AI produced a draft.
OCR, audio processing, transcription, a general assistant and QBO synchronization are out
of the current implementation scope.

Category/subcategory and destination are separate. Resolve synonyms against an approved
catalog; do not create duplicate categories from dictated words. Resolve “Mateis” or
“Matthijs” against existing canonical IDs and ask for a selection when ambiguous. Never
create a Customer, Project or Van to satisfy a guessed name. Destinations may be company,
a specific Van, a Project and a phase. Fuel/Van supplies are not automatically distributed
among projects or Vans without an approved allocation instruction/rule.

One expense operation may have multiple allocations. Company expense and Project cost
views reference that same operation/allocation, never independent copies. Allocation totals
must reconcile in the operation's currency; an unallocated remainder stays visible. A
confirmed expense updates operational totals for the relevant budget and period without
changing the approved budget. Any later AI-requested budget adjustment must use the separate
authorized revision flow, retaining original/before/after/actor/date/reason.

Purchase, inventory receipt, Van issue and consumption are different events. Receipt
capture does not change stock. Coordinate existing Inventory authority and approved
valuation rules so a purchase is not charged once by invoice and again by stock issue.
Do not use today's price as historical cost or infer individual work hours from receipts,
attendance or current Van crew. This is neither a new payroll system nor another inventory
or accounting authority.

Detect possible duplicate receipts, keep request IDs for exact retry recovery, and preserve
correction/reversal history instead of erasing originals. Evidence and audio are private;
no real documents, identifiers, credentials or audio belong in logs, fixtures or repository
artifacts. Future QBO integration maps operational IDs to verified external transaction IDs
and explicit accounting/sync states, does not recreate existing accounting transactions,
and never claims synchronized merely because the ERP accepted a record.

## Release gates that remain

The owner scope decision above is recorded. No further QBO/AI scope decision is required.
Isolated deployed staging, original browser and protected DB/Storage backups, canonical
identity/relationship reconciliation, an isolated restore exercise and final release
authorization remain required. Current previews use production Firebase configuration;
main triggers automatic deployments and WhatsApp migrations. No push/merge/deploy/import
is implied by local passing tests or by this clarification.
