import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmployeeProfileEditor } from '../components/EmployeeProfileEditor';
import { AppModal, Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';
import {
  calculatePayrollDay,
  MONTHLY_HOURS_FACTOR,
  payrollPeriodDates,
  payrollPeriodForReference,
  shiftPayrollPeriod,
  summarizeEmployee,
  usePayrollModule,
} from '../hooks/usePayrollModule';
import { EmployeeTimesheetEntry, PayrollDayStatus, PayrollEmployee, PayrollEmployeeSummary, PayrollEmployeeType } from '../payroll/types';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { downloadPayrollSummaryPdf } from '../services/payrollSummaryPdf';
import { colors } from '../theme';
import { StaffProfile } from '../types';

const EMPLOYEE_TYPES: Array<PayrollEmployeeType | 'Todos'> = ['Todos', 'Técnico', 'Secretaria', 'Administración', 'Otro'];
const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
];
const CALENDAR_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function hours(value: number) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateKey(date: Date) {
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

function statusTone(status: PayrollDayStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'Regular') return 'success';
  if (status.startsWith('AO')) return 'warning';
  if (status.startsWith('Vacaciones')) return 'info';
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
  const { staffProfiles, vans, saveStaffProfile } = useTeamState();
  const module = usePayrollModule(currentUser, staffProfiles);
  const { width } = useWindowDimensions();
  const compact = width < 980;

  const [period, setPeriod] = useState(() => payrollPeriodForReference(new Date()));
  const [employeeType, setEmployeeType] = useState<PayrollEmployeeType | 'Todos'>('Todos');
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [message, setMessage] = useState('');
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [scheduleEmployee, setScheduleEmployee] = useState<PayrollEmployee | null>(null);
  const [profileForm, setProfileForm] = useState<StaffProfile | null>(null);
  const [directoryVisible, setDirectoryVisible] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  const [aoDraft, setAoDraft] = useState('0');
  const [vacationDraft, setVacationDraft] = useState('0');
  const [noWorkDraft, setNoWorkDraft] = useState('0');
  const [overtimeDraft, setOvertimeDraft] = useState('0');
  const [notesDraft, setNotesDraft] = useState('');


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

  const selectedEmployee = activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedStaffProfile = staffProfiles.find((profile) => profile.id === selectedEmployeeId) ?? null;
  const selectedSummary = summaries.find((summary) => summary.employee.id === selectedEmployeeId) ?? null;
  const periodDates = useMemo(() => payrollPeriodDates(period), [period]);
  const selectedSavedEntry = selectedEmployee ? module.entryByEmployeeDate.get(`${selectedEmployee.id}_${selectedDate}`) : undefined;
  const selectedDay = selectedEmployee ? calculatePayrollDay(selectedEmployee, selectedDate, selectedSavedEntry) : null;

  useEffect(() => {
    setAoDraft(String(selectedSavedEntry?.aoHours ?? 0));
    setVacationDraft(String(selectedSavedEntry?.vacationHours ?? 0));
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
    vacationHours: Math.max(0, Number(vacationDraft || 0)),
    noWorkNoPayHours: Math.max(0, Number(noWorkDraft || 0)),
    status: 'Regular',
    notes: notesDraft,
    updatedAt: new Date().toISOString(),
  }) : null;

  const totalMetrics = useMemo(() => summaries.reduce((totals, summary) => ({
    monthlyBase: totals.monthlyBase + summary.monthlyBaseHours,
    overtime: totals.overtime + summary.overtimeHours,
    ao: totals.ao + summary.aoHours,
    vacation: totals.vacation + summary.vacationHours,
    noWork: totals.noWork + summary.noWorkNoPayHours,
  }), { monthlyBase: 0, overtime: 0, ao: 0, vacation: 0, noWork: 0 }), [summaries]);

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
      vacationHours: previewDay.vacationHours,
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

  function selectDate(date: string) {
    setSelectedDate(date);
    setPeriod(payrollPeriodForReference(new Date(`${date}T12:00:00`)));
    setCalendarMonth(date.slice(0, 7));
  }

  function changeDate(offset: number) {
    selectDate(shiftDateValue(selectedDate, offset));
  }

  function detailedRows() {
    const rows: Array<Array<string | number>> = [[
      'Empleado', 'Cargo', 'Tipo', 'Fecha', 'Día de semana', 'Horas regulares reales', 'Overtime', 'AO', 'Vacaciones', 'No Work No Pay', 'Estado', 'Nota',
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
          formatDate(date).split(',')[0],
          hours(day.regularHours),
          hours(day.overtimeHours),
          hours(day.aoHours),
          hours(day.vacationHours),
          hours(day.noWorkNoPayHours),
          day.status,
          day.notes,
        ]);
      }
    }
    return rows;
  }

  function downloadDetailed() {
    const ok = downloadCsv(`DEMAC_Timesheet_${period.startDate}_${period.endDate}.csv`, detailedRows());
    setMessage(ok ? 'Reporte detallado descargado.' : 'La descarga está disponible desde la versión web/PWA.');
  }

  function downloadSummary() {
    const ok = downloadPayrollSummaryPdf({ period, summaries });
    setMessage(ok ? 'Resumen de payroll descargado en PDF.' : 'La descarga PDF está disponible desde la versión web/PWA.');
  }

  function openNewEmployee() {
    setDirectoryVisible(false);
    const now = new Date().toISOString();
    setProfileForm({
      id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: '',
      phone: '',
      email: '',
      role: 'Ayudante',
      employeeType: 'Técnico',
      canDriveVan: false,
      skills: [],
      availability: 'Disponible',
      active: true,
      notes: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  async function saveMasterProfile(profile: StaffProfile) {
    const name = profile.name.trim();
    const phone = profile.phone.trim();
    if (!name || !phone) {
      setMessage('Nombre y teléfono son obligatorios.');
      return;
    }
    const normalizedName = name.toLocaleLowerCase('es').replace(/\s+/g, ' ');
    const normalizedPhone = phone.replace(/\D/g, '');
    const duplicate = staffProfiles.find((candidate) => candidate.id !== profile.id && (
      candidate.name.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ') === normalizedName
      || (normalizedPhone && candidate.phone.replace(/\D/g, '') === normalizedPhone)
    ));
    if (duplicate) {
      setMessage(`Ya existe un perfil maestro para ${duplicate.name}. Revisa el nombre o teléfono antes de guardar.`);
      return;
    }
    setProfileSaving(true);
    const result = await saveStaffProfile({ ...profile, name, phone, updatedAt: new Date().toISOString() });
    setProfileSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? 'No se pudo guardar el perfil maestro.');
      return;
    }
    setSelectedEmployeeId(profile.id);
    setProfileForm(null);
    setDirectoryVisible(false);
    setMessage(`${name} quedó guardado como registro maestro del empleado.`);
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle
        title="Empleados"
        subtitle="Timesheet, asistencia y preparación de nómina"
        action={<View style={styles.headerActions}>
          {currentUser?.role === 'admin' ? <><Button compact variant="secondary" label="Directorio de empleados" onPress={() => setDirectoryVisible(true)} /><Button compact variant="secondary" label="Agregar empleado" onPress={openNewEmployee} /></> : null}
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
            <Button compact variant="secondary" label="‹" onPress={() => { const next = shiftPayrollPeriod(period, -1); setPeriod(next); setSelectedDate(next.endDate); setCalendarMonth(next.endDate.slice(0, 7)); }} />
            <View style={styles.periodLabelBox}><Text style={styles.periodLabel}>{period.label}</Text></View>
            <Button compact variant="secondary" label="›" onPress={() => { const next = shiftPayrollPeriod(period, 1); setPeriod(next); setSelectedDate(next.endDate); setCalendarMonth(next.endDate.slice(0, 7)); }} />
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
        <Metric label={`Base mensual · ${MONTHLY_HOURS_FACTOR}`} value={hours(totalMetrics.monthlyBase)} icon="◷" />
        <Metric label="Horas overtime" value={hours(totalMetrics.overtime)} icon="◴" />
        <Metric label="Horas AO" value={hours(totalMetrics.ao)} icon="AO" />
        <Metric label="Horas vacaciones" value={hours(totalMetrics.vacation)} icon="V" />
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
                action={<View style={styles.headerActions}>{currentUser?.role === 'admin' && selectedStaffProfile ? <Button compact variant="secondary" label="Editar perfil" onPress={() => { setDirectoryVisible(false); setProfileForm({ ...selectedStaffProfile, skills: [...selectedStaffProfile.skills] }); }} /> : null}<Button compact variant="secondary" label="Configurar horario" onPress={() => setScheduleEmployee(selectedEmployee)} /></View>}
              />
              <View style={styles.dateNavigation}>
                <Button compact variant="secondary" label="‹ Día" onPress={() => changeDate(-1)} />
                <Pressable style={styles.selectedDateBox} onPress={() => { setCalendarMonth(selectedDate.slice(0, 7)); setCalendarVisible(true); }}>
                  <Text style={styles.selectedDate}>{formatDate(selectedDate)}</Text>
                  <Text style={styles.selectedDateHint}>Abrir calendario</Text>
                </Pressable>
                <Button compact variant="secondary" label="Día ›" onPress={() => changeDate(1)} />
              </View>
              <View style={styles.dayFacts}>
                <DayFact label="Jornada programada" value={`${hours(previewDay.scheduledWorkHours)} h`} />
                <DayFact label="Horas regulares" value={`${hours(previewDay.regularHours)} h`} />
                <DayFact label="Estado" value={previewDay.status} />
              </View>
              <View style={styles.formGrid}>
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas AO" value={aoDraft} onChangeText={setAoDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas de vacaciones" value={vacationDraft} onChangeText={setVacationDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Horas No Work No Pay" value={noWorkDraft} onChangeText={setNoWorkDraft} />
                <Input style={styles.field} keyboardType="decimal-pad" label="Overtime" value={overtimeDraft} onChangeText={setOvertimeDraft} />
              </View>
              <Input multiline label="Nota del día" value={notesDraft} onChangeText={setNotesDraft} placeholder="Motivo de AO, vacaciones, permiso, salida temprana, overtime..." />
              <View style={styles.saveRow}>
                <Pill label={previewDay.status} tone={statusTone(previewDay.status)} />
                <Button variant="success" label={module.busy ? 'Guardando…' : 'Guardar día'} disabled={module.busy} onPress={() => void saveDay()} />
              </View>
            </Card>
          ) : <Card><EmptyState icon="♙" title="Selecciona un empleado" message="Abre un empleado para registrar AO, vacaciones, No Work No Pay y overtime." /></Card>}

          {selectedEmployee ? (
            <Card>
              <SectionTitle title={`Días del período — ${selectedEmployee.name}`} subtitle="Los días sin cambios utilizan automáticamente el horario configurado." />
              <View style={styles.dayList}>
                {periodDates.map((date) => {
                  const entry = module.entryByEmployeeDate.get(`${selectedEmployee.id}_${date}`);
                  const day = calculatePayrollDay(selectedEmployee, date, entry);
                  return (
                    <Pressable key={date} onPress={() => selectDate(date)} style={[styles.dayRow, date === selectedDate && styles.dayRowSelected]}>
                      <View style={styles.dayRowDate}><Text style={styles.dayRowDateText}>{formatDate(date)}</Text>{entry ? <Text style={styles.savedText}>Editado</Text> : null}</View>
                      <Text style={styles.dayRowHours}>{hours(day.regularHours)}h regular</Text>
                      {day.overtimeHours ? <Text style={styles.overtimeText}>+{hours(day.overtimeHours)} OT</Text> : null}
                      {day.aoHours ? <Text style={styles.aoText}>{hours(day.aoHours)} AO</Text> : null}
                      {day.vacationHours ? <Text style={styles.vacationText}>{hours(day.vacationHours)} Vac.</Text> : null}
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
        <Text style={styles.rulesText}>• El horario regular diario aplica de lunes a sábado; domingo permanece sin jornada.</Text>
        <Text style={styles.rulesText}>• La base mensual se calcula como horas regulares semanales × {MONTHLY_HOURS_FACTOR} y se redondea a horas completas.</Text>
        <Text style={styles.rulesText}>• AO y vacaciones se reportan como ausencias pagadas; No Work No Pay se descuenta de la base mensual.</Text>
        <Text style={styles.rulesText}>• Para julio, los técnicos permanecen con su horario completo. La regla de 5 horas trabajadas + 3 horas libres puede activarse desde el 1 de agosto.</Text>
        <Text style={styles.rulesText}>• Las secretarias pueden configurarse con 4 horas trabajadas + 4 horas libres en su medio día semanal.</Text>
      </Card>

      <AppModal visible={calendarVisible} title="Seleccionar fecha" onClose={() => setCalendarVisible(false)}>
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
        <ScrollView contentContainerStyle={styles.modalContent}>
          {summaries.map((summary) => <PayrollSummaryCard key={summary.employee.id} summary={summary} />)}
          <Button variant="success" label="Descargar resumen PDF" onPress={downloadSummary} />
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

      <AppModal visible={directoryVisible} title="Directorio maestro de empleados" onClose={() => setDirectoryVisible(false)}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.rulesCard}>
            <Text style={styles.rulesTitle}>Un solo perfil por persona</Text>
            <Text style={styles.rulesText}>Los empleados de esta lista son los mismos que se seleccionan en las vans y en Timesheet.</Text>
          </View>
          {staffProfiles.map((profile) => {
            const assignments = vans.filter((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id);
            return <Pressable key={profile.id} onPress={() => { setDirectoryVisible(false); setProfileForm({ ...profile, skills: [...profile.skills] }); }} style={styles.dayRow}>
              <View style={styles.dayRowDate}><Text style={styles.employeeName}>{profile.name}</Text><Text style={styles.employeeRole}>{profile.role} · {profile.phone}</Text></View>
              <Text style={styles.dayRowHours}>{assignments.length ? assignments.map((van) => van.name).join(' · ') : 'Sin van'}</Text>
              <Pill label={profile.active ? profile.availability : 'Inactivo'} tone={profile.active ? 'success' : 'neutral'} />
              <Text style={styles.openDetail}>Editar ›</Text>
            </Pressable>;
          })}
          <Button variant="success" label="Agregar empleado" onPress={openNewEmployee} />
        </ScrollView>
      </AppModal>

      <AppModal visible={Boolean(profileForm)} title={profileForm && staffProfiles.some((profile) => profile.id === profileForm.id) ? 'Editar perfil maestro' : 'Agregar empleado'} onClose={() => !profileSaving && setProfileForm(null)}>
        {profileForm ? <EmployeeProfileEditor profile={profileForm} vans={vans} busy={profileSaving} onCancel={() => setProfileForm(null)} onSave={saveMasterProfile} /> : null}
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
      <SummaryValue label="Base mes" value={summary.monthlyBaseHours} />
      <SummaryValue label="OT" value={summary.overtimeHours} />
      <SummaryValue label="AO" value={summary.aoHours} warning={summary.aoHours > 0} />
      <SummaryValue label="Vac." value={summary.vacationHours} />
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
  return <View style={styles.payrollSummaryCard}><Text style={styles.employeeName}>{summary.employee.name}</Text><Text style={styles.employeeRole}>{summary.employee.role}</Text><View style={styles.payrollSummaryGrid}><SummaryValue label="Base semana" value={summary.weeklyRegularHours} /><SummaryValue label="Base mes" value={summary.monthlyBaseHours} /><SummaryValue label="Laboradas" value={summary.actualRegularHours} /><SummaryValue label="OT" value={summary.overtimeHours} /><SummaryValue label="AO" value={summary.aoHours} /><SummaryValue label="Vacaciones" value={summary.vacationHours} /><SummaryValue label="NWNP" value={summary.noWorkNoPayHours} /><SummaryValue label="Pagables" value={summary.payableHours} /></View></View>;
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
      <Input keyboardType="decimal-pad" label="Horario regular diario (lunes a sábado)" value={String(draft.weekdayHours)} onChangeText={(value) => setDraft((current) => ({ ...current, weekdayHours: Math.max(0, Number(value || 0)), saturdayHours: Math.max(0, Number(value || 0)) }))} />
      <Text style={styles.rulesText}>Este horario aplica a todos los días laborables de lunes a sábado. El día de medio día y sus horas especiales se configuran abajo.</Text>
      <Text style={styles.filterLabel}>MEDIO DÍA SEMANAL</Text>
      <View style={styles.optionRow}>
        <Button compact variant={draft.weeklyHalfDayWeekday === undefined ? 'primary' : 'secondary'} label="Sin medio día" onPress={() => setDraft((current) => ({ ...current, weeklyHalfDayWeekday: undefined }))} />
        {WEEKDAYS.map((day) => <Button key={day.value} compact variant={draft.weeklyHalfDayWeekday === day.value ? 'primary' : 'secondary'} label={day.label} onPress={() => setDraft((current) => ({ ...current, weeklyHalfDayWeekday: day.value }))} />)}
      </View>
      <Input label="Fecha de inicio del medio día (AAAA-MM-DD)" value={draft.halfDayEffectiveFrom ?? ''} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayEffectiveFrom: value || undefined }))} placeholder="2026-08-01" />
      <View style={styles.formGrid}>
        <Input style={styles.field} keyboardType="decimal-pad" label="Horas trabajadas ese día" value={String(draft.halfDayWorkedHours)} onChangeText={(value) => setDraft((current) => ({ ...current, halfDayWorkedHours: Math.max(0, Number(value || 0)) }))} />
      </View>
      <Text style={styles.rulesText}>Beneficio semanal no contabilizado: {hours(Math.max(0, Number(draft.weekdayHours || 0) - Number(draft.halfDayWorkedHours || 0)))} horas libres. Este beneficio no aparece en Timesheet ni en el resumen de payroll.</Text>
      <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={onCancel} /><Button variant="success" label={busy ? 'Guardando…' : 'Guardar horario'} disabled={busy} onPress={() => void onSave({ ...draft, saturdayHours: draft.weekdayHours, halfDayPaidFreeHours: Math.max(0, Number(draft.weekdayHours || 0) - Number(draft.halfDayWorkedHours || 0)), updatedAt: new Date().toISOString() })} /></View>
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
  selectedDate: { color: colors.text, fontWeight: '900', fontSize: 12, textAlign: 'center' },
  selectedDateHint: { color: colors.info, fontWeight: '800', fontSize: 8, marginTop: 2 },
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
  vacationText: { color: colors.info, fontWeight: '900', fontSize: 9 },
  noWorkText: { color: colors.danger, fontWeight: '900', fontSize: 9 },
  rulesCard: { backgroundColor: colors.successLight, borderColor: '#B8DDBB', gap: 5 },
  rulesTitle: { color: colors.success, fontWeight: '900', fontSize: 13 },
  rulesText: { color: colors.text, fontSize: 10, lineHeight: 16 },
  modalContent: { gap: 12, paddingBottom: 8 },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  payrollSummaryCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 11, gap: 8 },
  payrollSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
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
