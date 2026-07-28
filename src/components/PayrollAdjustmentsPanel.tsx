import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PayrollAdjustment, PayrollAdjustmentType, payrollAdjustmentTotals } from '../payroll/adjustments';
import { formatOvertimeHours, formatOvertimeMinutes, overtimeMinutesFromEntry } from '../payroll/overtime';
import {
  EmployeeTimesheetEntry,
  PayrollEmployee,
  PayrollEmployeeSummary,
  PayrollPeriod,
} from '../payroll/types';
import { colors } from '../theme';
import { AppModal, Button, EmptyState, formatMoney, Input, Pill } from './UI';

type SaveResult = { ok: boolean; message?: string };
type TimeHistoryType = 'overtime' | 'ao' | 'vacation' | 'noWork';
type HistoryType = TimeHistoryType | PayrollAdjustmentType;

type Props = {
  employees: PayrollEmployee[];
  summaries: PayrollEmployeeSummary[];
  entries: EmployeeTimesheetEntry[];
  period: PayrollPeriod;
  adjustments: PayrollAdjustment[];
  loading: boolean;
  busy: boolean;
  error?: string;
  onSave: (adjustment: PayrollAdjustment) => Promise<SaveResult>;
  onVoid: (adjustment: PayrollAdjustment, reason: string) => Promise<SaveResult>;
};

type MetricTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

const TIME_HISTORY_META: Record<TimeHistoryType, {
  title: string;
  emptyTitle: string;
  emptyMessage: string;
  icon: string;
  tone: MetricTone;
}> = {
  overtime: {
    title: 'Historial de overtime',
    emptyTitle: 'Sin overtime',
    emptyMessage: 'No hay overtime registrado para este período.',
    icon: 'OT',
    tone: 'info',
  },
  ao: {
    title: 'Historial de AO',
    emptyTitle: 'Sin horas AO',
    emptyMessage: 'No hay horas AO registradas para este período.',
    icon: 'AO',
    tone: 'warning',
  },
  vacation: {
    title: 'Historial de vacaciones',
    emptyTitle: 'Sin vacaciones',
    emptyMessage: 'No hay horas de vacaciones registradas para este período.',
    icon: 'V',
    tone: 'info',
  },
  noWork: {
    title: 'Historial No Work / No Pay',
    emptyTitle: 'Sin No Work / No Pay',
    emptyMessage: 'No hay horas No Work / No Pay registradas para este período.',
    icon: 'NP',
    tone: 'danger',
  },
};

function todayInsidePeriod(period: PayrollPeriod) {
  const now = new Date();
  const value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (value < period.startDate) return period.startDate;
  if (value > period.endDate) return period.endDate;
  return value;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-AW', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatHoursMinutes(value: number) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours && !minutes) return '0 h';
  if (!wholeHours) return `${minutes} min`;
  if (!minutes) return `${wholeHours} h`;
  return `${wholeHours} h ${minutes} min`;
}

function typeTitle(type: PayrollAdjustmentType) {
  return type === 'bonus' ? 'Bono' : 'Deducción';
}

function metricHours(entry: EmployeeTimesheetEntry, metric: TimeHistoryType) {
  if (metric === 'overtime') return entry.overtimeHours;
  if (metric === 'ao') return entry.aoHours;
  if (metric === 'vacation') return entry.vacationHours ?? 0;
  return entry.noWorkNoPayHours;
}

function metricValue(entry: EmployeeTimesheetEntry, metric: TimeHistoryType) {
  if (metric === 'overtime') return formatOvertimeMinutes(overtimeMinutesFromEntry(entry));
  return formatHoursMinutes(metricHours(entry, metric));
}

function historyTitle(history: HistoryType | null) {
  if (!history) return 'Historial';
  if (history === 'bonus') return 'Historial de bonos';
  if (history === 'deduction') return 'Historial de deducciones';
  return TIME_HISTORY_META[history].title;
}

function historyTone(history: HistoryType): MetricTone {
  if (history === 'bonus') return 'info';
  if (history === 'deduction') return 'danger';
  return TIME_HISTORY_META[history].tone;
}

function timeEntryTone(metric: TimeHistoryType): 'info' | 'warning' | 'danger' {
  if (metric === 'ao') return 'warning';
  if (metric === 'noWork') return 'danger';
  return 'info';
}

export function PayrollAdjustmentsPanel({
  employees,
  summaries,
  entries,
  period,
  adjustments,
  loading,
  busy,
  error,
  onSave,
  onVoid,
}: Props) {
  const [history, setHistory] = useState<HistoryType | null>(null);
  const [formType, setFormType] = useState<PayrollAdjustmentType | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => todayInsidePeriod(period));
  const [concept, setConcept] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [voiding, setVoiding] = useState<PayrollAdjustment | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const periodAdjustments = useMemo(
    () => adjustments
      .filter((adjustment) => adjustment.payrollPeriodId === period.id)
      .sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt)),
    [adjustments, period.id],
  );
  const adjustmentTotals = useMemo(() => payrollAdjustmentTotals(periodAdjustments), [periodAdjustments]);

  const timeTotals = useMemo(() => summaries.reduce((totals, summary) => ({
    overtime: totals.overtime + summary.overtimeHours,
    ao: totals.ao + summary.aoHours,
    vacation: totals.vacation + summary.vacationHours,
    noWork: totals.noWork + summary.noWorkNoPayHours,
  }), { overtime: 0, ao: 0, vacation: 0, noWork: 0 }), [summaries]);

  const timeHistory = useMemo(() => {
    if (!history || history === 'bonus' || history === 'deduction') return [];
    return entries
      .filter((entry) => (
        entry.date >= period.startDate
        && entry.date <= period.endDate
        && metricHours(entry, history) > 0
      ))
      .sort((first, second) => (
        second.date.localeCompare(first.date)
        || first.employeeName.localeCompare(second.employeeName)
      ));
  }, [entries, history, period.endDate, period.startDate]);

  const monetaryHistory = useMemo(() => {
    if (history !== 'bonus' && history !== 'deduction') return [];
    return periodAdjustments.filter((adjustment) => adjustment.type === history);
  }, [history, periodAdjustments]);

  function openForm(type: PayrollAdjustmentType) {
    setHistory(null);
    setFormType(type);
    setEmployeeId((current) => employees.some((employee) => employee.id === current) ? current : employees[0]?.id ?? '');
    setAmount('');
    setDate(todayInsidePeriod(period));
    setConcept('');
    setFormMessage('');
  }

  function closeForm() {
    if (busy) return;
    setFormType(null);
    setFormMessage('');
  }

  async function save() {
    if (!formType) return;
    const savedType = formType;
    const employee = employees.find((candidate) => candidate.id === employeeId);
    const parsedAmount = Number(amount.replace(',', '.'));
    if (!employee) {
      setFormMessage('Selecciona el empleado que recibirá este movimiento.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormMessage('Escribe una cantidad válida mayor que cero.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.startDate || date > period.endDate) {
      setFormMessage(`La fecha debe estar dentro del período ${period.startDate} al ${period.endDate}.`);
      return;
    }
    if (!concept.trim()) {
      setFormMessage(`Escribe el concepto o motivo de la ${formType === 'bonus' ? 'bonificación' : 'deducción'}.`);
      return;
    }

    const now = new Date().toISOString();
    const result = await onSave({
      id: `payroll-adjustment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      payrollPeriodId: period.id,
      employeeId: employee.id,
      employeeName: employee.name,
      type: formType,
      amountAfl: parsedAmount,
      date,
      concept: concept.trim(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    if (!result.ok) {
      setFormMessage(result.message ?? 'No se pudo guardar el movimiento.');
      return;
    }
    setFormType(null);
    setFormMessage('');
    setHistory(savedType);
  }

  async function confirmVoid() {
    if (!voiding || !voidReason.trim()) return;
    const reopenHistory = voiding.type;
    const result = await onVoid(voiding, voidReason);
    if (result.ok) {
      setVoiding(null);
      setVoidReason('');
      setHistory(reopenHistory);
    }
  }

  function openVoid(adjustment: PayrollAdjustment) {
    setHistory(null);
    setVoiding(adjustment);
    setVoidReason('');
  }

  const historyTotal = history === 'bonus'
    ? formatMoney(adjustmentTotals.bonusesAfl)
    : history === 'deduction'
      ? formatMoney(adjustmentTotals.deductionsAfl)
      : history === 'overtime'
        ? formatOvertimeHours(timeTotals.overtime)
        : history === 'ao'
          ? formatHoursMinutes(timeTotals.ao)
          : history === 'vacation'
            ? formatHoursMinutes(timeTotals.vacation)
            : history === 'noWork'
              ? formatHoursMinutes(timeTotals.noWork)
              : '';

  return (
    <View style={styles.wrapper}>
      <View style={styles.metrics}>
        <OverviewMetric label="Empleados activos" value={String(employees.length)} icon="E" tone="success" />
        <OverviewMetric label="Overtime" value={formatOvertimeHours(timeTotals.overtime)} icon="OT" tone="info" onPress={() => setHistory('overtime')} />
        <OverviewMetric label="Horas AO" value={formatHoursMinutes(timeTotals.ao)} icon="AO" tone="warning" onPress={() => setHistory('ao')} />
        <OverviewMetric label="Horas vacaciones" value={formatHoursMinutes(timeTotals.vacation)} icon="V" tone="info" onPress={() => setHistory('vacation')} />
        <OverviewMetric label="No Work / No Pay" value={formatHoursMinutes(timeTotals.noWork)} icon="NP" tone={timeTotals.noWork > 0 ? 'danger' : 'neutral'} onPress={() => setHistory('noWork')} />
        <OverviewMetric label="Bonos" value={formatMoney(adjustmentTotals.bonusesAfl)} icon="+" tone="info" valueTone="bonus" onPress={() => setHistory('bonus')} />
        <OverviewMetric label="Deducciones" value={formatMoney(adjustmentTotals.deductionsAfl)} icon="−" tone={adjustmentTotals.deductionsAfl > 0 ? 'danger' : 'neutral'} valueTone="deduction" onPress={() => setHistory('deduction')} />
      </View>

      {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
      {loading ? <Text style={styles.loadingText}>Actualizando bonos y deducciones…</Text> : null}

      <AppModal visible={Boolean(history)} title={historyTitle(history)} onClose={() => setHistory(null)}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          {history ? (
            <View style={styles.historySummary}>
              <View style={styles.historySummaryIdentity}>
                <View style={[styles.historySummaryIcon, styles[`historySummaryIcon_${historyTone(history)}`]]}>
                  <Text style={[styles.historySummaryIconText, styles[`historySummaryIconText_${historyTone(history)}`]]}>
                    {history === 'bonus' ? '+' : history === 'deduction' ? '−' : TIME_HISTORY_META[history].icon}
                  </Text>
                </View>
                <View>
                  <Text style={styles.historySummaryLabel}>TOTAL DEL PERÍODO</Text>
                  <Text style={[styles.historySummaryValue, history === 'bonus' && styles.bonusText, history === 'deduction' && styles.deductionText]}>{historyTotal}</Text>
                </View>
              </View>
              {history === 'bonus' || history === 'deduction' ? (
                <Button compact variant={history === 'bonus' ? 'success' : 'secondary'} label={history === 'bonus' ? 'Añadir bono' : 'Añadir deducción'} onPress={() => openForm(history)} />
              ) : null}
            </View>
          ) : null}

          {history === 'bonus' || history === 'deduction' ? (
            monetaryHistory.length ? (
              <View style={styles.historyList}>
                {monetaryHistory.map((adjustment) => (
                  <View key={adjustment.id} style={[styles.historyRow, adjustment.status === 'voided' && styles.historyRowVoided]}>
                    <View style={styles.historyIdentity}>
                      <View style={styles.historyHeading}>
                        <Pill label={adjustment.type === 'bonus' ? 'Bono' : 'Deducción'} tone={adjustment.type === 'bonus' ? 'info' : 'danger'} />
                        {adjustment.status === 'voided' ? <Pill label="Anulado" tone="danger" /> : null}
                      </View>
                      <Text style={styles.employeeName}>{adjustment.employeeName}</Text>
                      <Text style={styles.concept}>{adjustment.concept}</Text>
                      <Text style={styles.meta}>{formatDate(adjustment.date)} · Registrado por {adjustment.createdByName ?? 'usuario de payroll'}</Text>
                      {adjustment.status === 'voided' ? <Text style={styles.voidMeta}>Motivo de anulación: {adjustment.voidReason || 'No registrado'}</Text> : null}
                    </View>
                    <View style={styles.amountColumn}>
                      <Text style={adjustment.type === 'bonus' ? styles.bonusAmount : styles.deductionAmount}>{adjustment.type === 'bonus' ? '+' : '−'} {formatMoney(adjustment.amountAfl)}</Text>
                      {adjustment.status === 'active' ? <Button compact variant="ghost" label="Anular" onPress={() => openVoid(adjustment)} /> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState icon="$" title={history === 'bonus' ? 'Sin bonos' : 'Sin deducciones'} message={`No hay ${history === 'bonus' ? 'bonos' : 'deducciones'} registrados para este período.`} />
            )
          ) : history ? (
            timeHistory.length ? (
              <View style={styles.historyList}>
                {timeHistory.map((entry) => (
                  <View key={`${history}-${entry.id}`} style={styles.historyRow}>
                    <View style={styles.historyIdentity}>
                      <View style={styles.historyHeading}>
                        <Pill label={TIME_HISTORY_META[history].title.replace('Historial de ', '')} tone={timeEntryTone(history)} />
                        <Text style={styles.historyDate}>{formatDate(entry.date)}</Text>
                      </View>
                      <Text style={styles.employeeName}>{entry.employeeName}</Text>
                      {entry.notes ? <Text style={styles.concept}>{entry.notes}</Text> : null}
                      <Text style={styles.meta}>Estado: {entry.status}{entry.updatedByName ? ` · Registrado por ${entry.updatedByName}` : ''}</Text>
                    </View>
                    <Text style={[styles.durationAmount, history === 'ao' && styles.warningText, history === 'noWork' && styles.deductionText]}>{metricValue(entry, history)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState icon={TIME_HISTORY_META[history].icon} title={TIME_HISTORY_META[history].emptyTitle} message={TIME_HISTORY_META[history].emptyMessage} />
            )
          ) : null}
        </ScrollView>
      </AppModal>

      <AppModal visible={Boolean(formType)} title={formType ? `Añadir ${typeTitle(formType).toLowerCase()}` : 'Nuevo movimiento'} onClose={closeForm}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalHelp}>{formType === 'bonus' ? 'Registra asistencia perfecta, desempeño, metas u otro concepto. La contabilidad recibirá la suma del período.' : 'Registra adelantos, compras fiadas u otra deducción. La contabilidad recibirá la suma del período.'}</Text>
          <Text style={styles.fieldLabel}>EMPLEADO</Text>
          <View style={styles.employeeOptions}>
            {employees.map((employee) => {
              const selected = employee.id === employeeId;
              return (
                <Pressable key={employee.id} onPress={() => setEmployeeId(employee.id)} style={[styles.employeeOption, selected && styles.employeeOptionSelected]}>
                  <Text style={[styles.employeeOptionName, selected && styles.employeeOptionNameSelected]}>{employee.name}</Text>
                  <Text style={[styles.employeeOptionRole, selected && styles.employeeOptionRoleSelected]}>{employee.role}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.formGrid}>
            <Input style={styles.formField} label="Cantidad en florines (Afl.)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="100.00" editable={!busy} />
            <Input style={styles.formField} label="Fecha (AAAA-MM-DD)" value={date} onChangeText={setDate} placeholder={period.endDate} editable={!busy} />
          </View>
          <Input label="Concepto / motivo" value={concept} onChangeText={setConcept} multiline placeholder={formType === 'bonus' ? 'Ejemplo: Bono por asistencia perfecta del período.' : 'Ejemplo: Adelanto entregado al empleado.'} editable={!busy} />
          {formMessage ? <View style={styles.formMessage}><Text style={styles.formMessageText}>{formMessage}</Text></View> : null}
          <View style={styles.modalActions}>
            <Button variant="secondary" label="Cancelar" disabled={busy} onPress={closeForm} />
            <Button variant={formType === 'bonus' ? 'success' : 'primary'} label={busy ? 'Guardando…' : `Guardar ${formType === 'bonus' ? 'bono' : 'deducción'}`} disabled={busy} onPress={() => void save()} />
          </View>
        </ScrollView>
      </AppModal>

      <AppModal visible={Boolean(voiding)} title="Anular movimiento" onClose={() => { if (!busy) setVoiding(null); }}>
        <View style={styles.modalContent}>
          <Text style={styles.modalHelp}>El movimiento permanecerá en el historial como anulado y dejará de sumarse en el reporte para contabilidad.</Text>
          <Input label="Motivo de anulación" value={voidReason} onChangeText={setVoidReason} multiline placeholder="Explica por qué se anula este movimiento." editable={!busy} />
          <View style={styles.modalActions}>
            <Button variant="secondary" label="Cancelar" disabled={busy} onPress={() => setVoiding(null)} />
            <Button variant="danger" label={busy ? 'Anulando…' : 'Confirmar anulación'} disabled={busy || !voidReason.trim()} onPress={() => void confirmVoid()} />
          </View>
        </View>
      </AppModal>
    </View>
  );
}

function OverviewMetric({
  label,
  value,
  icon,
  tone,
  valueTone,
  onPress,
}: {
  label: string;
  value: string;
  icon: string;
  tone: MetricTone;
  valueTone?: 'bonus' | 'deduction';
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={[styles.metricIcon, styles[`metricIcon_${tone}`]]}>
        <Text style={[styles.metricIconText, styles[`metricIconText_${tone}`]]}>{icon}</Text>
      </View>
      <View style={styles.metricText}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, valueTone === 'bonus' && styles.bonusText, valueTone === 'deduction' && styles.deductionText]}>{value}</Text>
        {onPress ? <Text style={styles.metricHint}>Ver historial ›</Text> : null}
      </View>
    </>
  );

  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${label}`} onPress={onPress} style={({ pressed }) => [styles.metric, pressed && styles.metricPressed]}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.metric}>{content}</View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  metric: { flex: 1, minWidth: 165, minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 13 },
  metricPressed: { opacity: 0.76, transform: [{ scale: 0.995 }] },
  metricText: { flex: 1, minWidth: 0 },
  metricIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  metricIcon_neutral: { backgroundColor: '#F0F2F4' },
  metricIcon_success: { backgroundColor: colors.successLight },
  metricIcon_info: { backgroundColor: colors.infoLight },
  metricIcon_warning: { backgroundColor: colors.warningLight },
  metricIcon_danger: { backgroundColor: colors.dangerLight },
  metricIconText: { fontWeight: '900', fontSize: 13 },
  metricIconText_neutral: { color: colors.muted },
  metricIconText_success: { color: colors.success },
  metricIconText_info: { color: colors.info },
  metricIconText_warning: { color: colors.warning },
  metricIconText_danger: { color: colors.danger },
  metricLabel: { color: colors.muted, fontSize: 9.5 },
  metricValue: { color: colors.text, fontWeight: '900', fontSize: 17, marginTop: 3 },
  metricHint: { color: colors.info, fontWeight: '800', fontSize: 8, marginTop: 4 },
  bonusText: { color: colors.info, fontWeight: '900' },
  deductionText: { color: colors.danger, fontWeight: '900' },
  warningText: { color: colors.warning, fontWeight: '900' },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  errorText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  loadingText: { color: colors.muted, paddingVertical: 4, textAlign: 'center', fontSize: 9 },
  modalContent: { gap: 12, paddingBottom: 8 },
  historySummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 },
  historySummaryIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historySummaryIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  historySummaryIcon_neutral: { backgroundColor: '#F0F2F4' },
  historySummaryIcon_success: { backgroundColor: colors.successLight },
  historySummaryIcon_info: { backgroundColor: colors.infoLight },
  historySummaryIcon_warning: { backgroundColor: colors.warningLight },
  historySummaryIcon_danger: { backgroundColor: colors.dangerLight },
  historySummaryIconText: { fontWeight: '900', fontSize: 12 },
  historySummaryIconText_neutral: { color: colors.muted },
  historySummaryIconText_success: { color: colors.success },
  historySummaryIconText_info: { color: colors.info },
  historySummaryIconText_warning: { color: colors.warning },
  historySummaryIconText_danger: { color: colors.danger },
  historySummaryLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  historySummaryValue: { color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 3 },
  historyList: { gap: 2 },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11 },
  historyRowVoided: { opacity: 0.58 },
  historyIdentity: { flex: 1, minWidth: 250 },
  historyHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginBottom: 5 },
  historyDate: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  employeeName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  concept: { color: colors.text, fontSize: 10, marginTop: 4, lineHeight: 15 },
  meta: { color: colors.muted, fontSize: 8, marginTop: 5 },
  voidMeta: { color: colors.danger, fontSize: 8, fontWeight: '800', marginTop: 4 },
  amountColumn: { alignItems: 'flex-end', gap: 5 },
  bonusAmount: { color: colors.info, fontWeight: '900', fontSize: 13 },
  deductionAmount: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  durationAmount: { color: colors.info, fontWeight: '900', fontSize: 13 },
  modalHelp: { color: colors.muted, fontSize: 10, lineHeight: 16 },
  fieldLabel: { color: colors.text, fontSize: 9, fontWeight: '900' },
  employeeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  employeeOption: { minWidth: 145, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 9, backgroundColor: '#FFFFFF' },
  employeeOptionSelected: { borderColor: colors.success, backgroundColor: colors.successLight },
  employeeOptionName: { color: colors.text, fontSize: 10, fontWeight: '900' },
  employeeOptionNameSelected: { color: colors.success },
  employeeOptionRole: { color: colors.muted, fontSize: 8, marginTop: 3 },
  employeeOptionRoleSelected: { color: colors.success },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  formField: { flex: 1, minWidth: 180 },
  formMessage: { backgroundColor: colors.warningLight, borderRadius: 8, padding: 10 },
  formMessageText: { color: colors.warning, fontSize: 10, fontWeight: '800' },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
});
