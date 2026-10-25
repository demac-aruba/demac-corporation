# Review: split attendance and overtime rates

## Review mode

- [x] Independent Review
- Reviewer: attendance_review (separate agent, read-only review; did not implement).
- Builder: root.
- Implementation tree: GitHub commit 74cf63e36e51a3c3d0a0ba7640ca934c956c07c9
  (local equivalent 7fb14b309491db4042125e0a44a58f59bff2699a).

## Findings and resolution

| Finding | Resolution and regression evidence |
| --- | --- |
| Rate-only split edit recalculated after schedule change | Exact unchanged intervals/classifications preserve saved totals; recorded schedule snapshot used for enhanced edits; changed-schedule fixture passes |
| Removing overtime retained old allocation | Explicit interval edit reaching zero overtime saves empty allocation with old values in audit |
| Adjacent Work Order evidence or ordinary save could overlap | Shared cross-date windows include evidence; all worked UI saves use transaction and adjacent reads |
| Present split conflicted with active absence | Enhanced save rejects before writes; ordinary conversion retains guarded attendance and legacy absence reconciliation |
| Work Order missed noncanonical document IDs | Single date-index query discovers legacy IDs; preserve sole identity, reject duplicates and adjacent conflicts before writes |
| Paid/NWNP changes silently treated as rate-only | Classifications are compared; explicit financial treatment changes persist and are audited, including after current schedule change |

## Verification

Independent reviewer reran attendance/save/payroll/real REST transport tests and all 54
calculation, split and Work Order tests. All pass; diff whitespace check passes. Firebase
authorization remains the existing authenticated payroll-role boundary; no rule expansion.
Tests cover denial, stale saves, interrupted-response retry, exact masks, partial reads,
midnight/period boundaries, duplicate identity, rate reconciliation and preserved metadata.

Current repository booking regressions run against current repository code in Work Order
CI. Exact production-package audit retains its archived tests for the unchanged archived
booking module; baseline and candidate share the same isolated dependency resolution.
Audit run 40246297922 passes 64 baseline / 76 candidate tests and real entrypoint smoke.
No production employee data was accessed or changed for implementation/review verification.

## Decision

- [x] Implementation approved, subject to final CI and deployment verification.

Residual limits: ordinary absence synchronization remains an existing separate write after
guarded attendance saving. Production lacks a dependency lock; declarations/packaging are
preserved, while the audit's test-only lock proves a clean current resolution rather than
identical versions to the running image. Release rechecks that validation lock hash.

Owner expressly authorized merge and deploy on 2026-10-25 and prohibited release-time data
changes. The source-only release updates code; it does not migrate or backfill records.

## Independent deployment review

The same read-only reviewer approved the controlled backend release after reconstructing
the exact two-file candidate hash and independently running all 19 source-mask, transport
and operation-recovery tests. No deployment blocker remained. Backend publication must
precede ERP activation; recorded interval support is required for any recovery.
