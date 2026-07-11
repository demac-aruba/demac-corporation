import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { CalendarClosure, useCalendarState } from '../state/CalendarState';
import { colors, roleLabels } from '../theme';

const weekdays = [
  { value: 0, label: 'Domingo', short: 'DOM' },
  { value: 1, label: 'Lunes', short: 'LUN' },
  { value: 2, label: 'Martes', short: 'MAR' },
  { value: 3, label: 'Miércoles', short: 'MIÉ' },
  { value: 4, label: 'Jueves', short: 'JUE' },
  { value: 5, label: 'Viernes', short: 'VIE' },
  { value: 6, label: 'Sábado', short: 'SÁB' },
];

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function shiftMonth(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return monthKey(date);
}

function formatLongDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function SettingsScreen() {
  const { currentUser, users, resetDemo } = useAppState();
  const {
    calendarClosures,
    businessCalendarSettings,
    calendarLoading,
    calendarDataError,
    refreshCalendarData,
    saveBusinessCalendarSettings,
    saveCalendarClosure,
    removeCalendarClosure,
  } = useCalendarState();

  const [month, setMonth] = useState(monthKey());
  const [draftWeekdays, setDraftWeekdays] = useState<number[]>(businessCalendarSettings.closedWeekdays ?? [0]);
  const [showClosure, setShowClosure] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [reason, setReason] = useState('Día festivo');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setDraftWeekdays(businessCalendarSettings.closedWeekdays ?? [0]), [businessCalendarSettings.closedWeekdays]);

  const monthDays = useMemo(() => {
    const first = new Date(`${month}T12:00:00`);
    const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: Array<string | null> = Array.from({ length: first.getDay() }, () => null);
    for (let day = 1; day <= count; day += 1) {
      cells.push(`${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month]);

  const monthTitle = new Date(`${month}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const upcomingClosures = useMemo(() => [...calendarClosures].sort((a, b) => a.date.localeCompare(b.date)), [calendarClosures]);
  const selectedClosure = calendarClosures.find((item) => item.date === selectedDate && item.active !== false);

  function toggleWeekday(value: number) {
    setDraftWeekdays((previous) => previous.includes(value) ? previous.filter((day) => day !== value) : [...previous, value].sort());
  }

  async function saveWeeklySchedule() {
    setSaving(true);
    setMessage('');
    const result = await saveBusinessCalendarSettings({ id: 'business-calendar', closedWeekdays: draftWeekdays });
    setSaving(false);
    setMessage(result.ok ? 'Los días cerrados semanales fueron actualizados.' : result.message ?? 'No se pudieron guardar los días semanales.');
  }

  function openDate(date: string) {
    const existing = calendarClosures.find((item) => item.date === date && item.active !== false);
    setSelectedDate(date);
    setReason(existing?.reason ?? 'Día festivo');
    setNotes(existing?.notes ?? '');
    setMessage('');
    setShowClosure(true);
  }

  async function saveClosure() {
    if (!reason.trim()) return setMessage('Escribe el motivo del cierre.');
    const existing = calendarClosures.find((item) => item.date === selectedDate);
    const closure: CalendarClosure = {
      id: existing?.id ?? `closure-${selectedDate}`,
      date: selectedDate,
      reason: reason.trim(),
      notes: notes.trim() || undefined,
      active: true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    const result = await saveCalendarClosure(closure);
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo bloquear la fecha.');
    setShowClosure(false);
    setMessage(`${formatLongDate(selectedDate)} quedó bloqueado.`);
  }

  async function reopenDate(closure: CalendarClosure) {
    setSaving(true);
    const result = await removeCalendarClosure(closure.id);
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo reabrir la fecha.');
    setShowClosure(false);
    setMessage(`${formatLongDate(closure.date)} quedó abierto nuevamente.`);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Configuración del sistema" subtitle="Calendario laboral, usuarios, permisos e información de DEMAC." />

      {calendarDataError ? <View style={styles.errorBanner}><View style={{ flex: 1 }}><Text style={styles.errorTitle}>No se pudo cargar el calendario laboral</Text><Text style={styles.errorText}>{calendarDataError}</Text></View><Button compact variant="secondary" label="Reintentar" onPress={() => void refreshCalendarData()} /></View> : null}
      {message ? <View style={styles.messageBanner}><Text style={styles.messageText}>{message}</Text></View> : null}

      <Card>
        <SectionTitle title="Calendario laboral" subtitle="Define los días semanales que DEMAC no trabaja y bloquea fechas especiales como feriados, inventario o cierres internos." action={<Button label="Bloquear fecha" icon="＋" onPress={() => openDate(dateKey())} />} />

        <Text style={styles.blockTitle}>Días cerrados todas las semanas</Text>
        <Text style={styles.blockHelp}>Los domingos vienen bloqueados por defecto. Puedes activar o desactivar cualquier otro día.</Text>
        <View style={styles.weekdayRow}>
          {weekdays.map((day) => {
            const active = draftWeekdays.includes(day.value);
            return <Pressable key={day.value} onPress={() => toggleWeekday(day.value)} style={[styles.weekdayChip, active && styles.weekdayChipActive]}><Text style={[styles.weekdayChipText, active && styles.weekdayChipTextActive]}>{day.label}</Text><Text style={[styles.weekdayStatus, active && styles.weekdayStatusActive]}>{active ? 'Cerrado' : 'Abierto'}</Text></Pressable>;
          })}
        </View>
        <View style={styles.weeklyActions}><Button label={saving ? 'Guardando…' : 'Guardar horario semanal'} disabled={saving} onPress={() => void saveWeeklySchedule()} /></View>

        <View style={styles.calendarHeader}>
          <Pressable onPress={() => setMonth(shiftMonth(month, -1))} style={styles.monthButton}><Text style={styles.monthButtonText}>‹</Text></Pressable>
          <Text style={styles.monthTitle}>{monthTitle}</Text>
          <Pressable onPress={() => setMonth(shiftMonth(month, 1))} style={styles.monthButton}><Text style={styles.monthButtonText}>›</Text></Pressable>
        </View>
        <View style={styles.weekHeader}>{weekdays.map((day) => <Text key={day.value} style={styles.weekHeaderText}>{day.short}</Text>)}</View>
        <View style={styles.calendarGrid}>
          {monthDays.map((date, index) => {
            if (!date) return <View key={`blank-${index}`} style={styles.calendarCell} />;
            const dateObj = new Date(`${date}T12:00:00`);
            const recurringClosed = draftWeekdays.includes(dateObj.getDay());
            const closure = calendarClosures.find((item) => item.date === date && item.active !== false);
            const closed = recurringClosed || !!closure;
            const today = date === dateKey();
            return <Pressable key={date} onPress={() => openDate(date)} style={[styles.calendarCell, styles.calendarDate, closed && styles.calendarDateClosed, today && styles.calendarDateToday]}><Text style={[styles.calendarNumber, closed && styles.calendarNumberClosed]}>{dateObj.getDate()}</Text><Text style={[styles.calendarStatus, closed && styles.calendarStatusClosed]} numberOfLines={1}>{closure?.reason ?? (recurringClosed ? 'Cerrado semanal' : 'Disponible')}</Text></Pressable>;
          })}
        </View>
      </Card>

      <Card>
        <SectionTitle title={`Cierres especiales (${upcomingClosures.length})`} subtitle="Estas fechas quedan bloqueadas además del horario semanal." />
        {calendarLoading ? <Text style={styles.loadingText}>Sincronizando calendario…</Text> : null}
        {upcomingClosures.length ? upcomingClosures.map((closure) => <View key={closure.id} style={styles.closureRow}><View style={styles.dateBadge}><Text style={styles.dateBadgeDay}>{new Date(`${closure.date}T12:00:00`).getDate()}</Text><Text style={styles.dateBadgeMonth}>{new Date(`${closure.date}T12:00:00`).toLocaleDateString('es', { month: 'short' }).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.closureReason}>{closure.reason}</Text><Text style={styles.closureDate}>{formatLongDate(closure.date)}</Text>{closure.notes ? <Text style={styles.closureNotes}>{closure.notes}</Text> : null}</View><Button compact variant="secondary" label="Editar" onPress={() => openDate(closure.date)} /><Button compact variant="danger" label="Reabrir" disabled={saving} onPress={() => void reopenDate(closure)} /></View>) : <Text style={styles.emptyText}>Todavía no hay cierres especiales. Los domingos siguen bloqueados por el horario semanal.</Text>}
      </Card>

      <Card>
        <SectionTitle title="Información de la empresa" />
        <View style={styles.brandRow}><View style={styles.logo}><Text style={styles.logoText}>❄</Text></View><View><Text style={styles.name}>DEMAC</Text><Text style={styles.corporation}>CORPORATION</Text><Text style={styles.slogan}>Professional Cooling Solutions</Text></View></View>
        <View style={styles.infoGrid}><Info label="Administrador" value="Christian Alexander Márquez Márquez" /><Info label="Moneda" value="Florín arubeño (Afl.)" /><Info label="Zona horaria" value="America/Aruba" /><Info label="Plataformas" value="Android y Web" /></View>
      </Card>

      <Card>
        <SectionTitle title={`Usuarios (${users.length})`} subtitle="Perfiles con acceso configurado en la plataforma." />
        {users.map((user) => <View key={user.id} style={styles.userRow}><View style={styles.avatar}><Text style={styles.avatarText}>{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</Text></View><View style={{ flex: 1 }}><Text style={styles.userName}>{user.name}</Text><Text style={styles.userEmail}>{user.email}</Text></View><Pill label={roleLabels[user.role]} tone={user.id === currentUser?.id ? 'success' : 'info'} /></View>)}
      </Card>

      {currentUser?.authProvider !== 'firebase' ? <Card><SectionTitle title="Entorno de demostración" subtitle="La aplicación guarda localmente los cambios hechos durante las pruebas." /><View style={styles.warning}><Text style={styles.warningTitle}>Restablecer datos DEMO</Text><Text style={styles.warningText}>Elimina los cambios locales y vuelve a cargar clientes, citas, inventario e invoices originales.</Text><Button variant="danger" label="Restablecer información" onPress={() => { void resetDemo(); }} /></View></Card> : null}

      <AppModal visible={showClosure} title={selectedClosure ? 'Editar día cerrado' : 'Bloquear fecha'} onClose={() => { if (!saving) setShowClosure(false); }}>
        <Text style={styles.modalDate}>{formatLongDate(selectedDate)}</Text>
        <Input label="Motivo del cierre" value={reason} onChangeText={setReason} placeholder="Ej. Día festivo, inventario o capacitación" />
        <Input label="Notas internas (opcional)" value={notes} onChangeText={setNotes} multiline placeholder="Agrega cualquier detalle necesario para la oficina." />
        <View style={styles.modalActions}>{selectedClosure ? <Button variant="danger" label="Reabrir fecha" disabled={saving} onPress={() => void reopenDate(selectedClosure)} /> : null}<Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowClosure(false)} /><Button label={saving ? 'Guardando…' : selectedClosure ? 'Guardar cambios' : 'Bloquear fecha'} disabled={saving || !reason.trim()} onPress={() => void saveClosure()} /></View>
      </AppModal>
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#F2B8B5', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 13 },
  errorTitle: { color: colors.danger, fontWeight: '900', fontSize: 12 },
  errorText: { color: colors.text, fontSize: 10, marginTop: 3 },
  messageBanner: { backgroundColor: colors.successLight, borderRadius: 10, padding: 12 },
  messageText: { color: colors.success, fontWeight: '800', fontSize: 11 },
  blockTitle: { color: colors.text, fontWeight: '900', fontSize: 14, marginTop: 8 },
  blockHelp: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  weekdayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  weekdayChip: { minWidth: 112, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  weekdayChipActive: { backgroundColor: colors.dangerLight, borderColor: '#E8A9A7' },
  weekdayChipText: { color: colors.text, fontWeight: '900', fontSize: 11 },
  weekdayChipTextActive: { color: colors.danger },
  weekdayStatus: { color: colors.success, fontSize: 9, fontWeight: '800', marginTop: 3 },
  weekdayStatusActive: { color: colors.danger },
  weeklyActions: { alignItems: 'flex-start', marginTop: 12, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 18, marginBottom: 12 },
  monthButton: { width: 36, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  monthButtonText: { color: colors.text, fontWeight: '900', fontSize: 22 },
  monthTitle: { minWidth: 210, textAlign: 'center', color: colors.text, fontWeight: '900', fontSize: 17, textTransform: 'capitalize' },
  weekHeader: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  weekHeaderText: { width: '13.45%', textAlign: 'center', color: colors.muted, fontWeight: '900', fontSize: 9 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  calendarCell: { width: '13.45%', minHeight: 74 },
  calendarDate: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 8, backgroundColor: '#FFFFFF' },
  calendarDateClosed: { backgroundColor: colors.dangerLight, borderColor: '#E8A9A7' },
  calendarDateToday: { borderWidth: 2, borderColor: colors.primary },
  calendarNumber: { color: colors.text, fontWeight: '900', fontSize: 15 },
  calendarNumberClosed: { color: colors.danger },
  calendarStatus: { color: colors.success, fontSize: 8, fontWeight: '800', marginTop: 10 },
  calendarStatusClosed: { color: colors.danger },
  loadingText: { color: colors.muted, fontSize: 11, marginBottom: 10 },
  closureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6', flexWrap: 'wrap' },
  dateBadge: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  dateBadgeDay: { color: colors.danger, fontWeight: '900', fontSize: 16 },
  dateBadgeMonth: { color: colors.danger, fontWeight: '900', fontSize: 8 },
  closureReason: { color: colors.text, fontWeight: '900', fontSize: 12 },
  closureDate: { color: colors.muted, fontSize: 10, marginTop: 3, textTransform: 'capitalize' },
  closureNotes: { color: colors.text, fontSize: 10, marginTop: 4 },
  emptyText: { color: colors.muted, fontSize: 11, lineHeight: 18 },
  modalDate: { color: colors.primaryDark, fontWeight: '900', fontSize: 15, textTransform: 'capitalize', marginBottom: 14 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 10, flexWrap: 'wrap' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo: { width: 64, height: 64, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#FFFFFF', fontSize: 34 },
  name: { color: colors.text, fontWeight: '900', fontSize: 24, letterSpacing: 1.2 },
  corporation: { color: colors.primary, fontWeight: '900', fontSize: 9, letterSpacing: 4 },
  slogan: { color: colors.muted, fontWeight: '700', marginTop: 5 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 20, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.border },
  info: { flex: 1, minWidth: 190 },
  infoLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  infoValue: { color: colors.text, fontWeight: '800', fontSize: 12, marginTop: 5 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  avatar: { width: 39, height: 39, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 11 },
  userName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  userEmail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  warning: { borderWidth: 1, borderColor: '#F3C8C8', backgroundColor: '#FFF8F8', borderRadius: 13, padding: 15, gap: 8, alignItems: 'flex-start' },
  warningTitle: { color: colors.danger, fontWeight: '900' },
  warningText: { color: colors.text, lineHeight: 19, marginBottom: 4 },
});
