# Restore employee bonuses and accountant exports

- Owner: Christian, 2026-09-29. Deep Review: financial payroll inputs and retry/concurrency.
- Baseline: `9db2af1` (main). Branch: `fix/restore-employee-bonuses`.
- Evidence: Legacy addition `c2966b609a7f3c51bfa75d077d559c6222a463b4`, July 28,
  and compact UI `f398ff2ca93dff2df29027341e665e43b2451b70`. Legacy uses
  `src/hooks/usePayrollAdjustments.ts`, the panel, and accounting PDF.
- ERP Next workspace introduced in `9d130693e78a95b90b3e71c04f12a55838b497f4`
  did not include the monetary adjustment form. Current report also omits bonus totals.
- Restore manual bonuses: employee, selected 27–26 period, date, category, Afl. amount,
  reason, actor/time, history and cancellation with reason. No automatic commission rules.
- Preserve `employeePayrollSettings/{owner}.payrollAdjustments`, existing deductions,
  settings/schedules and legacy bonus history. No collection, migration or security change.
- Include active bonus totals in both Employees and Finance PDF/CSV exports. CSV includes
  concepts; detailed bonus CSV retains cancellations and audit. Monetary values never become hours.
- Verify legacy linkage, multiple employees/periods/categories, invalid amounts/dates,
  denied writes, optimistic concurrency, exact retry after unknown outcome, cancellation,
  full UI save/reload/export and PDF layout. No real employee entries in tests.
- User's merge/deploy authorization remains in effect for this payroll work session.
