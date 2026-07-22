const fs = require('fs');
const path = 'src/screens/EmployeesTimesheetScreen.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText) {
  if (!text.includes(oldText)) throw new Error(`Pattern not found: ${oldText.slice(0, 120)}`);
  text = text.replace(oldText, newText);
}

replaceOnce(
`function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const content = \`\\uFEFF\${rows.map((row) => row.map(csvCell).join(';')).join('\\n')}\`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
`,
`function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const content = \`\\uFEFF\${rows.map((row) => row.map(csvCell).join(';')).join('\\n')}\`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

function escapeHtml(value: string | number) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function printPayrollSummaryPdf(periodLabel: string, summaries: PayrollEmployeeSummary[]) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const reportWindow = window.open('', '_blank', 'width=1100,height=800');
  if (!reportWindow) return false;
  const cards = summaries.map((summary) => \`
    <section class="employee-card">
      <div class="employee-heading">
        <div>
          <h2>\${escapeHtml(summary.employee.name)}</h2>
          <p>\${escapeHtml(summary.employee.role)} · \${escapeHtml(summary.employee.employeeType)}</p>
        </div>
        <span class="base-badge">Base mes: \${hours(summary.monthlyBaseHours)} h</span>
      </div>
      <div class="values">
        <div><span>Base semanal</span><strong>\${hours(summary.weeklyRegularHours)}</strong></div>
        <div><span>Base mensual</span><strong>\${hours(summary.monthlyBaseHours)}</strong></div>
        <div><span>Laboradas</span><strong>\${hours(summary.actualRegularHours)}</strong></div>
        <div><span>Overtime</span><strong>\${hours(summary.overtimeHours)}</strong></div>
        <div><span>AO</span><strong>\${hours(summary.aoHours)}</strong></div>
        <div><span>Vacaciones</span><strong>\${hours(summary.vacationHours)}</strong></div>
        <div><span>No Work No Pay</span><strong>\${hours(summary.noWorkNoPayHours)}</strong></div>
        <div class="payable"><span>Horas pagables</span><strong>\${hours(summary.payableHours)}</strong></div>
      </div>
    </section>\`).join('');
  const totalBase = summaries.reduce((sum, item) => sum + item.monthlyBaseHours, 0);
  const totalOt = summaries.reduce((sum, item) => sum + item.overtimeHours, 0);
  const totalAo = summaries.reduce((sum, item) => sum + item.aoHours, 0);
  const totalVacation = summaries.reduce((sum, item) => sum + item.vacationHours, 0);
  const totalNwnp = summaries.reduce((sum, item) => sum + item.noWorkNoPayHours, 0);
  reportWindow.document.write(\`<!doctype html><html><head><meta charset="utf-8"><title>DEMAC Payroll - \${escapeHtml(periodLabel)}</title><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #17212b; background: #fff; }
    .header { border-bottom: 4px solid #24a51c; padding-bottom: 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
    .brand { font-size: 25px; font-weight: 900; letter-spacing: .5px; }
    .subtitle { margin-top: 4px; color: #5e6872; font-size: 12px; }
    .period { text-align: right; font-size: 12px; font-weight: 700; }
    .totals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 16px; }
    .total { border: 1px solid #dfe5e8; border-radius: 8px; padding: 10px; background: #f8faf9; }
    .total span, .values span { display: block; color: #6a747d; font-size: 9px; text-transform: uppercase; font-weight: 700; }
    .total strong { display: block; margin-top: 5px; font-size: 16px; }
    .employee-card { border: 1px solid #d9e0e3; border-radius: 10px; padding: 13px; margin-bottom: 11px; break-inside: avoid; }
    .employee-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid #e6ebed; padding-bottom: 9px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 15px; }
    p { margin: 3px 0 0; color: #68737c; font-size: 10px; }
    .base-badge { background: #e7f6e5; color: #20851a; border-radius: 15px; padding: 6px 10px; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .values { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .values div { background: #f7f9fa; border-radius: 7px; padding: 8px; }
    .values strong { display: block; margin-top: 4px; font-size: 13px; }
    .values .payable { background: #e7f6e5; }
    .footer { color: #7a848c; font-size: 9px; margin-top: 14px; text-align: center; }
  </style></head><body>
    <header class="header"><div><div class="brand">DEMAC</div><div class="subtitle">Professional Cooling Solutions · Resumen de payroll</div></div><div class="period">Período de nómina<br>\${escapeHtml(periodLabel)}</div></header>
    <div class="totals">
      <div class="total"><span>Empleados</span><strong>\${summaries.length}</strong></div>
      <div class="total"><span>Base mensual</span><strong>\${hours(totalBase)}</strong></div>
      <div class="total"><span>Overtime</span><strong>\${hours(totalOt)}</strong></div>
      <div class="total"><span>AO / Vacaciones</span><strong>\${hours(totalAo + totalVacation)}</strong></div>
      <div class="total"><span>NWNP</span><strong>\${hours(totalNwnp)}</strong></div>
    </div>
    \${cards}
    <div class="footer">Generado por DEMAC Corporation · Factor mensual 4.333 · Período 27-26</div>
    <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 250); });<\/script>
  </body></html>\`);
  reportWindow.document.close();
  return true;
}
`);

replaceOnce("'Empleado', 'Cargo', 'Tipo', 'Horas semanales base', `Horas mensuales base (${MONTHLY_HOURS_FACTOR})`, 'Horas regulares reales del período', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas libres pagadas', 'Horas pagables estimadas',", "'Empleado', 'Cargo', 'Tipo', 'Horas semanales base', `Horas mensuales base (${MONTHLY_HOURS_FACTOR})`, 'Horas regulares reales del período', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas pagables estimadas',");
replaceOnce("      hours(summary.noWorkNoPayHours),\n      hours(summary.paidFreeHours),\n      hours(summary.payableHours),", "      hours(summary.noWorkNoPayHours),\n      hours(summary.payableHours),");
replaceOnce(
`  function downloadSummary() {
    const ok = downloadCsv(\`DEMAC_Payroll_Resumen_\${period.startDate}_\${period.endDate}.csv\`, summaryRows());
    setMessage(ok ? 'Resumen de payroll descargado.' : 'La descarga está disponible desde la versión web/PWA.');
  }
`,
`  function downloadSummaryPdf() {
    const ok = printPayrollSummaryPdf(period.label, summaries);
    setMessage(ok ? 'Se abrió el resumen listo para guardar como PDF.' : 'Permite ventanas emergentes para generar el PDF desde la versión web/PWA.');
  }
`);
replaceOnce("          <Button variant=\"success\" label=\"Descargar resumen CSV\" onPress={downloadSummary} />", "          <Button variant=\"success\" label=\"Descargar resumen PDF\" onPress={downloadSummaryPdf} />");
replaceOnce("<SummaryValue label=\"Libre pago\" value={summary.paidFreeHours} />", "");
replaceOnce("<DayFact label=\"Horas libres pagadas\" value={`${hours(previewDay.paidFreeHours)} h`} />", "");
replaceOnce("<Text style={styles.rulesText}>• AO y vacaciones se reportan como ausencias pagadas; No Work No Pay se descuenta de la base mensual.</Text>", "<Text style={styles.rulesText}>• AO y vacaciones se reportan por separado; No Work No Pay se descuenta de la base mensual. Las horas libres del medio día son un beneficio de horario y no se muestran como categoría de payroll.</Text>");

fs.writeFileSync(path, text);
