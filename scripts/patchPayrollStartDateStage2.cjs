const fs = require('fs');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

replaceOrConfirm(
  'src/components/EmployeeProfileEditor.tsx',
  '      </View>\n\n      <Text style={styles.label}>TIPO DE EMPLEADO</Text>',
  '      </View>\n      <Input\n        label="Starting Date / Fecha de inicio (AAAA-MM-DD)"\n        value={draft.startDate ?? \'\'}\n        onChangeText={(startDate) => setDraft((current) => ({ ...current, startDate }))}\n        placeholder="2026-07-10"\n      />\n      <Text style={styles.noticeText}>La nómina y el Timesheet comienzan a acumular horas desde esta fecha.</Text>\n\n      <Text style={styles.label}>TIPO DE EMPLEADO</Text>',
  'Starting Date / Fecha de inicio',
);

const screen = 'src/screens/EmployeesTimesheetScreen.tsx';
replaceOrConfirm(
  screen,
  '  const activeEmployees = useMemo(() => module.employees.filter((employee) => employee.active), [module.employees]);',
  '  const activeEmployees = useMemo(() => module.employees.filter((employee) => employee.active && (!employee.startDate || employee.startDate <= period.endDate)), [module.employees, period.endDate]);',
  'employee.startDate <= period.endDate',
);
replaceOrConfirm(
  screen,
  '    for (const employee of activeEmployees) {\n      for (const date of periodDates) {',
  '    for (const employee of activeEmployees) {\n      for (const date of periodDates) {\n        if (employee.startDate && date < employee.startDate) continue;',
  'date < employee.startDate) continue',
);
replaceOrConfirm(
  screen,
  '      \'Empleado\', \'Cargo\', \'Tipo\', \'Horas semanales base\', `Horas mensuales base (${MONTHLY_HOURS_FACTOR})`, \'Horas regulares reales del período\', \'Overtime\', \'AO\', \'Vacaciones\', \'No Work No Pay\', \'Horas pagables estimadas\',',
  '      \'Empleado\', \'Cargo\', \'Tipo\', \'Fecha de inicio\', \'Horas semanales base\', `Base mensual o proporcional (${MONTHLY_HOURS_FACTOR})`, \'Overtime\', \'AO\', \'Vacaciones\', \'No Work No Pay\', \'Horas pagables netas\',',
  "'Fecha de inicio', 'Horas semanales base'",
);
replaceOrConfirm(
  screen,
  '      summary.employee.employeeType,\n      hours(summary.weeklyRegularHours),\n      hours(summary.monthlyBaseHours),\n      hours(summary.actualRegularHours),\n      hours(summary.overtimeHours),',
  '      summary.employee.employeeType,\n      summary.employee.startDate ?? \'\',\n      hours(summary.weeklyRegularHours),\n      hours(summary.monthlyBaseHours),\n      hours(summary.overtimeHours),',
  "summary.employee.startDate ?? ''",
);
replaceOrConfirm(
  screen,
  "      employeeType: 'Técnico',\n      canDriveVan: false,",
  "      employeeType: 'Técnico',\n      startDate: dateKey(new Date()),\n      canDriveVan: false,",
  'startDate: dateKey(new Date())',
);
replaceOrConfirm(
  screen,
  "    if (!name || !phone) {\n      setMessage('Nombre y teléfono son obligatorios.');\n      return;\n    }",
  "    if (!name || !phone) {\n      setMessage('Nombre y teléfono son obligatorios.');\n      return;\n    }\n    if (!profile.startDate || !/^\\d{4}-\\d{2}-\\d{2}$/.test(profile.startDate)) {\n      setMessage('La fecha de inicio es obligatoria y debe usar el formato AAAA-MM-DD.');\n      return;\n    }",
  'La fecha de inicio es obligatoria',
);
replaceOrConfirm(
  screen,
  '                {periodDates.map((date) => {',
  '                {periodDates.filter((date) => !selectedEmployee.startDate || date >= selectedEmployee.startDate).map((date) => {',
  'periodDates.filter((date) => !selectedEmployee.startDate',
);
replaceOrConfirm(
  screen,
  '        <Text style={styles.rulesText}>• La base mensual se calcula como horas regulares semanales × {MONTHLY_HOURS_FACTOR} y se redondea a horas completas.</Text>',
  '        <Text style={styles.rulesText}>• La base mensual se calcula como horas regulares semanales × {MONTHLY_HOURS_FACTOR} y se redondea a horas completas. En el primer período de un empleado nuevo, la base se prorratea desde su Starting Date.</Text>',
  'la base se prorratea desde su Starting Date',
);
replaceOrConfirm(
  screen,
  '              <View style={styles.dayRowDate}><Text style={styles.employeeName}>{profile.name}</Text><Text style={styles.employeeRole}>{profile.role} · {profile.phone}</Text></View>',
  "              <View style={styles.dayRowDate}><Text style={styles.employeeName}>{profile.name}</Text><Text style={styles.employeeRole}>{profile.role} · {profile.phone} · Inicio: {profile.startDate ?? 'No registrado'}</Text></View>",
  "profile.startDate ?? 'No registrado'",
);
replaceOrConfirm(
  screen,
  '      <View style={styles.employeeIdentity}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role} · {summary.employee.employeeType}</Text></View>',
  "      <View style={styles.employeeIdentity}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role} · {summary.employee.employeeType}{summary.employee.startDate ? ` · Inicio: ${summary.employee.startDate}` : ''}</Text></View>",
  'summary.employee.startDate ? ` · Inicio:',
);
replaceOrConfirm(
  screen,
  'function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {\n  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Base semana" value={summary.weeklyRegularHours} /><SummaryValue label="Base mes" value={summary.monthlyBaseHours} /><SummaryValue label="Laboradas" value={summary.actualRegularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="Vacaciones" value={summary.vacationHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;\n}',
  'function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {\n  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}{summary.employee.startDate ? ` · Inicio: ${summary.employee.startDate}` : \'\'}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Base semana" value={summary.weeklyRegularHours} /><SummaryValue label={summary.proratedBase ? \'Base proporcional\' : \'Base mes\'} value={summary.monthlyBaseHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="Vacaciones" value={summary.vacationHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Pagables netas" value={summary.payableHours} /></View></View>;\n}',
  'label="Pagables netas"',
);

const pdf = 'src/services/payrollPdf.ts';
replaceOrConfirm(
  pdf,
  '      page.drawText(`${truncate(summary.employee.role, 30)} - ${summary.employee.employeeType}`, MARGIN + 12, top + 31, 7.8, { fill: MUTED });',
  '      const startDetail = summary.employee.startDate ? ` - Inicio: ${summary.employee.startDate}` : \'\';\n      page.drawText(`${truncate(summary.employee.role, 24)} - ${summary.employee.employeeType}${startDetail}`, MARGIN + 12, top + 31, 7.8, { fill: MUTED });',
  'const startDetail = summary.employee.startDate',
);
replaceOrConfirm(
  pdf,
  '      page.drawText(`Base mes: ${formatHours(summary.monthlyBaseHours)} h`, PAGE_WIDTH - MARGIN - badgeWidth - 12, top + 16, 7.5, {',
  '      page.drawText(`${summary.proratedBase ? \'Base proporcional\' : \'Base mes\'}: ${formatHours(summary.monthlyBaseHours)} h`, PAGE_WIDTH - MARGIN - badgeWidth - 12, top + 16, 7.1, {',
  "summary.proratedBase ? 'Base proporcional' : 'Base mes'",
);
replaceOrConfirm(
  pdf,
  "        { label: 'Base mensual', value: summary.monthlyBaseHours },\n        { label: 'Laboradas', value: summary.actualRegularHours },\n        { label: 'Overtime', value: summary.overtimeHours },",
  "        { label: summary.proratedBase ? 'Base proporcional' : 'Base mensual', value: summary.monthlyBaseHours },\n        { label: 'Overtime', value: summary.overtimeHours },",
  "label: summary.proratedBase ? 'Base proporcional'",
);
replaceOrConfirm(
  pdf,
  "        { label: 'Horas pagables', value: summary.payableHours, payable: true },",
  "        { label: 'Pagables netas', value: summary.payableHours, payable: true },",
  "label: 'Pagables netas'",
);

console.log('Payroll stage 2 applied.');
