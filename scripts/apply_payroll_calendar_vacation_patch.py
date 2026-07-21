from pathlib import Path

PATH = Path('src/screens/EmployeesTimesheetScreen.tsx')
text = PATH.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise RuntimeError(f'No se encontró bloque esperado: {old[:160]}')
    text = text.replace(old, new, 1)


replace_once(
"""  calculatePayrollDay,
  payrollPeriodDates,
  payrollPeriodForReference,
  shiftPayrollPeriod,
  summarizeEmployee,
  usePayrollModule,
""",
"""  calculatePayrollDay,
  MONTHLY_HOURS_FACTOR,
  payrollPeriodDates,
  payrollPeriodForReference,
  shiftPayrollPeriod,
  summarizeEmployee,
  usePayrollModule,
""",
)

replace_once(
"""const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
];
""",
"""const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
];
const CALENDAR_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
""",
)

replace_once(
"""function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('es-AW', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
""",
"""function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  const formatted = new Date(`${value}T12:00:00Z`).toLocaleDateString('es-AW', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function shiftDateValue(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftCalendarMonth(value: string, months: number) {
  const [year, month] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function calendarMonthLabel(value: string) {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('es-AW', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function calendarDays(value: string) {
  const [year, month] = value.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
""",
)

replace_once(
"""  if (status.startsWith('AO')) return 'warning';
  if (status.startsWith('No Work')) return 'danger';
""",
"""  if (status.startsWith('AO')) return 'warning';
  if (status.startsWith('Vacaciones')) return 'info';
  if (status.startsWith('No Work')) return 'danger';
""",
)

replace_once(
"""  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(period.endDate);
  const [message, setMessage] = useState('');
""",
"""  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [message, setMessage] = useState('');
""",
)

replace_once(
"""  const [aoDraft, setAoDraft] = useState('0');
  const [noWorkDraft, setNoWorkDraft] = useState('0');
""",
"""  const [aoDraft, setAoDraft] = useState('0');
  const [vacationDraft, setVacationDraft] = useState('0');
  const [noWorkDraft, setNoWorkDraft] = useState('0');
""",
)

replace_once(
"""  useEffect(() => {
    if (selectedDate < period.startDate || selectedDate > period.endDate) setSelectedDate(period.endDate);
  }, [period, selectedDate]);

""",
"""""",
)

replace_once(
"""    setAoDraft(String(selectedSavedEntry?.aoHours ?? 0));
    setNoWorkDraft(String(selectedSavedEntry?.noWorkNoPayHours ?? 0));
""",
"""    setAoDraft(String(selectedSavedEntry?.aoHours ?? 0));
    setVacationDraft(String(selectedSavedEntry?.vacationHours ?? 0));
    setNoWorkDraft(String(selectedSavedEntry?.noWorkNoPayHours ?? 0));
""",
)

replace_once(
"""    aoHours: Math.max(0, Number(aoDraft || 0)),
    noWorkNoPayHours: Math.max(0, Number(noWorkDraft || 0)),
""",
"""    aoHours: Math.max(0, Number(aoDraft || 0)),
    vacationHours: Math.max(0, Number(vacationDraft || 0)),
    noWorkNoPayHours: Math.max(0, Number(noWorkDraft || 0)),
""",
)

replace_once(
"""  const totalMetrics = useMemo(() => summaries.reduce((totals, summary) => ({
    regular: totals.regular + summary.regularHours,
    overtime: totals.overtime + summary.overtimeHours,
    ao: totals.ao + summary.aoHours,
    noWork: totals.noWork + summary.noWorkNoPayHours,
    paidFree: totals.paidFree + summary.paidFreeHours,
  }), { regular: 0, overtime: 0, ao: 0, noWork: 0, paidFree: 0 }), [summaries]);
""",
"""  const totalMetrics = useMemo(() => summaries.reduce((totals, summary) => ({
    monthlyBase: totals.monthlyBase + summary.monthlyBaseHours,
    overtime: totals.overtime + summary.overtimeHours,
    ao: totals.ao + summary.aoHours,
    vacation: totals.vacation + summary.vacationHours,
    noWork: totals.noWork + summary.noWorkNoPayHours,
  }), { monthlyBase: 0, overtime: 0, ao: 0, vacation: 0, noWork: 0 }), [summaries]);
""",
)

replace_once(
"""      aoHours: previewDay.aoHours,
      noWorkNoPayHours: previewDay.noWorkNoPayHours,
""",
"""      aoHours: previewDay.aoHours,
      vacationHours: previewDay.vacationHours,
      noWorkNoPayHours: previewDay.noWorkNoPayHours,
""",
)

replace_once(
"""  function changeDate(offset: number) {
    const index = periodDates.indexOf(selectedDate);
    const next = periodDates[Math.max(0, Math.min(periodDates.length - 1, index + offset))];
    if (next) setSelectedDate(next);
  }
""",
"""  function selectDate(date: string) {
    setSelectedDate(date);
    setPeriod(payrollPeriodForReference(new Date(`${date}T12:00:00`)));
    setCalendarMonth(date.slice(0, 7));
  }

  function changeDate(offset: number) {
    selectDate(shiftDateValue(selectedDate, offset));
  }
""",
)

replace_once(
"""      'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Horas regulares', 'Overtime', 'AO', 'No Work No Pay', 'Horas libres pagadas', 'Estado', 'Nota',
""",
"""      'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Día de semana', 'Horas regulares reales', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas libres pagadas', 'Estado', 'Nota',
""",
)

replace_once(
"""          date,
          hours(day.regularHours),
          hours(day.overtimeHours),
          hours(day.aoHours),
          hours(day.noWorkNoPayHours),
""",
"""          date,
          formatDate(date).split(',')[0],
          hours(day.regularHours),
          hours(day.overtimeHours),
          hours(day.aoHours),
          hours(day.vacationHours),
          hours(day.noWorkNoPayHours),
""",
)

replace_once(
"""      'Empleado', 'Cargo', 'Tipo', 'Horas regulares', 'Overtime', 'AO', 'No Work No Pay', 'Horas libres pagadas', 'Horas pagables',
""",
"""      'Empleado', 'Cargo', 'Tipo', 'Horas semanales base', `Horas mensuales base (${MONTHLY_HOURS_FACTOR})`, 'Horas regulares reales del período', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Horas libres pagadas', 'Horas pagables estimadas',
""",
)

replace_once(
"""      hours(summary.regularHours),
      hours(summary.overtimeHours),
      hours(summary.aoHours),
      hours(summary.noWorkNoPayHours),
""",
"""      hours(summary.weeklyRegularHours),
      hours(summary.monthlyBaseHours),
      hours(summary.actualRegularHours),
      hours(summary.overtimeHours),
      hours(summary.aoHours),
      hours(summary.vacationHours),
      hours(summary.noWorkNoPayHours),
""",
)

replace_once(
"""            <Button compact variant="secondary" label="‹" onPress={() => { const next = shiftPayrollPeriod(period, -1); setPeriod(next); setSelectedDate(next.endDate); }} />
""",
"""            <Button compact variant="secondary" label="‹" onPress={() => { const next = shiftPayrollPeriod(period, -1); setPeriod(next); setSelectedDate(next.endDate); setCalendarMonth(next.endDate.slice(0, 7)); }} />
""",
)
replace_once(
"""            <Button compact variant="secondary" label="›" onPress={() => { const next = shiftPayrollPeriod(period, 1); setPeriod(next); setSelectedDate(next.endDate); }} />
""",
"""            <Button compact variant="secondary" label="›" onPress={() => { const next = shiftPayrollPeriod(period, 1); setPeriod(next); setSelectedDate(next.endDate); setCalendarMonth(next.endDate.slice(0, 7)); }} />
""",
)

replace_once(
"""        <Metric label="Horas regulares" value={hours(totalMetrics.regular)} icon="◷" />
        <Metric label="Horas overtime" value={hours(totalMetrics.overtime)} icon="◴" />
        <Metric label="Horas AO" value={hours(totalMetrics.ao)} icon="AO" />
        <Metric label="No Work No Pay" value={hours(totalMetrics.noWork)} icon="▣" warning={totalMetrics.noWork > 0} />
""",
"""        <Metric label={`Base mensual · ${MONTHLY_HOURS_FACTOR}`} value={hours(totalMetrics.monthlyBase)} icon="◷" />
        <Metric label="Horas overtime" value={hours(totalMetrics.overtime)} icon="◴" />
        <Metric label="Horas AO" value={hours(totalMetrics.ao)} icon="AO" />
        <Metric label="Horas vacaciones" value={hours(totalMetrics.vacation)} icon="V" />
        <Metric label="No Work No Pay" value={hours(totalMetrics.noWork)} icon="▣" warning={totalMetrics.noWork > 0} />
""",
)

replace_once(
"""                <View style={styles.selectedDateBox}><Text style={styles.selectedDate}>{formatDate(selectedDate)}</Text></View>
""",
"""                <Pressable style={styles.selectedDateBox} onPress={() => { setCalendarMonth(selectedDate.slice(0, 7)); setCalendarVisible(true); }}>
                  <Text style={styles.selectedDate}>{formatDate(selectedDate)}</Text>
                  <Text style={styles.selectedDateHint}>Abrir calendario</Text>
                </Pressable>
""",
)

replace_once(
"""                <Input style={styles.field} keyboardType="decimal-pad" label="Horas AO" value={aoDraft} onChangeText={setAoDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas No Work No Pay" value={noWorkDraft} onChangeText={setNoWorkDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Overtime" value={overtimeDraft} onChangeText={setOvertimeDraft} />
""",
"""                <Input style={styles.field} keyboardType="decimal-pad" label="Horas AO" value={aoDraft} onChangeText={setAoDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas de vacaciones" value={vacationDraft} onChangeText={setVacationDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas No Work No Pay" value={noWorkDraft} onChangeText={setNoWorkDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Overtime" value={overtimeDraft} onChangeText={setOvertimeDraft} />
""",
)

replace_once(
"""              <Input multiline label="Nota del día" value={notesDraft} onChangeText={setNotesDraft} placeholder="Motivo de AO, permiso, salida temprana, overtime..." />
""",
"""              <Input multiline label="Nota del día" value={notesDraft} onChangeText={setNotesDraft} placeholder="Motivo de AO, vacaciones, permiso, salida temprana, overtime..." />
""",
)

replace_once(
"""                    <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dayRow, date === selectedDate && styles.dayRowSelected]}>
""",
"""                    <Pressable key={date} onPress={() => selectDate(date)} style={[styles.dayRow, date === selectedDate && styles.dayRowSelected]}>
""",
)

replace_once(
"""                      {day.aoHours ? <Text style={styles.aoText}>{hours(day.aoHours)} AO</Text> : null}
                      {day.noWorkNoPayHours ? <Text style={styles.noWorkText}>{hours(day.noWorkNoPayHours)} NWNP</Text> : null}
""",
"""                      {day.aoHours ? <Text style={styles.aoText}>{hours(day.aoHours)} AO</Text> : null}
                      {day.vacationHours ? <Text style={styles.vacationText}>{hours(day.vacationHours)} Vac.</Text> : null}
                      {day.noWorkNoPayHours ? <Text style={styles.noWorkText}>{hours(day.noWorkNoPayHours)} NWNP</Text> : null}
""",
)

replace_once(
"""        <Text style={styles.rulesText}>• Las horas regulares se calculan como jornada programada menos AO y No Work No Pay.</Text>
""",
"""        <Text style={styles.rulesText}>• La base mensual se calcula como horas regulares semanales × {MONTHLY_HOURS_FACTOR} y se redondea a horas completas.</Text>
        <Text style={styles.rulesText}>• AO y vacaciones se reportan como ausencias pagadas; No Work No Pay se descuenta de la base mensual.</Text>
""",
)

replace_once(
"""      <AppModal visible={summaryVisible} title={`Resumen payroll · ${period.label}`} onClose={() => setSummaryVisible(false)}>
""",
"""      <AppModal visible={calendarVisible} title="Seleccionar fecha" onClose={() => setCalendarVisible(false)}>
        <CalendarPicker
          month={calendarMonth}
          selectedDate={selectedDate}
          today={dateKey(new Date())}
          onPreviousMonth={() => setCalendarMonth((current) => shiftCalendarMonth(current, -1))}
          onNextMonth={() => setCalendarMonth((current) => shiftCalendarMonth(current, 1))}
          onSelect={(date) => { selectDate(date); setCalendarVisible(false); }}
        />
      </AppModal>

      <AppModal visible={summaryVisible} title={`Resumen payroll · ${period.label}`} onClose={() => setSummaryVisible(false)}>
""",
)

replace_once(
"""      <SummaryValue label="Regular" value={summary.regularHours} />
      <SummaryValue label="OT" value={summary.overtimeHours} />
      <SummaryValue label="AO" value={summary.aoHours} warning={summary.aoHours > 0} />
      <SummaryValue label="NWNP" value={summary.noWorkNoPayHours} danger={summary.noWorkNoPayHours > 0} />
""",
"""      <SummaryValue label="Base mes" value={summary.monthlyBaseHours} />
      <SummaryValue label="OT" value={summary.overtimeHours} />
      <SummaryValue label="AO" value={summary.aoHours} warning={summary.aoHours > 0} />
      <SummaryValue label="Vac." value={summary.vacationHours} />
      <SummaryValue label="NWNP" value={summary.noWorkNoPayHours} danger={summary.noWorkNoPayHours > 0} />
""",
)

replace_once(
"""function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {
  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Regular" value={summary.regularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Libre pago" value={summary.paidFreeHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;
}

""",
"""function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {
  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Base semana" value={summary.weeklyRegularHours} /><SummaryValue label="Base mes" value={summary.monthlyBaseHours} /><SummaryValue label="Laboradas" value={summary.actualRegularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="Vacaciones" value={summary.vacationHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Libre pago" value={summary.paidFreeHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;
}

function CalendarPicker({ month, selectedDate, today, onPreviousMonth, onNextMonth, onSelect }: { month: string; selectedDate: string; today: string; onPreviousMonth: () => void; onNextMonth: () => void; onSelect: (date: string) => void }) {
  const days = calendarDays(month);
  return (
    <View style={styles.calendarCard}>
      <View style={styles.calendarHeader}>
        <Button compact variant="secondary" label="‹" onPress={onPreviousMonth} />
        <Text style={styles.calendarMonth}>{calendarMonthLabel(month)}</Text>
        <Button compact variant="secondary" label="›" onPress={onNextMonth} />
      </View>
      <View style={styles.calendarGrid}>
        {CALENDAR_WEEKDAYS.map((weekday) => <View key={weekday} style={styles.calendarCell}><Text style={styles.calendarWeekday}>{weekday}</Text></View>)}
        {days.map((date, index) => date ? (
          <Pressable key={date} onPress={() => onSelect(date)} style={[styles.calendarCell, styles.calendarDay, date === today && styles.calendarToday, date === selectedDate && styles.calendarSelected]}>
            <Text style={[styles.calendarDayText, date === selectedDate && styles.calendarSelectedText]}>{Number(date.slice(-2))}</Text>
          </Pressable>
        ) : <View key={`blank-${index}`} style={styles.calendarCell} />)}
      </View>
      <Text style={styles.calendarHelp}>Las semanas comienzan en domingo. Selecciona cualquier fecha para abrir automáticamente su período de nómina.</Text>
    </View>
  );
}

""",
)

replace_once(
"""  selectedDate: { color: colors.text, fontWeight: '900', fontSize: 12 },
""",
"""  selectedDate: { color: colors.text, fontWeight: '900', fontSize: 12, textAlign: 'center' },
  selectedDateHint: { color: colors.info, fontWeight: '800', fontSize: 8, marginTop: 2 },
""",
)

replace_once(
"""  aoText: { color: colors.warning, fontWeight: '900', fontSize: 9 },
  noWorkText: { color: colors.danger, fontWeight: '900', fontSize: 9 },
""",
"""  aoText: { color: colors.warning, fontWeight: '900', fontSize: 9 },
  vacationText: { color: colors.info, fontWeight: '900', fontSize: 9 },
  noWorkText: { color: colors.danger, fontWeight: '900', fontSize: 9 },
""",
)

replace_once(
"""  payrollSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
""",
"""  payrollSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  calendarCard: { gap: 12, minWidth: 280 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  calendarMonth: { flex: 1, color: colors.text, fontWeight: '900', fontSize: 15, textAlign: 'center', textTransform: 'capitalize' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
  calendarCell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calendarWeekday: { color: colors.muted, fontWeight: '900', fontSize: 9 },
  calendarDay: { borderRadius: 999 },
  calendarDayText: { color: colors.text, fontWeight: '800', fontSize: 12 },
  calendarToday: { borderWidth: 1, borderColor: colors.success },
  calendarSelected: { backgroundColor: colors.success },
  calendarSelectedText: { color: '#FFFFFF' },
  calendarHelp: { color: colors.muted, fontSize: 9, lineHeight: 14, textAlign: 'center' },
});
""",
)

PATH.write_text(text, encoding='utf-8')
