const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function replaceAll(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.split(oldText).join(newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Missing anchor in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const hook = 'src/hooks/usePayrollModule.ts';
insertAfter(
  hook,
  "} from '../payroll/types';",
  "\nimport { overtimeMinutesFromEntry, overtimeMinutesToHours } from '../payroll/overtime';",
  "from '../payroll/overtime';",
);
replaceOnce(
  hook,
  "  const overtimeHours = roundHours(Math.max(0, Number(entry?.overtimeHours ?? 0)));",
  "  const overtimeMinutes = overtimeMinutesFromEntry(entry);\n  const overtimeHours = roundHours(overtimeMinutesToHours(overtimeMinutes));",
  'const overtimeMinutes = overtimeMinutesFromEntry(entry);',
);
replaceOnce(
  hook,
  "    regularHours,\n    overtimeHours,\n    aoHours: roundHours(aoHours),",
  "    regularHours,\n    overtimeHours,\n    overtimeMinutes,\n    aoHours: roundHours(aoHours),",
  '    overtimeMinutes,\n    aoHours: roundHours(aoHours),',
);

const screen = 'src/screens/EmployeesTimesheetScreen.tsx';
insertAfter(
  screen,
  "import { EmployeeTimesheetEntry, PayrollDayStatus, PayrollEmployee, PayrollEmployeeSummary, PayrollEmployeeType } from '../payroll/types';",
  "\nimport { formatOvertimeHours, formatOvertimeMinutes, normalizeOvertimeMinutes, overtimeMinutesFromEntry, overtimeMinutesToHours } from '../payroll/overtime';",
  "from '../payroll/overtime';",
);
replaceOnce(
  screen,
  "    setOvertimeDraft(String(selectedSavedEntry?.overtimeHours ?? 0));",
  "    setOvertimeDraft(String(overtimeMinutesFromEntry(selectedSavedEntry)));",
  'setOvertimeDraft(String(overtimeMinutesFromEntry(selectedSavedEntry)))',
);
replaceOnce(
  screen,
  "    overtimeHours: Math.max(0, Number(overtimeDraft || 0)),",
  "    overtimeHours: overtimeMinutesToHours(overtimeDraft),\n    overtimeMinutes: normalizeOvertimeMinutes(overtimeDraft),",
  'overtimeMinutes: normalizeOvertimeMinutes(overtimeDraft)',
);
replaceOnce(
  screen,
  "      overtimeHours: previewDay.overtimeHours,\n      aoHours: previewDay.aoHours,",
  "      overtimeHours: previewDay.overtimeHours,\n      overtimeMinutes: previewDay.overtimeMinutes,\n      aoHours: previewDay.aoHours,",
  '      overtimeMinutes: previewDay.overtimeMinutes,',
);
replaceAll(
  screen,
  "'Overtime', 'AO'",
  "'Overtime (horas y minutos)', 'AO'",
  "'Overtime (horas y minutos)', 'AO'",
);
replaceOnce(
  screen,
  "          hours(day.overtimeHours),\n          hours(day.aoHours),",
  "          formatOvertimeMinutes(day.overtimeMinutes),\n          hours(day.aoHours),",
  '          formatOvertimeMinutes(day.overtimeMinutes),',
);
replaceOnce(
  screen,
  "      hours(summary.monthlyBaseHours),\n      hours(summary.overtimeHours),\n      hours(summary.aoHours),",
  "      hours(summary.monthlyBaseHours),\n      formatOvertimeHours(summary.overtimeHours),\n      hours(summary.aoHours),",
  '      formatOvertimeHours(summary.overtimeHours),',
);
replaceOnce(
  screen,
  '<Metric label="Horas overtime" value={hours(totalMetrics.overtime)} icon="◴" />',
  '<Metric label="Overtime" value={formatOvertimeHours(totalMetrics.overtime)} icon="◴" />',
  'value={formatOvertimeHours(totalMetrics.overtime)}',
);
replaceOnce(
  screen,
  '                <DayFact label="Horas regulares" value={`${hours(previewDay.regularHours)} h`} />',
  '                <DayFact label="Horas regulares" value={`${hours(previewDay.regularHours)} h`} />\n                <DayFact label="Overtime convertido" value={formatOvertimeMinutes(previewDay.overtimeMinutes)} />',
  'label="Overtime convertido"',
);
replaceOnce(
  screen,
  '                <Input style={styles.field} keyboardType="decimal-pad" label="Overtime" value={overtimeDraft} onChangeText={setOvertimeDraft} />',
  '                <Input style={styles.field} keyboardType="number-pad" label="Overtime (minutos)" value={overtimeDraft} onChangeText={(value) => setOvertimeDraft(value.replace(/\\D/g, \'\'))} placeholder="Ej. 90" />',
  'label="Overtime (minutos)"',
);
replaceOnce(
  screen,
  '                       {day.overtimeHours ? <Text style={styles.overtimeText}>+{hours(day.overtimeHours)} OT</Text> : null}',
  '                       {day.overtimeMinutes ? <Text style={styles.overtimeText}>+{formatOvertimeMinutes(day.overtimeMinutes)} OT</Text> : null}',
  'day.overtimeMinutes ? <Text style={styles.overtimeText}',
);
replaceOnce(
  screen,
  '        <Text style={styles.rulesText}>• AO y vacaciones se reportan por separado; No Work No Pay se descuenta de la base mensual. Las horas libres del medio día son un beneficio de horario y no se muestran como categoría de payroll.</Text>',
  '        <Text style={styles.rulesText}>• AO y vacaciones se reportan por separado; No Work No Pay se descuenta de la base mensual. Las horas libres del medio día son un beneficio de horario y no se muestran como categoría de payroll.</Text>\n        <Text style={styles.rulesText}>• El overtime se ingresa siempre en minutos. El sistema lo convierte automáticamente: 90 minutos = 1 h 30 min; 100 minutos = 1 h 40 min.</Text>',
  'El overtime se ingresa siempre en minutos.',
);
replaceAll(
  screen,
  '<SummaryValue label="OT" value={summary.overtimeHours} />',
  '<SummaryValue label="OT" value={summary.overtimeHours} duration />',
  'value={summary.overtimeHours} duration',
);
replaceOnce(
  screen,
  "function SummaryValue({ label, value, warning, danger }: { label: string; value: number; warning?: boolean; danger?: boolean }) {\n  return <View style={styles.summaryValue}><Text style={styles.summaryLabel}>{label}</Text><Text style={[styles.summaryNumber, warning && styles.aoText, danger && styles.noWorkText]}>{hours(value)}</Text></View>;\n}",
  "function SummaryValue({ label, value, warning, danger, duration }: { label: string; value: number; warning?: boolean; danger?: boolean; duration?: boolean }) {\n  return <View style={styles.summaryValue}><Text style={styles.summaryLabel}>{label}</Text><Text style={[styles.summaryNumber, warning && styles.aoText, danger && styles.noWorkText]}>{duration ? formatOvertimeHours(value) : hours(value)}</Text></View>;\n}",
  'duration?: boolean',
);
replaceOnce(
  screen,
  'message="Abre un empleado para registrar AO, No Work No Pay y overtime."',
  'message="Abre un empleado para registrar AO, vacaciones, No Work No Pay y overtime en minutos."',
  'overtime en minutos.',
);

const pdf = 'src/services/payrollPdf.ts';
insertAfter(
  pdf,
  "import { PayrollEmployeeSummary } from '../payroll/types';",
  "\nimport { formatOvertimeHours } from '../payroll/overtime';",
  "from '../payroll/overtime';",
);
replaceOnce(
  pdf,
  'const values = [summaries.length, formatHours(totalBase), formatHours(totalOt), formatHours(totalAo + totalVacation), formatHours(totalNwnp)];',
  'const values = [summaries.length, formatHours(totalBase), formatOvertimeHours(totalOt), formatHours(totalAo + totalVacation), formatHours(totalNwnp)];',
  'formatOvertimeHours(totalOt)',
);
replaceOnce(
  pdf,
  "      const metrics: Array<{ label: string; value: number; payable?: boolean }> = [",
  "      const metrics: Array<{ label: string; value: number | string; payable?: boolean }> = [",
  'value: number | string',
);
replaceOnce(
  pdf,
  "        { label: 'Overtime', value: summary.overtimeHours },",
  "        { label: 'Overtime', value: formatOvertimeHours(summary.overtimeHours) },",
  "value: formatOvertimeHours(summary.overtimeHours)",
);
replaceOnce(
  pdf,
  '        page.drawText(formatHours(metric.value), x + 6, metricTop + 16, 9.5, { bold: true, fill: metric.payable ? DARK_GREEN : TEXT });',
  "        page.drawText(typeof metric.value === 'number' ? formatHours(metric.value) : metric.value, x + 6, metricTop + 16, 9.5, { bold: true, fill: metric.payable ? DARK_GREEN : TEXT });",
  "typeof metric.value === 'number'",
);

console.log('Payroll overtime minute input patch applied.');
