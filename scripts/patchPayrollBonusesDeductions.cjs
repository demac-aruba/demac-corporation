const fs = require('fs');

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required payroll adjustment anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required payroll adjustment block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/EmployeesTimesheetScreen.tsx';

insertAfter(
  screen,
  "import { downloadPayrollAccountingPdf } from '../services/payrollAccountingPdf';",
  "\nimport { PayrollAdjustmentsPanel } from '../components/PayrollAdjustmentsPanel';\nimport { usePayrollAdjustments } from '../hooks/usePayrollAdjustments';",
  "PayrollAdjustmentsPanel } from '../components/PayrollAdjustmentsPanel'",
);

insertAfter(
  screen,
  '  const module = usePayrollModule(currentUser, staffProfiles);',
  '\n  const payrollAdjustments = usePayrollAdjustments(currentUser);',
  'const payrollAdjustments = usePayrollAdjustments(currentUser);',
);

replaceOnce(
  screen,
  `  function downloadAccountingSummaryPdf() {
    const ok = downloadPayrollAccountingPdf({
      filename: \`DEMAC_Payroll_Contabilidad_\${period.startDate}_\${period.endDate}.pdf\`,
      periodLabel: period.label,
      summaries,
    });
    setMessage(ok
      ? 'Resumen simplificado para contabilidad descargado correctamente.'
      : 'La descarga para contabilidad está disponible desde la versión web/PWA.');
  }`,
  `  function downloadAccountingSummaryPdf() {
    const ok = downloadPayrollAccountingPdf({
      filename: \`DEMAC_Payroll_Contabilidad_\${period.startDate}_\${period.endDate}.pdf\`,
      periodLabel: period.label,
      summaries,
      adjustments: payrollAdjustments.adjustments.filter((adjustment) => adjustment.payrollPeriodId === period.id),
    });
    setMessage(ok
      ? 'Resumen simplificado para contabilidad descargado correctamente.'
      : 'La descarga para contabilidad está disponible desde la versión web/PWA.');
  }`,
  'adjustments: payrollAdjustments.adjustments.filter',
);

replaceOnce(
  screen,
  `      </View>

      <View style={[styles.mainLayout, compact && styles.mainLayoutCompact]}>`,
  `      </View>

      <PayrollAdjustmentsPanel
        employees={activeEmployees}
        period={period}
        adjustments={payrollAdjustments.adjustments}
        loading={payrollAdjustments.loading}
        busy={payrollAdjustments.busy}
        error={payrollAdjustments.error}
        onSave={payrollAdjustments.saveAdjustment}
        onVoid={payrollAdjustments.voidAdjustment}
      />

      <View style={[styles.mainLayout, compact && styles.mainLayoutCompact]}>`,
  '<PayrollAdjustmentsPanel',
);

replaceOnce(
  screen,
  'Formato horizontal compacto: empleado, cargo, fecha de inicio, base semanal en horas, overtime, AO, vacation y no work / no pay.',
  'Formato horizontal compacto: bonos y deducciones en florines; base semanal, overtime, AO, vacation y no work / no pay en horas.',
  'bonos y deducciones en florines',
);

console.log('Payroll bonuses and deductions patch applied.');
