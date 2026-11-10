import { payrollPeriodBounds, type EmployeeSalaryAdvance, type SalaryAdvanceMethod } from './employee-attendance';
import { assertPayrollCorrectionPermission, mutatePayrollCorrection, payrollCorrectionPatch, payrollInputAmount, payrollInputDate, type PayrollCorrection } from './payroll-input-corrections';

export type AdvanceEditDraft = { date: string; amount: string; method: SalaryAdvanceMethod; reference: string; notes: string };

export function activeSalaryAdvance(advance: EmployeeSalaryAdvance) {
  // Historical records predate status; an explicit unknown status must not count.
  return advance.status === undefined || advance.status === 'active';
}

export function advanceValues(advance: EmployeeSalaryAdvance) {
  return { employeeId: advance.employeeId, employeeName: advance.employeeName, date: advance.date,
    payrollPeriodId: advance.payrollPeriodId, amount: advance.amount, method: advance.method,
    reference: advance.reference ?? '', notes: advance.notes ?? '', status: advance.status ?? 'active' };
}

export async function correctSalaryAdvance(input: { advance: EmployeeSalaryAdvance; draft?: AdvanceEditDraft; correction: PayrollCorrection }) {
  assertPayrollCorrectionPermission(input.correction.principal);
  const { advance, draft, correction } = input;
  const before = advanceValues(advance);
  let after = { ...before, status: 'voided' as string };
  if (correction.action === 'edit') {
    if (!draft) throw new Error('Missing advance details.');
    const date = payrollInputDate(draft.date), amount = payrollInputAmount(draft.amount);
    if (!['Cash', 'Bank Transfer'].includes(draft.method)) throw new Error('Select Cash or Bank Transfer.');
    if (draft.reference.trim().length > 500 || draft.notes.trim().length > 2000) throw new Error('Reference or notes are too long.');
    after = { ...before, date, payrollPeriodId: payrollPeriodBounds(date).id, amount, method: draft.method,
      reference: draft.reference.trim(), notes: draft.notes.trim() };
  }
  return mutatePayrollCorrection<EmployeeSalaryAdvance>(advance.id, (current) => {
    if (!current || current.recordType !== 'salaryAdvance' || current.employeeId !== advance.employeeId) throw new Error('Advance no longer matches this employee. Refresh and review.');
    const audit = payrollCorrectionPatch({ current, expected: advance, before: advanceValues(current), expectedValues: before, after, correction });
    return audit ? { ...after, ...audit } : null;
  });
}
