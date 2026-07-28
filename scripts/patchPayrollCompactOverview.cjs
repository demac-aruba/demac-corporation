const fs = require('fs');

const screen = 'src/screens/EmployeesTimesheetScreen.tsx';
let text = fs.readFileSync(screen, 'utf8');
const appliedMarker = 'summaries={summaries}\n        entries={periodEntries}';

if (text.includes(appliedMarker)) {
  console.log('Compact payroll overview already applied.');
  process.exit(0);
}

const totalsStart = text.indexOf('  const totalMetrics = useMemo(() => summaries.reduce((totals, summary) => ({');
const saveDayStart = text.indexOf('\n\n  async function saveDay()', totalsStart);
if (totalsStart < 0 || saveDayStart < 0) {
  throw new Error('Payroll total metrics block was not found.');
}
text = `${text.slice(0, totalsStart)}${text.slice(saveDayStart + 2)}`;

const metricsStart = text.indexOf('      <View style={styles.metrics}>');
const metricsEndMarker = '\n      </View>';
const metricsEnd = text.indexOf(metricsEndMarker, metricsStart);
if (metricsStart < 0 || metricsEnd < 0) {
  throw new Error('Payroll metrics row was not found.');
}
const overview = `      <PayrollAdjustmentsPanel
        employees={activeEmployees}
        summaries={summaries}
        entries={periodEntries}
        period={period}
        adjustments={payrollAdjustments.adjustments}
        loading={payrollAdjustments.loading}
        busy={payrollAdjustments.busy}
        error={payrollAdjustments.error}
        onSave={payrollAdjustments.saveAdjustment}
        onVoid={payrollAdjustments.voidAdjustment}
      />`;
text = `${text.slice(0, metricsStart)}${overview}${text.slice(metricsEnd + metricsEndMarker.length)}`;

const duplicatePanel = `

      <PayrollAdjustmentsPanel
        employees={activeEmployees}
        period={period}
        adjustments={payrollAdjustments.adjustments}
        loading={payrollAdjustments.loading}
        busy={payrollAdjustments.busy}
        error={payrollAdjustments.error}
        onSave={payrollAdjustments.saveAdjustment}
        onVoid={payrollAdjustments.voidAdjustment}
      />`;
if (!text.includes(duplicatePanel)) {
  throw new Error('The previous full-width payroll adjustments panel was not found.');
}
text = text.replace(duplicatePanel, '');

const metricFunctionStart = text.indexOf('\nfunction Metric(');
const employeeRowStart = text.indexOf('\nfunction EmployeeSummaryRow', metricFunctionStart);
if (metricFunctionStart < 0 || employeeRowStart < 0) {
  throw new Error('The legacy Metric component was not found.');
}
text = `${text.slice(0, metricFunctionStart)}${text.slice(employeeRowStart)}`;

fs.writeFileSync(screen, text);
console.log('Compact payroll history cards applied.');
