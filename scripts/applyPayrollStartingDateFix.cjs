const fs = require('fs');

function patchFile(path, patches) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [search, replacement, label] of patches) {
    if (!text.includes(search)) throw new Error(`Missing expected block in ${path}: ${label}`);
    text = text.replace(search, replacement);
  }
  fs.writeFileSync(path, text);
}

patchFile('src/types.ts', [
  [
    "  email?: string;\n  role: StaffRole;",
    "  email?: string;\n  startDate?: string;\n  role: StaffRole;",
    'staff start date',
  ],
]);

patchFile('src/payroll/types.ts', [
  [
    "  active: boolean;\n  sourceStaffId?: string;",
    "  active: boolean;\n  startDate?: string;\n  sourceStaffId?: string;",
    'payroll employee start date',
  ],
  [
    "  monthlyBaseHours: number;\n  actualRegularHours: number;",
    "  monthlyBaseHours: number;\n  effectiveStartDate?: string;\n  proratedBase: boolean;\n  actualRegularHours: number;",
    'summary prorated fields',
  ],
]);

patchFile('src/hooks/usePayrollModule.ts', [
  [
    "    active: profile.active,\n    weekdayHours: 8,",
    "    active: profile.active,\n    startDate: profile.startDate,\n    weekdayHours: 8,",
    'map staff start date',
  ],
  [
    "export function employeeScheduleForDate(employee: PayrollEmployee, date: string) {\n  const parsed = parseIsoDate(date);",
    "export function employeeScheduleForDate(employee: PayrollEmployee, date: string) {\n  if (employee.startDate && date < employee.startDate) return { scheduledWorkHours: 0, paidFreeHours: 0 };\n  const parsed = parseIsoDate(date);",
    'ignore dates before employment',
  ],
  [
    "export function summarizeEmployee(employee: PayrollEmployee, period: PayrollPeriod, entries: EmployeeTimesheetEntry[]): PayrollEmployeeSummary {\n  const employeeEntries = new Map(entries.filter((entry) => entry.employeeId === employee.id).map((entry) => [entry.date, entry]));\n  const days = payrollPeriodDates(period).map((date) => calculatePayrollDay(employee, date, employeeEntries.get(date)));\n  const total = (key: keyof Pick<PayrollDayCalculation, 'regularHours' | 'overtimeHours' | 'aoHours' | 'vacationHours' | 'noWorkNoPayHours' | 'paidFreeHours'>) => roundHours(days.reduce((sum, day) => sum + Number(day[key]), 0));\n  const weeklyRegularHours = weeklyRegularHoursForPeriod(employee, period);\n  const monthlyBaseHours = Math.round(weeklyRegularHours * MONTHLY_HOURS_FACTOR);\n  const actualRegularHours = total('regularHours');\n  const overtimeHours = total('overtimeHours');\n  const aoHours = total('aoHours');\n  const vacationHours = total('vacationHours');\n  const noWorkNoPayHours = total('noWorkNoPayHours');\n  const paidFreeHours = total('paidFreeHours');\n  return {\n    employee,\n    weeklyRegularHours,\n    monthlyBaseHours,\n    actualRegularHours,\n    overtimeHours,\n    aoHours,\n    vacationHours,\n    noWorkNoPayHours,\n    paidFreeHours,\n    payableHours: roundHours(Math.max(0, monthlyBaseHours - noWorkNoPayHours) + overtimeHours),\n    changedDays: employeeEntries.size,\n  };\n}",
    "export function calculatePayableHours(monthlyBaseHours: number, noWorkNoPayHours: number, overtimeHours: number) {\n  const baseAfterNoWorkNoPay = Math.max(0, Number(monthlyBaseHours || 0) - Number(noWorkNoPayHours || 0));\n  return roundHours(baseAfterNoWorkNoPay + Math.max(0, Number(overtimeHours || 0)));\n}\n\nexport function summarizeEmployee(employee: PayrollEmployee, period: PayrollPeriod, entries: EmployeeTimesheetEntry[]): PayrollEmployeeSummary {\n  const startDate = employee.startDate;\n  const periodDates = payrollPeriodDates(period);\n  const employeeEntries = new Map(entries\n    .filter((entry) => entry.employeeId === employee.id && (!startDate || entry.date >= startDate))\n    .map((entry) => [entry.date, entry]));\n  const days = periodDates.map((date) => calculatePayrollDay(employee, date, employeeEntries.get(date)));\n  const total = (key: keyof Pick<PayrollDayCalculation, 'regularHours' | 'overtimeHours' | 'aoHours' | 'vacationHours' | 'noWorkNoPayHours' | 'paidFreeHours'>) => roundHours(days.reduce((sum, day) => sum + Number(day[key]), 0));\n  const weeklyRegularHours = weeklyRegularHoursForPeriod(employee, period);\n  const proratedBase = Boolean(startDate && startDate > period.startDate && startDate <= period.endDate);\n  const monthlyBaseHours = startDate && startDate > period.endDate\n    ? 0\n    : proratedBase\n      ? roundHours(periodDates\n        .filter((date) => date >= startDate)\n        .reduce((sum, date) => sum + employeeScheduleForDate(employee, date).scheduledWorkHours, 0))\n      : Math.round(weeklyRegularHours * MONTHLY_HOURS_FACTOR);\n  const actualRegularHours = total('regularHours');\n  const overtimeHours = total('overtimeHours');\n  const aoHours = total('aoHours');\n  const vacationHours = total('vacationHours');\n  const noWorkNoPayHours = total('noWorkNoPayHours');\n  const paidFreeHours = total('paidFreeHours');\n  return {\n    employee,\n    weeklyRegularHours,\n    monthlyBaseHours,\n    effectiveStartDate: startDate,\n    proratedBase,\n    actualRegularHours,\n    overtimeHours,\n    aoHours,\n    vacationHours,\n    noWorkNoPayHours,\n    paidFreeHours,\n    payableHours: calculatePayableHours(monthlyBaseHours, noWorkNoPayHours, overtimeHours),\n    changedDays: employeeEntries.size,\n  };\n}",
    'replace payroll summary math',
  ],
  [
    "        active: master.active,\n      });",
    "        active: master.active,\n        startDate: master.startDate,\n      });",
    'preserve master start date',
  ],
]);

patchFile('src/components/EmployeeProfileEditor.tsx', [
  [
    "      </View>\n\n      <Text style={styles.label}>TIPO DE EMPLEADO</Text>",
    "      </View>\n      <Input\n        label=\"Starting Date / Fecha de inicio (AAAA-MM-DD)\"\n        value={draft.startDate ?? ''}\n        onChangeText={(startDate) => setDraft((current) => ({ ...current, startDate }))}\n        placeholder=\"2026-07-10\"\n      />\n      <Text style={styles.noticeText}>La nómina y el Timesheet comienzan a acumular horas desde esta fecha.</Text>\n\n      <Text style={styles.label}>TIPO DE EMPLEADO</Text>",
    'starting date input',
  ],
]);

patchFile('src/screens/EmployeesTimesheetScreen.tsx', [
  [
    "  const activeEmployees = useMemo(() => module.employees.filter((employee) => employee.active), [module.employees]);",
    "  const activeEmployees = useMemo(() => module.employees.filter((employee) => employee.active && (!employee.startDate || employee.startDate <= period.endDate)), [module.employees, period.endDate]);",
    'exclude future employees from payroll period',
  ],
  [
    "    for (const employee of activeEmployees) {\n      for (const date of periodDates) {",
    "    for (const employee of activeEmployees) {\n      for (const date of periodDates) {\n        if (employee.startDate && date < employee.startDate) continue;",
    'skip pre-employment detailed rows',
  ],
  [
    "      'Empleado', 'Cargo', 'Tipo', 'Horas semanales base', `Horas mensuales base (${MONTHLY_HOURS_FACTOR})`, 'Horas regulares reales del período', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas pagables estimadas',",
    "      'Empleado', 'Cargo', 'Tipo', 'Fecha de inicio', 'Horas semanales base', `Base mensual o proporcional (${MONTHLY_HOURS_FACTOR})`, 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas pagables netas',",
    'summary csv header',
  ],
  [
    "      summary.employee.employeeType,\n      hours(summary.weeklyRegularHours),\n      hours(summary.monthlyBaseHours),\n      hours(summary.actualRegularHours),\n      hours(summary.overtimeHours),",
    "      summary.employee.employeeType,\n      summary.employee.startDate ?? '',\n      hours(summary.weeklyRegularHours),\n      hours(summary.monthlyBaseHours),\n      hours(summary.overtimeHours),",
    'summary csv values',
  ],
  [
    "      employeeType: 'Técnico',\n      canDriveVan: false,",
    "      employeeType: 'Técnico',\n      startDate: dateKey(new Date()),\n      canDriveVan: false,",
    'new employee start date default',
  ],
  [
    "    if (!name || !phone) {\n      setMessage('Nombre y teléfono son obligatorios.');\n      return;\n    }",
    "    if (!name || !phone) {\n      setMessage('Nombre y teléfono son obligatorios.');\n      return;\n    }\n    if (!profile.startDate || !/^\\d{4}-\\d{2}-\\d{2}$/.test(profile.startDate)) {\n      setMessage('La fecha de inicio es obligatoria y debe usar el formato AAAA-MM-DD.');\n      return;\n    }",
    'validate starting date',
  ],
  [
    "                {periodDates.map((date) => {",
    "                {periodDates.filter((date) => !selectedEmployee.startDate || date >= selectedEmployee.startDate).map((date) => {",
    'hide pre-employment day rows',
  ],
  [
    "            <Text style={styles.rulesText}>• La base mensual se calcula como horas regulares semanales × {MONTHLY_HOURS_FACTOR} y se redondea a horas completas.</Text>",
    "            <Text style={styles.rulesText}>• La base mensual se calcula como horas regulares semanales × {MONTHLY_HOURS_FACTOR} y se redondea a horas completas. En el primer período de un empleado nuevo, la base se prorratea desde su Starting Date.</Text>",
    'starting date payroll rule',
  ],
  [
    "              <View style={styles.dayRowDate}><Text style={styles.employeeName}>{profile.name}</Text><Text style={styles.employeeRole}>{profile.role} · {profile.phone}</Text></View>",
    "              <View style={styles.dayRowDate}><Text style={styles.employeeName}>{profile.name}</Text><Text style={styles.employeeRole}>{profile.role} · {profile.phone} · Inicio: {profile.startDate ?? 'No registrado'}</Text></View>",
    'directory start date',
  ],
  [
    "      <View style={styles.employeeIdentity}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role} · {summary.employee.employeeType}</Text></View>",
    "      <View style={styles.employeeIdentity}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role} · {summary.employee.employeeType}{summary.employee.startDate ? ` · Inicio: ${summary.employee.startDate}` : ''}</Text></View>",
    'summary row start date',
  ],
  [
    "function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {\n  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label=\"Base semana\" value={summary.weeklyRegularHours} /><SummaryValue label=\"Base mes\" value={summary.monthlyBaseHours} /><SummaryValue label=\"Laboradas\" value={summary.actualRegularHours} /><SummaryValue label=\"OT\" value={summary.overtimeHours} /><SummaryValue label=\"AO\" value={summary.aoHours} /><SummaryValue label=\"Vacaciones\" value={summary.vacationHours} /><SummaryValue label=\"NWNP\" value={summary.noWorkNoPayHours} /><SummaryValue label=\"Pagables\" value={summary.payableHours} /></View></View>;\n}",
    "function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {\n  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}{summary.employee.startDate ? ` · Inicio: ${summary.employee.startDate}` : ''}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label=\"Base semana\" value={summary.weeklyRegularHours} /><SummaryValue label={summary.proratedBase ? 'Base proporcional' : 'Base mes'} value={summary.monthlyBaseHours} /><SummaryValue label=\"OT\" value={summary.overtimeHours} /><SummaryValue label=\"AO\" value={summary.aoHours} /><SummaryValue label=\"Vacaciones\" value={summary.vacationHours} /><SummaryValue label=\"NWNP\" value={summary.noWorkNoPayHours} /><SummaryValue label=\"Pagables netas\" value={summary.payableHours} /></View></View>;\n}",
    'remove laboradas from summary card',
  ],
]);

patchFile('src/services/payrollPdf.ts', [
  [
    "      page.drawText(`${truncate(summary.employee.role, 30)} - ${summary.employee.employeeType}`, MARGIN + 12, top + 31, 7.8, { fill: MUTED });",
    "      const startDetail = summary.employee.startDate ? ` - Inicio: ${summary.employee.startDate}` : '';\n      page.drawText(`${truncate(summary.employee.role, 24)} - ${summary.employee.employeeType}${startDetail}`, MARGIN + 12, top + 31, 7.8, { fill: MUTED });",
    'pdf start date line',
  ],
  [
    "      page.drawText(`Base mes: ${formatHours(summary.monthlyBaseHours)} h`, PAGE_WIDTH - MARGIN - badgeWidth - 12, top + 16, 7.5, {",
    "      page.drawText(`${summary.proratedBase ? 'Base proporcional' : 'Base mes'}: ${formatHours(summary.monthlyBaseHours)} h`, PAGE_WIDTH - MARGIN - badgeWidth - 12, top + 16, 7.1, {",
    'pdf prorated badge',
  ],
  [
    "        { label: 'Base mensual', value: summary.monthlyBaseHours },\n        { label: 'Laboradas', value: summary.actualRegularHours },\n        { label: 'Overtime', value: summary.overtimeHours },",
    "        { label: summary.proratedBase ? 'Base proporcional' : 'Base mensual', value: summary.monthlyBaseHours },\n        { label: 'Overtime', value: summary.overtimeHours },",
    'remove laboradas pdf metric',
  ],
  [
    "        { label: 'Horas pagables', value: summary.payableHours, payable: true },",
    "        { label: 'Pagables netas', value: summary.payableHours, payable: true },",
    'pdf payable label',
  ],
]);

console.log('Payroll start-date and payable fixes applied.');
