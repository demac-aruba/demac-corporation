import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';
import {
  calculatePayrollDay,
  payrollPeriodDates,
  payrollPeriodForReference,
  shiftPayrollPeriod,
  summarizeEmployee,
  usePayrollModule,
} from '../hooks/usePayrollModule';
import { EmployeeTimesheetEntry, PayrollDayStatus, PayrollEmployee, PayrollEmployeeSummary, PayrollEmployeeType } from '../payroll/types';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { colors } from '../theme';

const EMPLOYEE_TYPES: Array<PayrollEmployeeType | 'Todos'> = ['Todos', 'Técnico', 'Secretaria', 'Administración', 'Otro'];
const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
];

function hours(value: number) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('es-AW', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function statusTone(status: PayrollDayStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'Regular') return 'success';
  if (status.startsWith('AO')) return 'warning';
  if (status.startsWith('No Work')) return 'danger';
  if (status === 'Día libre programado') return 'info';
  return 'neutral';
}

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\n')}`;
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

export function EmployeesTimesheetScreen() {
  const { currentUser } = useAppState();
  const { staffProfiles } = useTeamState();
  const module = usePayrollModule(currentUser, staffProfiles);
  const { width } = useWindowDimensions();
  const compact = width < 980;

  const [period, setPeriod] = useState(() => payrollPeriodForReference(new Date()));
  const [employeeType, setEmployeeType] = useState<PayrollEmployeeType | 'Todos'>('Todos');
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(period.endDate);
  const [message, setMessage] = useState('');
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [scheduleEmployee, setScheduleEmployee] = useState<PayrollEmployee | null>(null);
  const [newEmployeeVisible, setNewEmployeeVisible] = useState(false);

  const [aoDraft, setAoDraft] = useState('0');
  const [noWorkDraft, setNoWorkDraft] = useState('0');
  const [overtimeDraft, setOvertimeDraft] = useState('0');
  const [notesDraft, setNotesDraft] = useState('');

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newType, setNewType] = useState<PayrollEmployeeType>('Técnico');

  const activeEmployees = useMemo(() => module.employees.filter((employee) => employee.active), [module.employees]);
  const periodEntries = useMemo(
    () => module.entries.filter((entry) => entry.date >= period.startDate && entry.date <= period.endDate),
    [module.entries, period.endDate, period.startDate],
  );
  const summaries = useMemo(
    () => activeEmployees.map((employee) => summarizeEmployee(employee, period, periodEntries)),
    [activeEmployees, period, periodEntries],
  );
  const filteredSummaries = useMemo(() => summaries.filter((summary) => {
    const typeMatches = employeeType === 'Todos' || summary.employee.employeeType === employeeType;
    const term = search.trim().toLowerCase();
    const searchMatches = !term || summary.employee.name.toLowerCase().includes(term) || summary.employee.role.toLowerCase().includes(term);
    return typeMatches && searchMatches;
  }), [employeeType, search, summaries]);

  useEffect(() => {
    if (!selectedEmployeeId && activeEmployees[0]) setSelectedEmployeeId(activeEmployees[0].id);
    if (selectedEmployeeId && !activeEmployees.some((employee) => employee.id === selectedEmployeeId)) setSelectedEmployeeId(activeEmployees[0]?.id ?? '');
  }, [activeEmployees, selectedEmployeeId]);

  useEffect(() => {
    if (selectedDate < period.startDate || selectedDate > period.endDate) setSelectedDate(period.endDate);
  }, [period, selectedDate]);

  const selectedEmployee = activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedSummary = summaries.find((summary) => summary.employee.id === selectedEmployeeId) ?? null;
  const periodDates = useMemo(() => payrollPeriodDates(period), [period]);
  const selectedSavedEntry = selectedEmployee ? module.entryByEmployeeDate.get(`${selectedEmployee.id}_${selectedDate}`) : undefined;
  const selectedDay = selectedEmployee ? calculatePayrollDay(selectedEmployee, selectedDate, selectedSavedEntry) : null;

  useEffect(() => {
    setAoDraft(String(selectedSavedEntry?.aoHours ?? 0));
    setNoWorkDraft(String(selectedSavedEntry?.noWorkNoPayHours ?? 0));
    setOvertimeDraft(String(selectedSavedEntry?.overtimeHours ?? 0));
    setNotesDraft(selectedSavedEntry?.notes ?? '');
  }, [selectedEmployeeId, selectedDate, selectedSavedEntry?.id, selectedSavedEntry?.updatedAt]);

  const previewDay = selectedEmployee ? calculatePayrollDay(selectedEmployee, selectedDate, {
    id: 'preview',
    payrollPeriodId: period.id,
    employeeId: selectedEmployee.id,
    employeeName: selectedEmployee.name,
    date: selectedDate,
    scheduledWorkHours: selectedDay?.scheduledWorkHours ?? 0,
    paidFreeHours: selectedDay?.paidFreeHours ?? 0,
    regularHours: 0,
    overtimeHours: Math.max(0, Number(overtimeDraft || 0)),
    aoHours: Math.max(0, Number(aoDraft || 0)),
    noWorkNoPayHours: Math.max(0, Number(noWorkDraft || 0)),
    status: 'Regular',
    notes: notesDraft,
    updatedAt: new Date().toISOString(),
  }) : null;

  const totalMetrics = useMemo(() => summaries.reduce((totals, summary) => ({
    regular: totals.regular + summary.regularHours,
    overtime: totals.overtime + summary.overtimeHours,
    ao: totals.ao + summary.aoHours,
    noWork: totals.noWork + summary.noWorkNoPayHours,
    paidFree: totals.paidFree + summary.paidFreeHours,
  }), { regular: 0, overtime: 0, ao: 0, noWork: 0, paidFree: 0 }), [summaries]);

  async function saveDay() {
    if (!selectedEmployee || !previewDay) return;
    const now = new Date().toISOString();
    const entry: EmployeeTimesheetEntry = {
      id: `${selectedEmployee.id}_${selectedDate}`,
      payrollPeriodId: period.id,
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      date: selectedDate,
      scheduledWorkHours: previewDay.scheduledWorkHours,
      paidFreeHours: previewDay.paidFreeHours,
      regularHours: previewDay.regularHours,
      overtimeHours: previewDay.overtimeHours,
      aoHours: previewDay.aoHours,
      noWorkNoPayHours: previewDay.noWorkNoPayHours,
      status: previewDay.status,
      notes: notesDraft.trim(),
      createdAt: selectedSavedEntry?.createdAt ?? now,
      updatedAt: now,
      updatedByUserId: currentUser?.id,
      updatedByName: currentUser?.name,
    };
    const result = await module.saveEntry(entry);
    setMessage(result.ok ? `${selectedEmployee.name}: ${formatDate(selectedDate)} guardado correctamente.` : result.message ?? 'No se pudo guardar el día.');
  }

  function changeDate(offset: number) {
    const index = periodDates.indexOf(selectedDate);
    const next = periodDates[Math.max(0, Math.min(periodDates.length - 1, index + offset))];
    if (next) setSelectedDate(next);
  }

  function detailedRows() {
    const rows: Array<Array<string | number>> = [[
      'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Horas regulares', 'Overtime', 'AO', 'No Work No Pay', 'Horas libres pagadas', 'Estado', 'Nota',
    ]];
    for (const employee of activeEmployees) {
      for (const date of periodDates) {
        const entry = module.entryByEmployeeDate.get(`${employee.id}_${date}`);
        const day = calculatePayrollDay(employee, date, entry);
        rows.push([
          employee.name,
          employee.role,
          employee.employeeType,
          date,
          hours(day.regularHours),
          hours(day.overtimeHours),
          hours(day.aoHours),
          hours(day.noWorkNoPayHours),
          hours(day.paidFreeHours),
          day.status,
          day.notes,
        ]);
      }
    }
    return rows;
  }

  function summaryRows() {
    return [[
      'Empleado', 'Cargo', 'Tipo', 'Horas regulares', 'Overtime', 'AO', 'No Work No Pay', 'Horas libres pagadas', 'Horas pagables',
    ], ...summaries.map((summary) => [
      summary.employee.name,
      summary.employee.role,
      summary.employee.employeeType,
      hours(summary.regularHours),
      hours(summary.overtimeHours),
      hours(summary.aoHours),
      hours(summary.noWorkNoPayHours),
      hours(summary.paidFreeHours),
      hours(summary.payableHours),
    ])];
  }

  function downloadDetailed() {
    const ok = downloadCsv(`DEMAC_Timesheet_${period.startDate}_${period.endDate}.csv`, detailedRows());
    setMessage(ok ? 'Reporte detallado descargado.' : 'La descarga está disponible desde la versión web/PWA.');
  }

  function downloadSummary() {
    const ok = downloadCsv(`DEMAC_Payroll_Resumen_${period.startDate}_${period.endDate}.csv`, summaryRows());
    setMessage(ok ? 'Resumen de payroll descargado.' : 'La descarga está disponible desde la versión web/PWA.');
  }

  async function addEmployee() {
    if (!newName.trim()) {
      setMessage('Escribe el nombre del empleado.');
      return;
    }
    const now = new Date().toISOString();
    const technical = newType === 'Técnico';
    const secretarial = newType === 'Secretaria';
    const employee: PayrollEmployee = {
      id: `payroll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: newName.trim(),
      role: newRole.trim() || newType,
      employeeType: newType,
      active: true,
      weekdayHours: 8,
      saturdayHours: technical ? 4 : 0,
      halfDayEffectiveFrom: technical ? '2026-08-01' : secretarial ? '2026-01-01' : undefined,
      halfDayWorkedHours: technical ? 5 : secretarial ? 4 : 8,
      halfDayPaidFreeHours: technical ? 3 : secretarial ? 4 : 0,
      createdAt: now,
      updatedAt: now,
      createdByUserId: currentUser?.id,
      createdByName: currentUser?.name,
    };
    const result = await module.saveEmployee(employee);
    if (result.ok) {
      setSelectedEmployeeId(employee.id);
      setNewName('');
      setNewRole('');
      setNewEmployeeVisible(false);
      setMessage(`${employee.name} agregado al módulo de empleados.`);
    } else {
      setMessage(result.message ?? 'No se pudo agregar el empleado.');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle
        title="Empleados"
        subtitle="Timesheet, asistencia y preparación de nómina"
        action={<View style={styles.headerActions}>
          <Button compact variant="secondary" label="Agregar empleado" onPress={() => setNewEmployeeVisible(true)} />
          <Button compact variant="secondary" label="Generar resumen payroll" onPress={() => setSummaryVisible(true)} />
          <Button compact variant="success" label="Descargar reporte" onPress={downloadDetailed} />
        </View>}
      />

      {module.error ? <View style={styles.errorBox}><Text style={styles.errorText}>{module.error}</Text></View> : null}
      {message ? <View style={styles.messageBox}><Text style={styles.messageText}>{message}</Text></View> : null}

      <Card style={styles.filtersCard}>
        <View style={styles.periodBlock}>
          <Text style={styles.filterLabel}>PERÍODO DE NÓMINA</Text>
          <View style={styles.periodControls}>
            <Button compact variant="secondary" label="‹" onPress={() => { const next = shiftPayrollPeriod(period, -1); setPeriod(next); setSelectedDate(next.endDate); }} />
            <View style={styles.periodLabelBox}><Text style={styles.periodLabel}>{period.label}</Text></View>
            <Button compact variant="secondary" label="›" onPress={() => { const next = shiftPayrollPeriod(period, 1); setPeriod(next); setSelectedDate(next.endDate); }} />
          </View>
        </View>
        <View style={styles.cutoffBadge}><Text style={styles.cutoffText}>▣ Cierre de nómina: todos los 26</Text></View>
        <View style={styles.filterTypeBlock}>
          <Text style={styles.filterLabel}>TIPO DE EMPLEADO</Text>
          <View style={styles.optionRow}>
            {EMPLOYEE_TYPES.map((type) => <Button key={type} compact variant={employeeType === type ? 'primary' : 'secondary'} label={type} onPress={() => setEmployeeType(type)} />)}
          </View>
        </View>
        <Input style={styles.searchField} label="Buscar empleado" value={search} onChangeText={setSearch} placeholder="Nombre o cargo..." />
      </Card>

      <View style={styles.metrics}>
        <Metric label="Empleados activos" value={String(activeEmployees.length)} icon="♙" />
        <Metric label="Horas regulares" value={hours(totalMetrics.regular)} icon="◷" />
        <Metric label="Horas overtime" value={hours(totalMetrics.overtime)} icon="◴" />
        <Metric label="Horas AO" value={hours(totalMetrics.ao)} icon="AO" />
        <Metric label="No Work No Pay" value={hours(totalMetrics.noWork)} icon="▣" warning={totalMetrics.noWork > 0} />
      </View>

      <View style={[styles.mainLayout, compact && styles.mainLayoutCompact]}>
        <Card style={styles.employeePanel}>
          <SectionTitle title="Resumen de empleados" subtitle={`${filteredSummaries.length} empleados en el período seleccionado`} />
          {filteredSummaries.length ? filteredSummaries.map((summary) => (
            <EmployeeSummaryRow
              key={summary.employee.id}
              summary={summary}
              selected={summary.employee.id === selectedEmployeeId}
              onPress={() => setSelectedEmployeeId(summary.employee.id)}
            />
          )) : <EmptyState icon="♙" title="Sin empleados" message="No hay empleados que coincidan con el filtro." />}
        </Card>

        <View style={styles.detailColumn}>
          {selectedEmployee && previewDay ? (
            <Card>
              <SectionTitle
                title={`Detalle diario — ${selectedEmployee.name}`}
                subtitle={`${selectedEmployee.role} · ${selectedEmployee.employeeType}`}
                action={<Button compact variant="secondary" label="Configurar horario" onPress={() => setScheduleEmployee(selectedEmployee)} />}
              />
              <View style={styles.dateNavigation}>
                <Button compact variant="secondary" label="‹ Día" onPress={() => changeDate(-1)} />
                <View style={styles.selectedDateBox}><Text style={styles.selectedDate}>{formatDate(selectedDate)}</Text></View>
                <Button compact variant="secondary" label="Día ›" onPress={() => changeDate(1)} />
              </View>
              <View style={styles.dayFacts}>
                <DayFact label="Jornada programada" value={`${hours(previewDay.scheduledWorkHours)} h`} />
                <DayFact label="Horas regulares" value={`${hours(previewDay.regularHours)} h`} />
                <DayFact label="Horas libres pagadas" value={`${hours(previewDay.paidFreeHours)} h`} />
                <DayFact label="Estado" value={previewDay.status} />
              </View>
              <View style={styles.formGrid}>
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas AO" value={aoDraft} onChangeText={setAoDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas No Work No Pay" value={noWorkDraft} onChangeText={setNoWorkDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Overtime" value={overtimeDraft} onChangeText={setOvertimeDraft} />
              </View>
              <Input multiline label="Nota del día" value={notesDraft} onChangeText={setNotesDraft} placeholder="Motivo de AO, permiso, salida temprana, overtime..." />
              <View style={styles.saveRow}>
                <Pill label={previewDay.status} tone={statusTone(previewDay.status)} />
                <Button variant="success" label={module.busy ? 'Guardando…' : 'Guardar día'} disabled={module.busy} onPress={() => void saveDay()} />
              </View>
            </Card>
          ) : <Card><EmptyState icon="♙" title="Selecciona un empleado" message="Abre un empleado para registrar AO, No Work No Pay y overtime." /></Card>}

          {selectedEmployee ? (
            <Card>
              <SectionTitle title={`Días del período — ${selectedEmployee.name}`} subtitle="Los días sin cambios utilizan automáticamente el horario configurado." />
              <View style={styles.dayList}>
                {periodDates.map((date) => {
                  const entry = module.entryByEmployeeDate.get(`${selectedEmployee.id}_${date}`);
                  const day = calculatePayrollDay(selectedEmployee, date, entry);
                  return (
                    <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dayRow, date === selectedDate && styles.dayRowSelected]}>
                      <View style={styles.dayRowDate}><Text style={styles.dayRowDateText}>{formatDate(date)}</Text>{entry ? <Text style={styles.savedText}>Editado</Text> : null}</View>
                      <Text style={styles.dayRowHours}>{hours(day.regularHours)}h regular</Text>
                      {day.overtimeHours ? <Text style={styles.overtimeText}>+{hours(day.overtimeHours)} OT</Text> : null}
                      {day.aoHours ? <Text style={styles.aoText}>{hours(day.aoHours)} AO</Text> : null}
                      {day.noWorkNoPayHours ? <Text style={styles.noWorkText}>{hours(day.noWorkNoPayHours)} NWNP</Text> : null}
                      <Pill label={day.status} tone={statusTone(day.status)} />
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          ) : null}
        </View>
      </View>

      <Card style={styles.rulesCard}>
        <Text style={styles.rulesTitle}>ⓘ Reglas de cálculo</Text>
        <Text style={styles.rulesText}>• La nómina corre automáticamente del día 27 al día 26.</Text>
        <Text style={styles.rulesText}>• Las horas regulares se calculan como jornada programada menos AO y No Work No Pay.</Text>
        <Text style={styles.rulesText}>• Para julio, los técnicos permanecen con su horario completo. La regla de 5 horas trabajadas + 3 horas libres puede activarse desde el 1 de agosto.</Text>
        <Text style={styles.rulesText}>• Las secretarias pueden configurarse con 4 horas trabajadas + 4 horas libres en su medio día semanal.</Text>
      </Card>

      <AppModal visible={summaryVisible} title={`Resumen payroll · ${period.label}`} onClose={() => setSummaryVisible(false)}>
        <ScrollView contentContainerStyle={styles.modalContent}>
          {summaries.map((summary) => <PayrollSummaryCard key={summary.employee.id} summary={summary} />)}
          <Button variant="success" label="Descargar resumen CSV" onPress={downloadSummary} />
        </ScrollView>
      </AppModal>

      <AppModal visible={Boolean(scheduleEmployee)} title="Configurar horario del empleado" onClose={() => setScheduleEmployee(null)}>
        {scheduleEmployee ? (
          <ScheduleEditor
            employee={scheduleEmployee}
            busy={module.busy}
            onCancel={() => setScheduleEmployee(null)}
            onSave={async (updated) => {
              const result = await module.saveEmployee(updated);
              if (result.ok) {
                setScheduleEmployee(null);
                setMessage(`Horario de ${updated.name} actualizado.`);
              } else setMessage(result.message ?? 'No se pudo guardar el horario.');
            }}
          />
        ) : null}
      </AppModal>

      <AppModal visible={newEmployeeVisible} title="Agregar empleado al timesheet" onClose={() => setNewEmployeeVisible(false)}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Input label="Nombre completo" value={newName} onChangeText={setNewName} />
          <Input label="Cargo" value={newRole} onChangeText={setNewRole} placeholder="Ej. Técnico, Secretaria, Supervisor..." />
          <Text style={styles.filterLabel}>TIPO DE EMPLEADO</Text>
          <View style={styles.optionRow}>
            {EMPLOYEE_TYPES.filter((type): type is PayrollEmployeeType => type !== 'Todos').map((type) => <Button key={type} compact variant={newType === type ? 'primary' : 'secondary'} label={type} onPress={() => setNewType(type)} />)}
          </View>
          <Button variant="success" label={module.busy ? 'Guardando…' : 'Agregar empleado'} disabled={module.busy} onPress={() => void addEmployee()} />
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function Metric({ label, value, icon, warning }: { label: string; value: string; icon: string; warning?: boolean }) {
  return <Card style={styles.metric}><View style={[styles.metricIcon, warning && styles.metricIconWarning]}><Text style={styles.metricIconText}>{icon}</Text></View><View><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, warning && styles.warningValue]}>{value}</Text></View></Card>;
}

function EmployeeSummaryRow({ summary, selected, onPress }: { summary: PayrollEmployeeSummary; selected: boolean; onPress: () => void }) {
  const initials = summary.employee.name.split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Pressable onPress={onPress} style={[styles.employeeRow, selected && styles.employeeRowSelected]}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
      <View style={styles.employeeIdentity}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role} · {summary.employee.employeeType}</Text></View>
      <SummaryValue label="Regular" value={summary.regularHours} />
      <SummaryValue label="OT" value={summary.overtimeHours} />
      <SummaryValue label="AO" value={summary.aoHours} warning={summary.aoHours > 0} />
      <SummaryValue label="NWNP" value={summary.noWorkNoPayHours} danger={summary.noWorkNoPayHours > 0} />
      <Pill label={summary.changedDays ? 'En progreso' : 'Sin cambios'} tone={summary.changedDays ? 'info' : 'neutral'} />
      <Text style={styles.openDetail}>Ver detalle ›</Text>
    </Pressable>
  );
}

function SummaryValue({ label, value, warning, danger }: { label: string; value: number; warning?: boolean; danger?: boolean }) {
  return <View style={styles.summaryValue}><Text style={styles.summaryLabel}>{label}</Text><Text style={[styles.summaryNumber, warning && styles.aoText, danger && styles.noWorkText]}>{hours(value)}</Text></View>;
}

function DayFact({ label, value }: { label: string; value: string }) {
  return <View style={styles.dayFact}><Text style={styles.dayFactLabel}>{label}</Text><Text style={styles.dayFactValue}>{value}</Text></View>;
}

function PayrollSummaryCard({ summary }: { summary: PayrollEmployeeSummary }) {
  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Regular" value={summary.regularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Libre pago" value={summary.paidFreeHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;
}

function ScheduleEditor({ employee, busy, onSave, onCancel }: { employee: PayrollEmployee; busy: boolean; onSave: (employee: PayrollEmployee) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(employee);
  useEffect(() => setDraft(employee), [employee]);
  return (
    <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.employeeName}>{draft.name}</Text>
      <Text style={styles.filterLabel}>TIPO DE EMPLEADO</Text>
      <View style={styles.optionRow}>
        {EMPLOYEE_TYPES.filter((type): type is PayrollEmployeeType => type !== 'Todos').map((type) => <Button key={type} compact variant={draft.employeeType === type ? 'primary' : 'secondary'} label={type} onPress={() => setDraft((current) => ({ ...current, employeeType: type }))} />)}
      </View>
      <View style={styles.formGrid}>
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas lunes a viernes" value={String(draft.weekdayHours)} onChangeText={(value) => setDraft((current) => ({ ...current, weekdayHours: Math.max(0, Number(value || 0)) }))} />
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas sábado" value={String(draft.saturdayHours)} onChangeText={(value) => setDraft((current) => ({ ...current, saturdayHours: Math.max(0, Number(value || 0)) }))} />
      </View>
      <Text style={styles.filterLabel}>MEDIO DÍA SEMANAL</Text>
      <View style={styles.optionRow}>
        <Button compact variant={draft.weeklyHalfDayWeekday === undefined ? 'primary' : 'secondary'} label="Sin medio día" onPress={() => setDraft((current) => ({ ...current, weeklyHalfDayWeekday: undefined }))} />
        {WEEKDAYS.map((day) => <Button key={day.value} compact variant={draft.weeklyHalfDayWeekday === day.value ? 'primary' : 'secondary'} label={day.label} onPress={() => setDraft((current) => ({ ...current, weeklyHalfDayWeekday: day.value }))} />)}
      </View>
      <Input label="Fecha de inicio del medio día (AAAA-MM-DD)" value={draft.halfDayEffectiveFrom ?? ''} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayEffectiveFrom: value || undefined }))} placeholder="2026-08-01" />
      <View style={styles.formGrid}>
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas trabajadas ese día" value={String(draft.halfDayWorkedHours)} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayWorkedHours: Math.max(0, Number(value || 0)) }))} />
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas libres pagadas" value={String(draft.halfDayPaidFreeHours)} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayPaidFreeHours: Math.max(0, Number(value || 0)) }))} />
      </View>
      <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={onCancel} /><Button variant="success" label={busy ? 'Guardando…' : 'Guardar horario'} disabled={busy} onPress={() => void onSave({ ...draft, updatedAt: new Date().toISOString() })} /></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16, paddingBottom: 100, backgroundColor: colors.background },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  messageBox: { backgroundColor: colors.successLight, borderRadius: 8, padding: 11 },
  messageText: { color: colors.success, fontWeight: '800', fontSize: 11 },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 11 },
  errorText: { color: colors.danger, fontWeight: '800', fontSize: 11 },
  filtersCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 },
  periodBlock: { minWidth: 300, flex: 1, gap: 6 },
  filterLabel: { color: colors.muted, fontWeight: '900', fontSize: 9, letterSpacing: 0.5 },
  periodControls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  periodLabelBox: { minHeight: 40, flex: 1, minWidth: 210, borderWidth: 1, borderColor: colors.border, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#FFFFFF' },
  periodLabel: { color: colors.text, fontWeight: '900', fontSize: 11, textAlign: 'center' },
  cutoffBadge: { backgroundColor: colors.successLight, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14 },
  cutoffText: { color: colors.success, fontWeight: '900', fontSize: 11 },
  filterTypeBlock: { flex: 2, minWidth: 300, gap: 6 },
  searchField: { minWidth: 220, flex: 1, marginBottom: 0 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  metric: { flex: 1, minWidth: 185, flexDirection: 'row', alignItems: 'center', gap: 12 },
  metricIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successLight },
  metricIconWarning: { backgroundColor: colors.warningLight },
  metricIconText: { color: colors.success, fontWeight: '900', fontSize: 16 },
  metricLabel: { color: colors.muted, fontSize: 10 },
  metricValue: { color: colors.text, fontWeight: '900', fontSize: 19, marginTop: 3 },
  warningValue: { color: colors.warning },
  mainLayout: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  mainLayoutCompact: { flexDirection: 'column' },
  employeePanel: { flex: 1.7, minWidth: 0, width: '100%' },
  detailColumn: { flex: 1, minWidth: 0, width: '100%', gap: 14 },
  employeeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 9, borderTopWidth: 1, borderTopColor: colors.border, borderRadius: 8 },
  employeeRowSelected: { backgroundColor: colors.successLight, borderColor: colors.success },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryDark, fontWeight: '900', fontSize: 10 },
  employeeIdentity: { flex: 1, minWidth: 150 },
  employeeName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  employeeRole: { color: colors.muted, fontSize: 9, marginTop: 3 },
  summaryValue: { minWidth: 58, alignItems: 'center' },
  summaryLabel: { color: colors.muted, fontWeight: '800', fontSize: 8 },
  summaryNumber: { color: colors.text, fontWeight: '900', fontSize: 11, marginTop: 3 },
  openDetail: { color: colors.info, fontWeight: '900', fontSize: 10 },
  dateNavigation: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  selectedDateBox: { flex: 1, minHeight: 38, borderRadius: 7, backgroundColor: '#F3F5F7', alignItems: 'center', justifyContent: 'center' },
  selectedDate: { color: colors.text, fontWeight: '900', fontSize: 12 },
  dayFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  dayFact: { flex: 1, minWidth: 125, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 9 },
  dayFactLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  dayFactValue: { color: colors.text, fontWeight: '900', fontSize: 12, marginTop: 4 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  field: { flex: 1, minWidth: 145 },
  saveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  dayList: { gap: 4 },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8, paddingHorizontal: 6 },
  dayRowSelected: { backgroundColor: colors.primaryLight, borderRadius: 7 },
  dayRowDate: { minWidth: 125 },
  dayRowDateText: { color: colors.text, fontWeight: '800', fontSize: 10 },
  savedText: { color: colors.info, fontSize: 8, fontWeight: '900', marginTop: 2 },
  dayRowHours: { color: colors.text, fontSize: 9, minWidth: 82 },
  overtimeText: { color: colors.info, fontWeight: '900', fontSize: 9 },
  aoText: { color: colors.warning, fontWeight: '900', fontSize: 9 },
  noWorkText: { color: colors.danger, fontWeight: '900', fontSize: 9 },
  rulesCard: { backgroundColor: colors.successLight, borderColor: '#B8DDBB', gap: 5 },
  rulesTitle: { color: colors.success, fontWeight: '900', fontSize: 13 },
  rulesText: { color: colors.text, fontSize: 10, lineHeight: 16 },
  modalContent: { gap: 12, paddingBottom: 8 },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  payrollSummaryCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 11, gap: 8 },
  payrollSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
