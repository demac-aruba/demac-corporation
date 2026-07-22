const fs = require('fs');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

replaceOrConfirm(
  'src/types.ts',
  '  email?: string;\n  role: StaffRole;',
  '  email?: string;\n  startDate?: string;\n  role: StaffRole;',
  '  startDate?: string;\n  role: StaffRole;',
);

replaceOrConfirm(
  'src/payroll/types.ts',
  '  active: boolean;\n  sourceStaffId?: string;',
  '  active: boolean;\n  startDate?: string;\n  sourceStaffId?: string;',
  '  startDate?: string;\n  sourceStaffId?: string;',
);

replaceOrConfirm(
  'src/payroll/types.ts',
  '  monthlyBaseHours: number;\n  actualRegularHours: number;',
  '  monthlyBaseHours: number;\n  effectiveStartDate?: string;\n  proratedBase: boolean;\n  actualRegularHours: number;',
  '  proratedBase: boolean;',
);

replaceOrConfirm(
  'src/hooks/usePayrollModule.ts',
  '    active: profile.active,\n    weekdayHours: 8,',
  '    active: profile.active,\n    startDate: profile.startDate,\n    weekdayHours: 8,',
  '    startDate: profile.startDate,',
);

replaceOrConfirm(
  'src/hooks/usePayrollModule.ts',
  'export function employeeScheduleForDate(employee: PayrollEmployee, date: string) {\n  const parsed = parseIsoDate(date);',
  'export function employeeScheduleForDate(employee: PayrollEmployee, date: string) {\n  if (employee.startDate && date < employee.startDate) return { scheduledWorkHours: 0, paidFreeHours: 0 };\n  const parsed = parseIsoDate(date);',
  'if (employee.startDate && date < employee.startDate)',
);

{
  const path = 'src/hooks/usePayrollModule.ts';
  let text = fs.readFileSync(path, 'utf8');
  if (!text.includes('export function calculatePayableHours(')) {
    const start = text.indexOf('export function summarizeEmployee(');
    const end = text.indexOf('export function usePayrollModule(', start);
    if (start < 0 || end < 0) throw new Error('Could not locate summarizeEmployee block');
    const replacement = `export function calculatePayableHours(monthlyBaseHours: number, noWorkNoPayHours: number, overtimeHours: number) {
  const baseAfterNoWorkNoPay = Math.max(0, Number(monthlyBaseHours || 0) - Number(noWorkNoPayHours || 0));
  return roundHours(baseAfterNoWorkNoPay + Math.max(0, Number(overtimeHours || 0)));
}

export function summarizeEmployee(employee: PayrollEmployee, period: PayrollPeriod, entries: EmployeeTimesheetEntry[]): PayrollEmployeeSummary {
  const startDate = employee.startDate;
  const periodDates = payrollPeriodDates(period);
  const employeeEntries = new Map(entries
    .filter((entry) => entry.employeeId === employee.id && (!startDate || entry.date >= startDate))
    .map((entry) => [entry.date, entry]));
  const days = periodDates.map((date) => calculatePayrollDay(employee, date, employeeEntries.get(date)));
  const total = (key: keyof Pick<PayrollDayCalculation, 'regularHours' | 'overtimeHours' | 'aoHours' | 'vacationHours' | 'noWorkNoPayHours' | 'paidFreeHours'>) => roundHours(days.reduce((sum, day) => sum + Number(day[key]), 0));
  const weeklyRegularHours = weeklyRegularHoursForPeriod(employee, period);
  const proratedBase = Boolean(startDate && startDate > period.startDate && startDate <= period.endDate);
  const effectiveStart = startDate ?? period.startDate;
  const monthlyBaseHours = startDate && startDate > period.endDate
    ? 0
    : proratedBase
      ? roundHours(periodDates
        .filter((date) => date >= effectiveStart)
        .reduce((sum, date) => sum + employeeScheduleForDate(employee, date).scheduledWorkHours, 0))
      : Math.round(weeklyRegularHours * MONTHLY_HOURS_FACTOR);
  const actualRegularHours = total('regularHours');
  const overtimeHours = total('overtimeHours');
  const aoHours = total('aoHours');
  const vacationHours = total('vacationHours');
  const noWorkNoPayHours = total('noWorkNoPayHours');
  const paidFreeHours = total('paidFreeHours');
  return {
    employee,
    weeklyRegularHours,
    monthlyBaseHours,
    effectiveStartDate: startDate,
    proratedBase,
    actualRegularHours,
    overtimeHours,
    aoHours,
    vacationHours,
    noWorkNoPayHours,
    paidFreeHours,
    payableHours: calculatePayableHours(monthlyBaseHours, noWorkNoPayHours, overtimeHours),
    changedDays: employeeEntries.size,
  };
}

`;
    text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
    fs.writeFileSync(path, text);
  }
}

replaceOrConfirm(
  'src/hooks/usePayrollModule.ts',
  '        active: master.active,\n      });',
  '        active: master.active,\n        startDate: master.startDate,\n      });',
  '        startDate: master.startDate,',
);

console.log('Payroll stage 1 applied.');
