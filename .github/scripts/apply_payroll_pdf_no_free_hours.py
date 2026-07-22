from pathlib import Path
import re

PATH = Path('src/screens/EmployeesTimesheetScreen.tsx')
text = PATH.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'Expected source block not found:\n{old[:180]}')
    text = text.replace(old, new, 1)


replace_once(
    "import { colors } from '../theme';\n",
    "import { downloadPayrollSummaryPdf } from '../services/payrollSummaryPdf';\nimport { colors } from '../theme';\n",
)

replace_once(
    "'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Día de semana', 'Horas regulares reales', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas libres pagadas', 'Estado', 'Nota',",
    "'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Día de semana', 'Horas regulares reales', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Estado', 'Nota',",
)
replace_once(
    "          hours(day.noWorkNoPayHours),\n          hours(day.paidFreeHours),\n          day.status,",
    "          hours(day.noWorkNoPayHours),\n          day.status,",
)

summary_rows_pattern = re.compile(r"\n  function summaryRows\(\) \{.*?\n  \}\n\n  function downloadDetailed", re.S)
if not summary_rows_pattern.search(text):
    raise SystemExit('summaryRows block not found')
text = summary_rows_pattern.sub("\n  function downloadDetailed", text, count=1)

old_download = """  function downloadSummary() {
    const ok = downloadCsv(`DEMAC_Payroll_Resumen_${period.startDate}_${period.endDate}.csv`, summaryRows());
    setMessage(ok ? 'Resumen de payroll descargado.' : 'La descarga está disponible desde la versión web/PWA.');
  }
"""
new_download = """  function downloadSummary() {
    const ok = downloadPayrollSummaryPdf({ period, summaries });
    setMessage(ok ? 'Resumen de payroll descargado en PDF.' : 'La descarga PDF está disponible desde la versión web/PWA.');
  }
"""
replace_once(old_download, new_download)

replace_once(
    "                <DayFact label=\"Horas libres pagadas\" value={`${hours(previewDay.paidFreeHours)} h`} />\n",
    "",
)
replace_once(
    '<Button variant="success" label="Descargar resumen CSV" onPress={downloadSummary} />',
    '<Button variant="success" label="Descargar resumen PDF" onPress={downloadSummary} />',
)

old_card = """function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {
  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Base semana" value={summary.weeklyRegularHours} /><SummaryValue label="Base mes" value={summary.monthlyBaseHours} /><SummaryValue label="Laboradas" value={summary.actualRegularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="Vacaciones" value={summary.vacationHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Libre pago" value={summary.paidFreeHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;
}
"""
new_card = """function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {
  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Base semana" value={summary.weeklyRegularHours} /><SummaryValue label="Base mes" value={summary.monthlyBaseHours} /><SummaryValue label="Laboradas" value={summary.actualRegularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="Vacaciones" value={summary.vacationHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;
}
"""
replace_once(old_card, new_card)

old_schedule = """      <View style={styles.formGrid}>
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas trabajadas ese día" value={String(draft.halfDayWorkedHours)} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayWorkedHours: Math.max(0, Number(value || 0)) }))} />
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas libres pagadas" value={String(draft.halfDayPaidFreeHours)} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayPaidFreeHours: Math.max(0, Number(value || 0)) }))} />
      </View>
      <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={onCancel} /><Button variant="success" label={busy ? 'Guardando…' : 'Guardar horario'} disabled={busy} onPress={() => void onSave({ ...draft, saturdayHours: draft.weekdayHours, updatedAt: new Date().toISOString() })} /></View>
"""
new_schedule = """      <View style={styles.formGrid}>
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas trabajadas ese día" value={String(draft.halfDayWorkedHours)} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayWorkedHours: Math.max(0, Number(value || 0)) }))} />
      </View>
      <Text style={styles.rulesText}>Beneficio semanal no contabilizado: {hours(Math.max(0, Number(draft.weekdayHours || 0) - Number(draft.halfDayWorkedHours || 0)))} horas libres. Este beneficio no aparece en Timesheet ni en el resumen de payroll.</Text>
      <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={onCancel} /><Button variant="success" label={busy ? 'Guardando…' : 'Guardar horario'} disabled={busy} onPress={() => void onSave({ ...draft, saturdayHours: draft.weekdayHours, halfDayPaidFreeHours: Math.max(0, Number(draft.weekdayHours || 0) - Number(draft.halfDayWorkedHours || 0)), updatedAt: new Date().toISOString() })} /></View>
"""
replace_once(old_schedule, new_schedule)

text = text.replace('AO, No Work No Pay y overtime.', 'AO, vacaciones, No Work No Pay y overtime.')

PATH.write_text(text, encoding='utf-8')
