import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PayrollAdjustment, PayrollAdjustmentType, payrollAdjustmentTotals } from '../payroll/adjustments';
import { PayrollEmployee, PayrollPeriod } from '../payroll/types';
import { colors } from '../theme';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from './UI';

type SaveResult = { ok: boolean; message?: string };

type Props = {
  employees: PayrollEmployee[];
  period: PayrollPeriod;
  adjustments: PayrollAdjustment[];
  loading: boolean;
  busy: boolean;
  error?: string;
  onSave: (adjustment: PayrollAdjustment) => Promise<SaveResult>;
  onVoid: (adjustment: PayrollAdjustment, reason: string) => Promise<SaveResult>;
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

function typeTitle(type: PayrollAdjustmentType) {
  return type === 'bonus' ? 'Bono' : 'Deducción';
}

export function PayrollAdjustmentsPanel({
  employees,
  period,
  adjustments,
  loading,
  busy,
  error,
  onSave,
  onVoid,
}: Props) {
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
  const totals = useMemo(() => payrollAdjustmentTotals(periodAdjustments), [periodAdjustments]);

  function openForm(type: PayrollAdjustmentType) {
    setFormType(type);
    setEmployeeId((current) => current || employees[0]?.id || '');
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
  }

  async function confirmVoid() {
    if (!voiding) return;
    if (!voidReason.trim()) return;
    const result = await onVoid(voiding, voidReason);
    if (result.ok) {
      setVoiding(null);
      setVoidReason('');
    }
  }

  return (
    <Card>
      <SectionTitle
        title="Bonos y deducciones"
        subtitle={`Movimientos monetarios del período ${period.label}. El historial conserva concepto, fecha y usuario.`}
        action={<View style={styles.actions}>
          <Button compact variant="success" label="Añadir bono" onPress={() => openForm('bonus')} />
          <Button compact variant="secondary" label="Añadir deducción" onPress={() => openForm('deduction')} />
        </View>}
      />

      <View style={styles.totalRow}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>BONOS ACTIVOS</Text>
          <Text style={styles.bonusTotal}>{formatMoney(totals.bonusesAfl)}</Text>
        </View>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>DEDUCCIONES ACTIVAS</Text>
          <Text style={styles.deductionTotal}>{formatMoney(totals.deductionsAfl)}</Text>
        </View>
      </View>

      {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

      {loading ? (
        <Text style={styles.loadingText}>Cargando historial de bonos y deducciones…</Text>
      ) : periodAdjustments.length ? (
        <View style={styles.historyList}>
          {periodAdjustments.map((adjustment) => (
            <View key={adjustment.id} style={[styles.historyRow, adjustment.status === 'voided' && styles.historyRowVoided]}>
              <View style={styles.historyIdentity}>
                <View style={styles.historyHeading}>
                  <Pill
                    label={adjustment.type === 'bonus' ? 'Bono' : 'Deducción'}
                    tone={adjustment.type === 'bonus' ? 'success' : 'warning'}
                  />
                  {adjustment.status === 'voided' ? <Pill label="Anulado" tone="danger" /> : null}
                </View>
                <Text style={styles.employeeName}>{adjustment.employeeName}</Text>
                <Text style={styles.concept}>{adjustment.concept}</Text>
                <Text style={styles.meta}>
                  {formatDate(adjustment.date)} · Registrado por {adjustment.createdByName ?? 'usuario de payroll'}
                </Text>
                {adjustment.status === 'voided' ? (
                  <Text style={styles.voidMeta}>Motivo de anulación: {adjustment.voidReason || 'No registrado'}</Text>
                ) : null}
              </View>
              <View style={styles.amountColumn}>
                <Text style={adjustment.type === 'bonus' ? styles.bonusAmount : styles.deductionAmount}>
                  {adjustment.type === 'bonus' ? '+' : '−'} {formatMoney(adjustment.amountAfl)}
                </Text>
                {adjustment.status === 'active' ? (
                  <Button compact variant="ghost" label="Anular" onPress={() => { setVoiding(adjustment); setVoidReason(''); }} />
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="$"
          title="Sin movimientos monetarios"
          message="Todavía no se han registrado bonos ni deducciones para este período."
        />
      )}

      <AppModal visible={Boolean(formType)} title={formType ? `Añadir ${typeTitle(formType).toLowerCase()}` : 'Nuevo movimiento'} onClose={closeForm}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalHelp}>
            {formType === 'bonus'
              ? 'Registra asistencia perfecta, desempeño, metas u otro concepto. La contabilidad recibirá la suma del período.'
              : 'Registra adelantos, compras fiadas u otra deducción. La contabilidad recibirá la suma del período.'}
          </Text>

          <Text style={styles.fieldLabel}>EMPLEADO</Text>
          <View style={styles.employeeOptions}>
            {employees.map((employee) => {
              const selected = employee.id === employeeId;
              return (
                <Pressable
                  key={employee.id}
                  onPress={() => setEmployeeId(employee.id)}
                  style={[styles.employeeOption, selected && styles.employeeOptionSelected]}
                >
                  <Text style={[styles.employeeOptionName, selected && styles.employeeOptionNameSelected]}>{employee.name}</Text>
                  <Text style={[styles.employeeOptionRole, selected && styles.employeeOptionRoleSelected]}>{employee.role}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.formGrid}>
            <Input
              style={styles.formField}
              label="Cantidad en florines (Afl.)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="100.00"
              editable={!busy}
            />
            <Input
              style={styles.formField}
              label="Fecha (AAAA-MM-DD)"
              value={date}
              onChangeText={setDate}
              placeholder={period.endDate}
              editable={!busy}
            />
          </View>
          <Input
            label="Concepto / motivo"
            value={concept}
            onChangeText={setConcept}
            multiline
            placeholder={formType === 'bonus'
              ? 'Ejemplo: Bono por asistencia perfecta del período.'
              : 'Ejemplo: Adelanto entregado al empleado.'}
            editable={!busy}
          />
          {formMessage ? <View style={styles.formMessage}><Text style={styles.formMessageText}>{formMessage}</Text></View> : null}
          <View style={styles.modalActions}>
            <Button variant="secondary" label="Cancelar" disabled={busy} onPress={closeForm} />
            <Button
              variant={formType === 'bonus' ? 'success' : 'primary'}
              label={busy ? 'Guardando…' : `Guardar ${formType === 'bonus' ? 'bono' : 'deducción'}`}
              disabled={busy}
              onPress={() => void save()}
            />
          </View>
        </ScrollView>
      </AppModal>

      <AppModal visible={Boolean(voiding)} title="Anular movimiento" onClose={() => { if (!busy) setVoiding(null); }}>
        <View style={styles.modalContent}>
          <Text style={styles.modalHelp}>
            El movimiento permanecerá en el historial como anulado y dejará de sumarse en el reporte para contabilidad.
          </Text>
          <Input
            label="Motivo de anulación"
            value={voidReason}
            onChangeText={setVoidReason}
            multiline
            placeholder="Explica por qué se anula este movimiento."
            editable={!busy}
          />
          <View style={styles.modalActions}>
            <Button variant="secondary" label="Cancelar" disabled={busy} onPress={() => setVoiding(null)} />
            <Button variant="danger" label={busy ? 'Anulando…' : 'Confirmar anulación'} disabled={busy || !voidReason.trim()} onPress={() => void confirmVoid()} />
          </View>
        </View>
      </AppModal>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  totalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  totalCard: { flex: 1, minWidth: 210, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, backgroundColor: '#F8FAFC' },
  totalLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  bonusTotal: { color: colors.success, fontSize: 18, fontWeight: '900', marginTop: 5 },
  deductionTotal: { color: colors.warning, fontSize: 18, fontWeight: '900', marginTop: 5 },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 10 },
  errorText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  loadingText: { color: colors.muted, paddingVertical: 14, textAlign: 'center' },
  historyList: { gap: 7 },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11 },
  historyRowVoided: { opacity: 0.58 },
  historyIdentity: { flex: 1, minWidth: 260 },
  historyHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  employeeName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  concept: { color: colors.text, fontSize: 10, marginTop: 4, lineHeight: 15 },
  meta: { color: colors.muted, fontSize: 8, marginTop: 5 },
  voidMeta: { color: colors.danger, fontSize: 8, fontWeight: '800', marginTop: 4 },
  amountColumn: { alignItems: 'flex-end', gap: 5 },
  bonusAmount: { color: colors.success, fontWeight: '900', fontSize: 13 },
  deductionAmount: { color: colors.warning, fontWeight: '900', fontSize: 13 },
  modalContent: { gap: 12, paddingBottom: 8 },
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
