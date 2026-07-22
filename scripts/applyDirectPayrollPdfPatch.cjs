const fs = require('fs');

const path = 'src/screens/EmployeesTimesheetScreen.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceRequired(search, replacement, label) {
  if (!text.includes(search)) throw new Error(`Missing expected block: ${label}`);
  text = text.replace(search, replacement);
}

replaceRequired(
  "import { EmployeeTimesheetEntry, PayrollDayStatus, PayrollEmployee, PayrollEmployeeSummary, PayrollEmployeeType } from '../payroll/types';\n",
  "import { EmployeeTimesheetEntry, PayrollDayStatus, PayrollEmployee, PayrollEmployeeSummary, PayrollEmployeeType } from '../payroll/types';\nimport { downloadPayrollSummaryPdf } from '../services/payrollPdf';\n",
  'payroll PDF import',
);

const oldPdfStart = text.indexOf('function escapeHtml(value: string | number) {');
const componentStart = text.indexOf('export function EmployeesTimesheetScreen() {');
if (oldPdfStart < 0 || componentStart < 0 || componentStart <= oldPdfStart) {
  throw new Error('Could not locate old printable PDF implementation');
}
text = `${text.slice(0, oldPdfStart)}${text.slice(componentStart)}`;

replaceRequired(
  "'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Día de semana', 'Horas regulares reales', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas libres pagadas', 'Estado', 'Nota',",
  "'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Día de semana', 'Horas regulares reales', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Estado', 'Nota',",
  'detailed CSV header',
);

replaceRequired(
  "          hours(day.noWorkNoPayHours),\n          hours(day.paidFreeHours),\n          day.status,",
  "          hours(day.noWorkNoPayHours),\n          day.status,",
  'detailed CSV paid free value',
);

replaceRequired(
  "  function downloadSummaryPdf() {\n    const ok = printPayrollSummaryPdf(period.label, summaries);\n    setMessage(ok ? 'Se abrió el resumen listo para guardar como PDF.' : 'Permite ventanas emergentes para generar el PDF desde la versión web/PWA.');\n  }",
  "  function downloadSummaryPdf() {\n    const ok = downloadPayrollSummaryPdf({\n      filename: `DEMAC_Payroll_Resumen_${period.startDate}_${period.endDate}.pdf`,\n      periodLabel: period.label,\n      summaries,\n    });\n    setMessage(ok ? 'Resumen PDF descargado correctamente.' : 'La descarga PDF está disponible desde la versión web/PWA.');\n  }",
  'summary PDF action',
);

fs.writeFileSync(path, text);
