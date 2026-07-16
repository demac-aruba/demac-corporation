import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Button, Card, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { VanHalfDaySchedule, VanHalfDayWeekday, useVanHalfDayState } from '../state/VanHalfDayState';
import { colors } from '../theme';

const weekdays: { value: VanHalfDayWeekday; short: string; label: string }[] = [
  { value: 1, short: 'LUN', label: 'Lunes' },
  { value: 2, short: 'MAR', label: 'Martes' },
  { value: 3, short: 'MIÉ', label: 'Miércoles' },
  { value: 4, short: 'JUE', label: 'Jueves' },
  { value: 5, short: 'VIE', label: 'Viernes' },
  { value: 6, short: 'SÁB', label: 'Sábado' },
];

function scheduleFor(vanId: string, schedules: VanHalfDaySchedule[]) {
  return schedules.find((item) => item.vanId === vanId);
}

export function VanHalfDaysScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 980;
  const { workOrders } = useAppState();
  const { vans, staffProfiles } = useTeamState();
  const { vanHalfDaySchedules, halfDayLoading, halfDayError, saveVanHalfDaySchedule, refreshVanHalfDays } = useVanHalfDayState();
  const [drafts, setDrafts] = useState<Record<string, VanHalfDayWeekday | 0>>({});
  const [savingVanId, setSavingVanId] = useState('');
  const [message, setMessage] = useState('');

  const activeVans = useMemo(() => vans.filter((van) => van.active !== false).slice(0, 4), [vans]);

  const selectedDay = (vanId: string) => {
    if (Object.prototype.hasOwnProperty.call(drafts, vanId)) return drafts[vanId];
    const schedule = scheduleFor(vanId, vanHalfDaySchedules);
    return schedule?.active ? schedule.weekday : 0;
  };

  const teamNames = (vanId: string) => {
    const van = vans.find((item) => item.id === vanId);
    const ids = [van?.responsibleStaffId, van?.regularHelperId].filter(Boolean);
    return ids.map((id) => staffProfiles.find((profile) => profile.id === id)?.name).filter(Boolean).join(' + ') || 'Equipo por asignar';
  };

  const futureConflicts = (vanId: string, weekday: number) => {
    if (!weekday) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return workOrders.filter((order) => order.vanId === vanId
      && order.date >= today
      && new Date(`${order.date}T12:00:00`).getDay() === weekday
      && order.time >= '13:00'
      && !['Cancelada', 'Completada', 'Facturada', 'Pagada'].includes(order.status)).length;
  };

  const save = async (vanId: string) => {
    const weekday = selectedDay(vanId);
    setSavingVanId(vanId);
    setMessage('');
    const schedule: VanHalfDaySchedule = {
      id: vanId,
      vanId,
      weekday: (weekday || 1) as VanHalfDayWeekday,
      active: weekday !== 0,
      workdayStart: '08:00',
      workdayEnd: '13:00',
      extraMorningSlot: '11:30',
      notes: weekday ? 'Jornada continua sin pausa de almuerzo. Tarde libre desde la 1:00 p. m.' : 'Beneficio semanal desactivado.',
      updatedAt: new Date().toISOString(),
    };
    const result = await saveVanHalfDaySchedule(schedule);
    setSavingVanId('');
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar la tarde libre.');
    const dayName = weekdays.find((day) => day.value === weekday)?.label;
    setMessage(weekday ? `${vans.find((van) => van.id === vanId)?.name}: tarde libre asignada para los ${dayName?.toLowerCase()}.` : `${vans.find((van) => van.id === vanId)?.name}: tarde libre desactivada.`);
    setDrafts((previous) => { const next = { ...previous }; delete next[vanId]; return next; });
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle
        title="Tardes libres por van"
        subtitle="Asigna una tarde libre semanal al equipo completo de cada van. Ese día trabajan de 8:00 a. m. a 1:00 p. m., sin pausa de almuerzo y con un cuarto cupo a las 11:30 a. m."
        action={<Button compact variant="secondary" label="Actualizar" onPress={() => void refreshVanHalfDays()} />}
      />

      {halfDayError ? <View style={styles.errorBox}><Text style={styles.errorText}>{halfDayError}</Text></View> : null}
      {message ? <View style={styles.successBox}><Text style={styles.successText}>{message}</Text></View> : null}

      <Card style={styles.policyCard}>
        <View style={styles.policyIcon}><Text style={styles.policyIconText}>½</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.policyTitle}>Regla operativa</Text>
          <Text style={styles.policyText}>La tarde libre pertenece a la van y cubre al técnico responsable y a su ayudante. Nunca se asigna individualmente. Los cupos de 1:30, 2:30 y 3:30 p. m. quedan bloqueados en rojo en la agenda.</Text>
        </View>
      </Card>

      {halfDayLoading ? <Text style={styles.loading}>Sincronizando configuración…</Text> : null}

      <View style={[styles.grid, compact && styles.gridCompact]}>
        {activeVans.map((van) => {
          const weekday = selectedDay(van.id);
          const conflicts = futureConflicts(van.id, weekday);
          const dirty = Object.prototype.hasOwnProperty.call(drafts, van.id);
          return (
            <Card key={van.id} style={styles.vanCard}>
              <View style={styles.vanHeader}>
                <View style={styles.vanBadge}><Text style={styles.vanBadgeText}>🚐</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vanName}>{van.name}</Text>
                  <Text style={styles.teamName}>{teamNames(van.id)}</Text>
                </View>
                <Pill label={weekday ? 'Beneficio activo' : 'Sin asignar'} tone={weekday ? 'success' : 'neutral'} />
              </View>

              <Text style={styles.fieldLabel}>Día semanal asignado</Text>
              <View style={styles.dayGrid}>
                {weekdays.map((day) => (
                  <Pressable
                    key={day.value}
                    onPress={() => setDrafts((previous) => ({ ...previous, [van.id]: day.value }))}
                    style={[styles.dayButton, weekday === day.value && styles.dayButtonActive]}
                  >
                    <Text style={[styles.dayShort, weekday === day.value && styles.dayTextActive]}>{day.short}</Text>
                    <Text style={[styles.dayLabel, weekday === day.value && styles.dayTextActive]}>{day.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => setDrafts((previous) => ({ ...previous, [van.id]: 0 }))} style={[styles.noneButton, weekday === 0 && styles.noneButtonActive]}>
                <Text style={[styles.noneText, weekday === 0 && styles.noneTextActive]}>Sin tarde libre semanal</Text>
              </Pressable>

              <View style={styles.timeline}>
                <View style={styles.timelineMorning}><Text style={styles.timelineTitle}>08:00–13:00</Text><Text style={styles.timelineText}>4 cupos · sin lunch</Text></View>
                <View style={styles.timelineOff}><Text style={styles.timelineOffTitle}>13:00 en adelante</Text><Text style={styles.timelineOffText}>Tarde libre</Text></View>
              </View>

              {conflicts > 0 ? <View style={styles.warningBox}><Text style={styles.warningTitle}>⚠ {conflicts} cita{conflicts !== 1 ? 's' : ''} futura{conflicts !== 1 ? 's' : ''} en conflicto</Text><Text style={styles.warningText}>Existen trabajos en la tarde para este día semanal. La agenda los mostrará como conflicto para que puedan reprogramarse.</Text></View> : null}

              <Button
                label={savingVanId === van.id ? 'Guardando…' : dirty ? 'Guardar cambio' : 'Guardar configuración'}
                disabled={savingVanId === van.id}
                onPress={() => void save(van.id)}
              />
            </Card>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 26, gap: 16, paddingBottom: 96 },
  errorBox: { padding: 13, borderRadius: 8, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#F0B7B2' },
  errorText: { color: colors.danger, fontWeight: '800', fontSize: 12 },
  successBox: { padding: 13, borderRadius: 8, backgroundColor: colors.successLight, borderWidth: 1, borderColor: '#A9D8C3' },
  successText: { color: colors.success, fontWeight: '800', fontSize: 12 },
  policyCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F4F8FF' },
  policyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  policyIconText: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  policyTitle: { color: colors.text, fontWeight: '900', fontSize: 14 },
  policyText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  loading: { color: colors.muted, fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  gridCompact: { flexDirection: 'column' },
  vanCard: { flexGrow: 1, flexBasis: 420, gap: 14 },
  vanHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  vanBadge: { width: 38, height: 38, borderRadius: 9, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  vanBadgeText: { fontSize: 19 },
  vanName: { color: colors.text, fontWeight: '900', fontSize: 15 },
  teamName: { color: colors.muted, fontSize: 10, marginTop: 2 },
  fieldLabel: { color: colors.text, fontWeight: '800', fontSize: 11, marginTop: 3 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  dayButton: { minWidth: 87, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 9, alignItems: 'center', backgroundColor: '#FFFFFF' },
  dayButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayShort: { color: colors.text, fontWeight: '900', fontSize: 11 },
  dayLabel: { color: colors.muted, fontSize: 8, marginTop: 2 },
  dayTextActive: { color: '#FFFFFF' },
  noneButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, padding: 10, alignItems: 'center', backgroundColor: '#F7F8FA' },
  noneButtonActive: { backgroundColor: '#E9EDF2', borderColor: '#AEB4BC' },
  noneText: { color: colors.muted, fontWeight: '800', fontSize: 10 },
  noneTextActive: { color: colors.text },
  timeline: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  timelineMorning: { flex: 4, padding: 12, backgroundColor: colors.successLight },
  timelineOff: { flex: 3, padding: 12, backgroundColor: colors.dangerLight },
  timelineTitle: { color: colors.success, fontWeight: '900', fontSize: 12 },
  timelineText: { color: colors.success, fontSize: 9, marginTop: 2 },
  timelineOffTitle: { color: colors.danger, fontWeight: '900', fontSize: 12 },
  timelineOffText: { color: colors.danger, fontSize: 9, marginTop: 2 },
  warningBox: { padding: 11, borderRadius: 7, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: '#E7C77A' },
  warningTitle: { color: colors.warning, fontWeight: '900', fontSize: 11 },
  warningText: { color: colors.text, fontSize: 9, lineHeight: 14, marginTop: 3 },
});
