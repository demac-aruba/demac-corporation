# Review: daily shift form and invalid-calculation display

## Review mode

- [x] Independent Review
- Reviewer: attendance_review (did not implement)
- Builder: root
- Scope: complete corrective diff over7c0f6; task/ADR attendance-shift-form-20261027.

## Findings and decision

No blocking findings. Shared domain validation was correct; the free planned-end input
and zero-valued error display caused the incident. The repair derives only draft planned
end/day offset after explicit opt-in or planned-input edits. Existing snapshots are not
normalized on load or real-time edits. Manual200 selection survives incomplete inputs.
Independent duration preview reuses the shared interval/WorkOrder union. Commit/revision,
audit, permissions, neighboring record guards and payroll formulas remain unchanged.

- [x] Pass code review; publication requires final-head authenticated CI and applicable checks.

## Evidence

Reviewer independently ran attendance/split/transaction acceptance,18,720 combinations
of planned start/duration/break,9 WorkOrder union cases including duplicates, and diff
whitespace validation: all PASS. Reviewer inspected real component screenshot showing
840 worked/480 regular/360 manual200, distinct planned and actual break.

Builder: typecheck and production build PASS; desktop/mobile split and overnight browser
flows PASS with isolated synthetic adapters and zero external requests. These include
automatic end, planned0/60, actual-time edits not rebasing the plan, invalid plan preserving
14h actual and marking payroll Pending, invalid actual offset marking actual Pending,
manual200 retention and guarded save. The Overtime test locator was scoped to Daily Record
because a period KPI shares its label; no assertion was removed. Fixture HTML declares UTF-8.

Authentication/Rules and reload checks run in existing CI, with an isolated demo project.
No real employee records are test fixtures. No backend/Rules/dependency/model change or
backfill. Residual limitation: users still explicitly confirm a dated shift; moving all
regular windows automatically from clock-in would hide lateness and is not authorized.
Existing merge/deploy authorization covers this corrective release.
