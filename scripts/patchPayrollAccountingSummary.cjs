const fs = require('fs');

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required accounting summary anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/EmployeesTimesheetScreen.tsx';

insertAfter(
  screen,
  "import { downloadPayrollSummaryPdf } from '../services/payrollPdf';",
  "\nimport { downloadPayrollAccountingPdf } from '../services/payrollAccountingPdf';",
  "downloadPayrollAccountingPdf } from '../services/payrollAccountingPdf'",
);

insertAfter(
  screen,
  `  function downloadSummaryPdf() {
    const ok = downloadPayrollSummaryPdf({
      filename: \`DEMAC_Payroll_Resumen_\${period.startDate}_\${period.endDate}.pdf\`,
      periodLabel: period.label,
      summaries,
    });
    setMessage(ok ? 'Resumen PDF descargado correctamente.' : 'La descarga PDF está disponible desde la versión web/PWA.');
  }`,
  `

  function downloadAccountingSummaryPdf() {
    const ok = downloadPayrollAccountingPdf({
      filename: \`DEMAC_Payroll_Contabilidad_\${period.startDate}_\${period.endDate}.pdf\`,
      periodLabel: period.label,
      summaries,
    });
    setMessage(ok
      ? 'Resumen simplificado para contabilidad descargado correctamente.'
      : 'La descarga para contabilidad está disponible desde la versión web/PWA.');
  }`,
  'function downloadAccountingSummaryPdf()',
);

insertAfter(
  screen,
  '          <Button variant="success" label="Descargar resumen PDF" onPress={downloadSummaryPdf} />',
  `
          <Button variant="secondary" label="Descargar resumen para contabilidad" onPress={downloadAccountingSummaryPdf} />
          <Text style={styles.accountingSummaryHelp}>Formato horizontal compacto: empleado, cargo, fecha de inicio, base semanal en horas, overtime, AO, vacation y no work / no pay.</Text>`,
  'label="Descargar resumen para contabilidad"',
);

insertAfter(
  screen,
  "  payrollSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },",
  "\n  accountingSummaryHelp: { color: colors.muted, fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 2 },",
  'accountingSummaryHelp:',
);

console.log('Payroll accounting summary patch applied.');
