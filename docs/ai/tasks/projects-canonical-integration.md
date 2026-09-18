# Task: finish Projects without replacing Scheduling or Field authority

## Context

Christian approved implementation after the Projects audit, requesting clean, efficient
engineering. Development starts at main `cb01c4696a3a35dbc23c9989bc54473fa67356b5` on
`feature/projects-canonical-integration`. Merge, production deployment, security-rule
changes and production migration are NOT authorized by this task.

The active Projects planner stores records locally. Scheduling confirms canonical work,
then independently attempts a local Project link. Field execution is not reconciled back.
The code and screenshot establish that gap; the actual records of the reported Project
have NOT been read, exported, backed up or corrected during this implementation.

## Scope

First increment: dependency-free raw backup/verification; an isolated recovery page;
a bounded server-internal read-only reconciliation service; focused tests and staged ADR.
The recovery page deliberately does not mount ProjectsPhaseWorkspaceV2 or call its sanitizer.
A preview origin cannot export another origin's storage. The original browser/profile is
required for the real backup. Verification of a saved file is not proof of a cloud backup.

Not in this increment: central registry writes/import; appointment mutation; live Field
hours posting; Materials/Expenses/Financials; deployment; production reads through an HTTP
endpoint; replacing or modifying the existing planner, Scheduling, CRM, Field or telemetry.

## Governance

Deep Review, Solo Maintainer Adversarial Review. See the separate review and ADR.
Scheduling/capacity remains Booking Authority; visits/reports remain Field Operations;
Customer/Property IDs remain CRM; Inventory and accounting keep existing authorities.
Recovery diagnostics are not a new source of truth and cannot apply changes.
The internal reader verifies a revoked-token-aware Firebase identity and provisioned
active `super_admin` profile. No client role/capability grants server access. Wider operator
access is intentionally not implemented in this first recovery slice.
Legacy is untouched. Raw legacy values, including unknown fields/invalid JSON, are preserved.

## Acceptance criteria

- [x] Export only the two Projects storage keys; never enumerate or export session storage.
- [x] Preserve exact raw strings, original IDs, unknown fields and invalid source JSON.
- [x] Independently verify saved backup integrity and report duplicate/invalid source records.
- [x] No import, cleanup, write, delete, scheduling action, message or stock/financial effect.
- [x] Reconcile explicit IDs; never join by customer name or infer all support work belongs
      to a Project/phase. Related Work Orders are review candidates, not automatically counted.
- [x] Deduplicate retries and source rows. Block totals on conflicts or partial evidence.
- [x] Include General Project Work; preserve return visits and cancellation history.
- [x] Distinguish planned duration/slots from actual labor and physical completion.
- [ ] Validate recovery UI on Chromium/WebKit/mobile and actual authorization in emulator.
- [ ] Obtain and verify the original browser backup and authorized canonical evidence.
- [ ] Reconcile the real reported project, then implement/validate central persistence.

## Plan and risk

1. Complete and validate this recovery slice. Preserve the original browser data.
2. Produce a read-only real reconciliation with per-record source IDs and discrepancies.
3. Implement central planning records and transactional, versioned, auditable commands.
4. Join all confirmed Work Orders through the existing authority; reconcile lifecycle changes.
5. Derive measured execution through the existing Field authority, not local preview reports.
6. Connect costs through existing Inventory/Finance authorities; test all affected workflows.
7. Obtain explicit approval for merge, deployment and any separately reviewed migration.

Backup checksums establish integrity, not authenticity or import authority. A backup captures
raw keys and detects immediate concurrent changes; it does not claim an atomic multi-key
snapshot across all browser tabs. Stop editing while capturing and review against live sources.
An eventual migration must preserve original files and IDs, dry-run first, reject collisions,
record provenance, and provide tested selective forward recovery/rollback. No automatic
restoration or data deletion belongs in this slice.

## Verification

Local Node v22.16.0: `node --test functions/projects/*.test.js` — 42 passed, 0 failed,
0 skipped. Syntax checks passed. Tests use synthetic fixtures and a strict read-only database
double; they are NOT production or Firebase emulator evidence. The environment could not
resolve GitHub for a full local clone; full ERP types/build and transitive checks must run
in CI on the published branch. Existing CI/gates are unchanged. UI/browser and emulator
acceptance remain pending; this branch is not ready for merge.
