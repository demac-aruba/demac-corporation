# Solo Maintainer Adversarial Review — Unassigned technician premium schedule

Date: 2026-08-28
PR: #456
Implementation head reviewed: `b240dfbdd018042cd3b0193d3811a1687a33b7e8`
Mode: Solo Maintainer Adversarial Review

## Scope reviewed

- `employee-work-schedule.ts` schedule resolution precedence.
- `employee-schedule-settings.ts` protected write contract.
- `employee-profile-editor-v3.tsx` assigned/unassigned technician UX and save flow.
- New unassigned-technician Payroll/schedule acceptance coverage.
- Authority Matrix, Business Rules and Company Rules Registry Version 4.

## Authority findings

PASS.

- Regular crew remains owned by `vans`; `primaryVanId` was not promoted to authority.
- A Van-assigned technical employee continues resolving the company base schedule plus the Van's `vanHalfDaySchedules` rule.
- An unassigned technical employee reuses the existing `employeePayrollSettings` individual schedule authority; no new collection or duplicate schedule source was introduced.
- When both an individual technical schedule and canonical Van membership exist, Van/team resolution wins deterministically.
- Removing the employee from all regular Vans makes the applicable preserved individual schedule active again without rewriting it.

## Write-path findings

PASS with layered race protection.

- `buildEmployeeScheduleChanges` rejects technical individual schedule writes by default. A caller must explicitly pass `technicalVanAssigned: false`.
- The supported Employee Profile flow re-reads canonical operations immediately before a technical individual schedule save and aborts if a Van assignment now exists.
- The re-read and Firestore schedule write are not one atomic cross-document transaction. A Van assignment could theoretically occur between those two operations. This is a residual concurrency window, not an authority bypass: the resolver still gives the Van/team precedence, so a stale individual write cannot become the active schedule while the employee is assigned to a Van.
- A future server-side transactional/conditional write could harden this further if concurrent administrative edits become common; it is not required to preserve the requested active authority behavior.

## Data-preservation findings

PASS.

- Existing `employeePayrollSettings` version history is preserved.
- Assigning a technical employee to a Van does not delete or mutate the employee's individual schedule record.
- No production migration, backfill, destructive rewrite, or employee identity replacement is introduced.
- Sunday remains protected by the company calendar before either individual or Van-specific schedule resolution.

## Historical crew limitation

Non-blocking existing architecture constraint.

Regular Van crew membership on `vans` is current-state ownership and is not versioned with effective-from/effective-until history. Consequently, synthesized historical technical schedule resolution cannot reconstruct a past regular Van assignment solely from current `vans` data. This limitation predates this PR and also applies when technicians move between Vans today. This PR does not invent a second crew-history authority to solve it. Explicit attendance records and employee schedule versions remain preserved according to their existing authorities.

## UI findings

PASS.

- Unassigned technical employees now use the same premium editable schedule composition as office staff: mode, templates, weekly exact hours, partial-day exact Start/End/Break, effective dates, weekly overview and Payroll/Attendance impact.
- Assigned technical employees now receive a premium read-only composition instead of the previous minimal table. It clearly displays Van assignment, authority, weekly projection, partial-day worked hours and the rule for returning to individual authority if removed from all Vans.
- Header save behavior is authority-aware: unassigned technical employees may use `Save Work Schedule`; Van-governed technical employees cannot save an individual schedule.

## Regression evidence on implementation head

PASS.

- ERP Next TypeScript — PASS.
- Existing Employee Schedule acceptance — PASS.
- Existing employee partial-day Payroll acceptance — PASS.
- New Unassigned Technician Schedule acceptance — PASS:
  - individual 09:00–18:00 while no Van;
  - exact Wednesday 09:00–13:00 = 4 worked hours / 0 paid-free;
  - assign to VAN-2 and individual Wednesday becomes inactive;
  - VAN-2 Thursday 08:00–13:00 = 5 worked hours / 0 paid-free;
  - remove from all Vans and saved individual schedule becomes active again;
  - Payroll consumes 4 regular worked hours / 0 paid-free while unassigned;
  - Sunday remains closed;
  - protected write rejects technical schedule when Van assignment is confirmed.
- Employee Attendance acceptance — PASS.
- Van Profile acceptance — PASS.
- ERP Next production build — PASS.
- Van Schedule Architecture — PASS.
- TypeScript/Web Build Validation — PASS.
- Both Vercel previews for the implementation head — READY.

## Process note

Before the feature branch was created, a task-document placeholder was accidentally written to `main` and immediately reverted. No functional code or production data was changed by that incident. The feature branch was created only after cleanup, from the resulting current `main`, and is `behind_by: 0` relative to that base at review time.

## Verdict

**APPROVE FOR PR / OWNER VALIDATION.**

No blocking correctness, authority, data-preservation, integration, or build finding remains. A new owner instruction is required before merging to `main`.
