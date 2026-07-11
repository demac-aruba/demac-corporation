from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing source fragment for {label}: {old[:120]!r}')
    return text.replace(old, new, 1)

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')

if "useCalendarState" not in text:
    text = replace_once(
        text,
        "import { useAppState } from '../state/AppState';\n",
        "import { useAppState } from '../state/AppState';\nimport { BusinessCalendarSettings, CalendarClosure, useCalendarState } from '../state/CalendarState';\n",
        'calendar import',
    )

if 'function calendarDateStatus' not in text:
    helper = """
function calendarDateStatus(date: string, settings: BusinessCalendarSettings, closures: CalendarClosure[]) {
  const closure = closures.find((item) => item.active !== false && item.date === date);
  if (closure) return { closed: true, reason: closure.reason };
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if ((settings.closedWeekdays ?? [0]).includes(weekday)) return { closed: true, reason: weekdaysLabel(weekday) };
  return { closed: false, reason: '' };
}

function weekdaysLabel(value: number) {
  return ['Domingo cerrado', 'Lunes cerrado', 'Martes cerrado', 'Miércoles cerrado', 'Jueves cerrado', 'Viernes cerrado', 'Sábado cerrado'][value] ?? 'Día cerrado';
}

"""
    text = replace_once(text, 'export function AgendaScreen() {', helper + 'export function AgendaScreen() {', 'calendar helpers')

if 'calendarClosures, businessCalendarSettings' not in text:
    text = replace_once(
        text,
        "  const { vans: teamVans, staffProfiles, dailyVanAssignments, staffAbsences, teamLoading, teamDataError, refreshTeamData } = useTeamState();\n",
        "  const { vans: teamVans, staffProfiles, dailyVanAssignments, staffAbsences, teamLoading, teamDataError, refreshTeamData } = useTeamState();\n  const { calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData } = useCalendarState();\n",
        'calendar hook',
    )

if 'selectedCalendarStatus' not in text:
    text = replace_once(
        text,
        "  const monthTitle = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });\n  const combinedDataError = teamDataError ?? dataError;",
        "  const monthTitle = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });\n  const selectedCalendarStatus = calendarDateStatus(selectedDate, businessCalendarSettings, calendarClosures);\n  const selectedDateClosed = selectedCalendarStatus.closed;\n  const combinedDataError = calendarDataError ?? teamDataError ?? dataError;",
        'selected closure',
    )

if 'calendarDateStatus(date, businessCalendarSettings' not in text:
    text = replace_once(
        text,
        "  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {\n    if (!vanCanReceiveAppointments(candidateVan)) return false;",
        "  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {\n    if (calendarDateStatus(date, businessCalendarSettings, calendarClosures).closed) return false;\n    if (!vanCanReceiveAppointments(candidateVan)) return false;",
        'availability closure',
    )

if 'if (selectedDateClosed) return;' not in text:
    text = replace_once(
        text,
        "  const openCreate = (candidateVanId?: string, candidateTime?: string) => {\n    clearDataError();",
        "  const openCreate = (candidateVanId?: string, candidateTime?: string) => {\n    if (selectedDateClosed) return;\n    clearDataError();",
        'open create closure',
    )

if 'No se pueden crear citas:' not in text:
    text = replace_once(
        text,
        "    const description = workDescriptionText.trim();\n    if (!client) return setFormMessage('Primero selecciona o registra un cliente.');",
        "    const description = workDescriptionText.trim();\n    if (selectedDateClosed) return setFormMessage(`No se pueden crear citas: ${selectedCalendarStatus.reason}.`);\n    if (!client) return setFormMessage('Primero selecciona o registra un cliente.');",
        'create order closure',
    )

text = text.replace(
    'onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData()])}',
    'onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData()])}',
)

if "label={selectedDateClosed ? 'Día cerrado'" not in text:
    text = replace_once(
        text,
        "        action={<Button label=\"Nueva cita\" icon=\"＋\" onPress={() => openCreate()} />}\n      />\n\n      <Card>",
        "        action={<Button label={selectedDateClosed ? 'Día cerrado' : 'Nueva cita'} icon={selectedDateClosed ? '🔒' : '＋'} disabled={selectedDateClosed} onPress={() => openCreate()} />}\n      />\n\n      {selectedDateClosed ? <View style={styles.closedBanner}><View><Text style={styles.closedTitle}>Calendario cerrado para esta fecha</Text><Text style={styles.closedText}>{selectedCalendarStatus.reason}. Las citas existentes permanecen visibles, pero no se pueden crear citas nuevas.</Text></View></View> : null}\n\n      <Card>",
        'closed banner',
    )

old_calendar = """            <View style={styles.calendarGrid}>{days.map((date) => {
              const active = date === selectedDate;
              const dateObj = new Date(`${date}T12:00:00`);
              return <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.calendarDay, active && styles.calendarDayActive]}><Text style={[styles.calendarWeekday, active && styles.calendarDayTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).slice(0, 2)}</Text><Text style={[styles.calendarNumber, active && styles.calendarDayTextActive]}>{dateObj.getDate()}</Text></Pressable>;
            })}</View>"""
new_calendar = """            <View style={styles.calendarGrid}>{days.map((date) => {
              const active = date === selectedDate;
              const dateObj = new Date(`${date}T12:00:00`);
              const dateStatus = calendarDateStatus(date, businessCalendarSettings, calendarClosures);
              return <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.calendarDay, dateStatus.closed && styles.calendarDayClosed, active && styles.calendarDayActive]}><Text style={[styles.calendarWeekday, active && styles.calendarDayTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).slice(0, 2)}</Text><Text style={[styles.calendarNumber, active && styles.calendarDayTextActive]}>{dateObj.getDate()}</Text>{dateStatus.closed ? <Text style={[styles.calendarClosedLabel, active && styles.calendarDayTextActive]}>Cerrado</Text> : null}</Pressable>;
            })}</View>"""
if old_calendar in text:
    text = text.replace(old_calendar, new_calendar, 1)

text = text.replace(
    '{dataLoading || teamLoading ? <Text style={styles.syncText}>Sincronizando agenda y equipo…</Text> : null}',
    '{dataLoading || teamLoading || calendarLoading ? <Text style={styles.syncText}>Sincronizando agenda, equipo y calendario…</Text> : null}',
)

if 'closedReason={selectedDateClosed' not in text:
    text = text.replace(
        'onCreate={(slot) => openCreate(van.id, slot)} />',
        'onCreate={(slot) => openCreate(van.id, slot)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />',
    )

old_signature = "function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate }: { van: AgendaVan; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {"
new_signature = "function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, closedReason }: { van: AgendaVan; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void; closedReason?: string }) {"
if old_signature in text:
    text = text.replace(old_signature, new_signature, 1)

if 'if (closedReason) return' not in text:
    text = replace_once(
        text,
        "          if (!vanCanReceiveAppointments(van)) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{unavailableReason}</Text></View>;",
        "          if (closedReason) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Cerrado</Text><Text style={styles.closedSlotReason} numberOfLines={2}>{closedReason}</Text></View>;\n          if (!vanCanReceiveAppointments(van)) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{unavailableReason}</Text></View>;",
        'closed slot',
    )

if 'closedBanner:' not in text:
    text = replace_once(
        text,
        "  errorText: { color: colors.text, fontSize: 11, marginTop: 3 },",
        "  errorText: { color: colors.text, fontSize: 11, marginTop: 3 },\n  closedBanner: { borderWidth: 1, borderColor: '#E8A9A7', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 14 },\n  closedTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },\n  closedText: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },",
        'closed banner styles',
    )
if 'calendarDayClosed:' not in text:
    text = replace_once(
        text,
        "  calendarDayActive: { backgroundColor: colors.primary },",
        "  calendarDayClosed: { backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#E8A9A7' },\n  calendarDayActive: { backgroundColor: colors.primary },",
        'closed calendar style',
    )
if 'calendarClosedLabel:' not in text:
    text = replace_once(
        text,
        "  calendarDayTextActive: { color: '#FFFFFF' },",
        "  calendarDayTextActive: { color: '#FFFFFF' },\n  calendarClosedLabel: { color: colors.danger, fontSize: 7, fontWeight: '900', marginTop: 2 },",
        'closed calendar label',
    )
if 'closedSlotReason:' not in text:
    text = replace_once(
        text,
        "  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 11, marginTop: 13 },",
        "  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 11, marginTop: 13 },\n  closedSlotReason: { color: colors.muted, fontSize: 9, lineHeight: 12, marginTop: 5, textAlign: 'center' },",
        'closed slot reason style',
    )

path.write_text(text, encoding='utf-8')

rules = Path('firestore.rules')
rules_text = rules.read_text(encoding='utf-8')
if 'match /calendarClosures/{closureId}' not in rules_text:
    marker = "    match /workOrders/{workOrderId} {\n"
    block = """    match /calendarClosures/{closureId} {
      allow read, create, update, delete: if operationsRole();
    }

    match /businessSettings/{settingId} {
      allow read, create, update: if operationsRole();
      allow delete: if adminOrSupervisor();
    }

"""
    rules_text = replace_once(rules_text, marker, block + marker, 'firestore calendar rules')
rules.write_text(rules_text, encoding='utf-8')
