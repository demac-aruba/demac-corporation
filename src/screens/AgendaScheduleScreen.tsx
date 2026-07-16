import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { BusinessCalendarSettings, CalendarClosure, useCalendarState } from '../state/CalendarState';
import { useTeamState } from '../state/TeamState';
import { useVanHalfDayState, vanHasHalfDayOnDate } from '../state/VanHalfDayState';
import { colors } from '../theme';
import { Client, DailyVanAssignment, Property, StaffAbsence, StaffProfile, Van, WorkOrder } from '../types';

const MORNING_SLOTS = ['08:30', '09:30', '10:30'];
const EXTRA_SLOT = '11:30';
const AFTERNOON_SLOTS = ['13:30', '14:30', '15:30'];
const DISPLAY_SLOTS = [...MORNING_SLOTS, EXTRA_SLOT, ...AFTERNOON_SLOTS];
const INACTIVE_STATUSES = ['Cancelada', 'Completada', 'Facturada', 'Pagada'];

type AgendaVan = Van & {
  dispatchStatus: DailyVanAssignment['status'];
  driverStaffId?: string;
  helperStaffId?: string;
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function slotLabel(slot: string) {
  const [hour, minute] = slot.split(':').map(Number);
  const endHour = hour + 1;
  return `${slot}–${String(endHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function calendarStatus(date: string, settings: BusinessCalendarSettings, closures: CalendarClosure[]) {
  const closure = closures.find((item) => item.active !== false && item.date === date);
  if (closure) return { closed: true, reason: closure.reason };
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if ((settings.closedWeekdays ?? [0]).includes(weekday)) return { closed: true, reason: 'Día semanal cerrado' };
  return { closed: false, reason: '' };
}

function staffUnavailable(profile: StaffProfile | undefined, date: string, absences: StaffAbsence[]) {
  if (!profile || !profile.active || profile.availability === 'Inactivo') return true;
  const general = profile.availability !== 'Disponible'
    && (!profile.unavailableFrom || date >= profile.unavailableFrom)
    && (!profile.unavailableUntil || date <= profile.unavailableUntil);
  return general || absences.some((absence) => absence.active && absence.staffId === profile.id && date >= absence.fromDate && date <= absence.toDate);
}

function resolveAssignment(van: Van, date: string, profiles: StaffProfile[], assignments: DailyVanAssignment[], absences: StaffAbsence[]): AgendaVan {
  const saved = assignments.find((item) => item.vanId === van.id && item.date === date);
  const driver = profiles.find((profile) => profile.id === (saved?.driverStaffId ?? van.responsibleStaffId));
  const helper = profiles.find((profile) => profile.id === (saved?.helperStaffId ?? van.regularHelperId));
  const driverStaffId = driver?.canDriveVan && !staffUnavailable(driver, date, absences) ? driver.id : undefined;
  const helperStaffId = helper && !staffUnavailable(helper, date, absences) ? helper.id : undefined;
  let dispatchStatus: DailyVanAssignment['status'] = 'Disponible';
  if (van.active === false || van.status === 'Fuera de servicio' || saved?.status === 'Fuera de servicio') dispatchStatus = 'Fuera de servicio';
  else if (van.status === 'Mantenimiento' || saved?.status === 'Mantenimiento') dispatchStatus = 'Mantenimiento';
  else if (!driverStaffId || saved?.status === 'Sin personal') dispatchStatus = 'Sin personal';
  else if (!helperStaffId || saved?.status === 'Trabajo liviano') dispatchStatus = 'Trabajo liviano';
  return { ...van, driverStaffId, helperStaffId, technicianIds: [driverStaffId, helperStaffId].filter(Boolean) as string[], dispatchStatus };
}

function vanOperational(van: AgendaVan) {
  return van.active !== false && !!van.driverStaffId && !['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(van.dispatchStatus);
}

function orderDuration(order: WorkOrder) {
  return Math.max(1, Number(order.scheduledSlots ?? 1));
}

function orderSlots(order: WorkOrder, halfDay: boolean) {
  const duration = orderDuration(order);
  if (MORNING_SLOTS.includes(order.time) || order.time === EXTRA_SLOT) {
    const source = halfDay ? [...MORNING_SLOTS, EXTRA_SLOT] : MORNING_SLOTS;
    const index = source.indexOf(order.time);
    return index >= 0 ? source.slice(index, index + duration) : [order.time];
  }
  const index = AFTERNOON_SLOTS.indexOf(order.time);
  return index >= 0 ? AFTERNOON_SLOTS.slice(index, index + duration) : [order.time];
}

function bookableSequence(start: string, duration: number, halfDay: boolean) {
  const source = halfDay ? [...MORNING_SLOTS, EXTRA_SLOT] : MORNING_SLOTS.includes(start) ? MORNING_SLOTS : AFTERNOON_SLOTS;
  const index = source.indexOf(start);
  if (index < 0 || index + duration > source.length) return [];
  return source.slice(index, index + duration);
}

function clientName(client?: Client) {
  return client?.company || client?.name || 'Cliente';
}

export function AgendaScheduleScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1120;
  const {
    workOrders, clients, properties, addWorkOrder, updateWorkOrder,
    dataError, dataLoading, refreshOperationalData,
  } = useAppState();
  const {
    vans, staffProfiles, dailyVanAssignments, staffAbsences,
    teamLoading, teamDataError, refreshTeamData,
  } = useTeamState();
  const {
    calendarClosures, businessCalendarSettings, calendarLoading,
    calendarDataError, refreshCalendarData,
  } = useCalendarState();
  const { vanHalfDaySchedules, halfDayLoading, halfDayError, refreshVanHalfDays } = useVanHalfDayState();

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [vanId, setVanId] = useState('');
  const [time, setTime] = useState('08:30');
  const [duration, setDuration] = useState(1);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');

  const dayStatus = calendarStatus(selectedDate, businessCalendarSettings, calendarClosures);
  const agendaVans = useMemo(() => vans.filter((van) => van.active !== false).slice(0, 4)
    .map((van) => resolveAssignment(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences)),
  [vans, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences]);

  const dayOrders = useMemo(() => workOrders.filter((order) => order.date === selectedDate && !INACTIVE_STATUSES.includes(order.status))
    .sort((a, b) => a.time.localeCompare(b.time)), [workOrders, selectedDate]);

  const selectedClient = clients.find((client) => client.id === clientId);
  const clientProperties = properties.filter((property) => property.clientId === clientId && property.active !== false);
  const selectedProperty = clientProperties.find((property) => property.id === propertyId);
  const selectedVan = agendaVans.find((van) => van.id === vanId);
  const selectedOrder = dayOrders.find((order) => order.id === selectedOrderId);
  const combinedError = dataError ?? teamDataError ?? calendarDataError ?? halfDayError;

  const filteredClients = useMemo(() => {
    const needle = clientQuery.trim().toLowerCase();
    return clients.filter((client) => !needle || `${client.name} ${client.company ?? ''} ${client.phone} ${client.zone}`.toLowerCase().includes(needle)).slice(0, 10);
  }, [clients, clientQuery]);

  useEffect(() => {
    if (!clientId && clients[0]) setClientId(clients[0].id);
  }, [clients, clientId]);

  useEffect(() => {
    const available = properties.filter((property) => property.clientId === clientId && property.active !== false);
    if (!available.some((property) => property.id === propertyId)) setPropertyId(available[0]?.id ?? '');
  }, [clientId, properties, propertyId]);

  useEffect(() => {
    if (!agendaVans.some((van) => van.id === vanId)) setVanId(agendaVans.find(vanOperational)?.id ?? agendaVans[0]?.id ?? '');
  }, [agendaVans, vanId]);

  const isHalfDay = (candidateVanId: string, date = selectedDate) => vanHasHalfDayOnDate(candidateVanId, date, vanHalfDaySchedules);

  const isAvailable = (candidateVan: AgendaVan, start: string, requestedDuration = duration) => {
    if (dayStatus.closed || !vanOperational(candidateVan)) return false;
    const halfDay = isHalfDay(candidateVan.id);
    if (halfDay && AFTERNOON_SLOTS.includes(start)) return false;
    if (!halfDay && start === EXTRA_SLOT) return false;
    const sequence = bookableSequence(start, requestedDuration, halfDay);
    if (sequence.length !== requestedDuration) return false;
    return !dayOrders.some((order) => order.vanId === candidateVan.id
      && orderSlots(order, halfDay).some((slot) => sequence.includes(slot)));
  };

  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const candidateSlots = isHalfDay(selectedVan.id) ? [...MORNING_SLOTS, EXTRA_SLOT] : [...MORNING_SLOTS, ...AFTERNOON_SLOTS];
    setTime(candidateSlots.find((slot) => isAvailable(selectedVan, slot)) ?? '08:30');
  }, [selectedDate, selectedVan?.id, duration, dayOrders.length, vanHalfDaySchedules]);

  const openCreate = (candidateVanId?: string, candidateTime?: string) => {
    if (dayStatus.closed) return;
    setFormMessage('');
    setDescription('');
    setDuration(1);
    if (candidateVanId) setVanId(candidateVanId);
    if (candidateTime) setTime(candidateTime);
    setShowCreate(true);
  };

  const createOrder = async () => {
    const client = clients.find((item) => item.id === clientId);
    const van = agendaVans.find((item) => item.id === vanId);
    if (!client) return setFormMessage('Selecciona un cliente.');
    if (!van) return setFormMessage('Selecciona una van.');
    if (!description.trim()) return setFormMessage('Escribe la descripción del trabajo.');
    if (!isAvailable(van, time)) return setFormMessage('Ese horario no tiene suficientes cupos consecutivos o está bloqueado.');
    const now = new Date().toISOString();
    const order: WorkOrder = {
      id: `WO-${selectedDate.replaceAll('-', '').slice(2)}-${Date.now().toString().slice(-6)}`,
      clientId,
      propertyId: selectedProperty?.id,
      serviceId: '',
      date: selectedDate,
      time,
      status: van.technicianIds.length ? 'Asignada' : 'Confirmada',
      technicianIds: van.technicianIds,
      vanId: van.id,
      address: selectedProperty?.address ?? client.address,
      zone: selectedProperty?.zone ?? client.zone,
      problem: description.trim(),
      amount: 0,
      paid: 0,
      schedulingMode: 'fixed',
      scheduledSlots: duration,
      createdAt: now,
      updatedAt: now,
    };
    setSaving(true);
    const result = await addWorkOrder(order);
    setSaving(false);
    if (!result.ok) return setFormMessage(result.message ?? 'No se pudo guardar la cita.');
    setSelectedOrderId(order.id);
    setShowCreate(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle
        title="Agenda operativa"
        subtitle="Cupos por van, disponibilidad del equipo y tardes libres semanales. En el día de beneficio se habilita 11:30 a. m. y se bloquea la tarde completa."
        action={<Button label={dayStatus.closed ? 'Día cerrado' : 'Nueva cita'} disabled={dayStatus.closed} icon="＋" onPress={() => openCreate()} />}
      />

      {combinedError ? <View style={styles.errorBox}><Text style={styles.errorText}>{combinedError}</Text><Button compact variant="secondary" label="Reintentar" onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData(), refreshVanHalfDays()])} /></View> : null}
      {dayStatus.closed ? <View style={styles.closedBox}><Text style={styles.closedTitle}>Calendario cerrado</Text><Text style={styles.closedText}>{dayStatus.reason}. Las citas existentes permanecen visibles.</Text></View> : null}

      <Card style={styles.dateBar}>
        <Button compact variant="secondary" label="← Día anterior" onPress={() => setSelectedDate(shiftDate(selectedDate, -1))} />
        <View style={styles.dateCenter}>
          <Text style={styles.dateTitle}>{prettyDate(selectedDate)}</Text>
          <Text style={styles.dateHelp}>Horario normal: 3 cupos AM + 3 cupos PM · Día de beneficio: 4 cupos AM y tarde libre</Text>
        </View>
        <View style={styles.dateActions}>
          <Button compact variant="ghost" label="Hoy" onPress={() => setSelectedDate(localDateKey())} />
          <Button compact variant="secondary" label="Día siguiente →" onPress={() => setSelectedDate(shiftDate(selectedDate, 1))} />
        </View>
      </Card>

      {dataLoading || teamLoading || calendarLoading || halfDayLoading ? <Text style={styles.loading}>Sincronizando agenda y configuración…</Text> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.board}>
          {agendaVans.map((van) => {
            const halfDay = isHalfDay(van.id);
            const names = van.technicianIds.map((id) => staffProfiles.find((profile) => profile.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';
            return (
              <View key={van.id} style={styles.vanColumn}>
                <View style={styles.vanHeader}>
                  <View style={{ flex: 1 }}><Text style={styles.vanName}>🚐 {van.name}</Text><Text style={styles.vanTeam}>{names} · {van.dispatchStatus}</Text></View>
                  {halfDay ? <Pill label="Tarde libre" tone="danger" /> : <Pill label="Día regular" tone="success" />}
                </View>
                <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>MAÑANA</Text><Text style={styles.sectionCapacity}>{halfDay ? '4 cupos' : '3 cupos'}</Text></View>
                {DISPLAY_SLOTS.map((slot, index) => {
                  const afternoon = AFTERNOON_SLOTS.includes(slot);
                  if (index === 4) return (
                    <React.Fragment key={`${van.id}-afternoon-${slot}`}>
                      <View style={[styles.sectionHeader, styles.afternoonHeader]}><Text style={styles.sectionHeaderText}>TARDE</Text><Text style={styles.sectionCapacity}>{halfDay ? 'Libre' : '3 cupos'}</Text></View>
                      <AgendaSlot van={van} slot={slot} halfDay={halfDay} dayClosed={dayStatus.closed} orders={dayOrders} clients={clients} properties={properties} selectedOrderId={selectedOrderId} onSelect={setSelectedOrderId} onCreate={openCreate} />
                    </React.Fragment>
                  );
                  return <AgendaSlot key={`${van.id}-${slot}`} van={van} slot={slot} halfDay={halfDay} dayClosed={dayStatus.closed} orders={dayOrders} clients={clients} properties={properties} selectedOrderId={selectedOrderId} onSelect={setSelectedOrderId} onCreate={openCreate} />;
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.bottomGrid, compact && styles.bottomGridCompact]}>
        <Card style={styles.legendCard}>
          <Text style={styles.cardTitle}>Leyenda</Text>
          <Legend background={colors.successLight} label="Disponible" />
          <Legend background="#EAF3FF" label="Cita programada" />
          <Legend background={colors.dangerLight} label="Tarde libre / no disponible" />
          <Legend background={colors.warningLight} label="Conflicto que requiere reprogramación" />
        </Card>
        <Card style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Detalle seleccionado</Text>
          {selectedOrder ? (
            <>
              <Text style={styles.detailName}>{clientName(clients.find((client) => client.id === selectedOrder.clientId))}</Text>
              <Text style={styles.detailText}>{prettyDate(selectedOrder.date)} · {slotLabel(selectedOrder.time)} · {orderDuration(selectedOrder)} hora{orderDuration(selectedOrder) !== 1 ? 's' : ''}</Text>
              <Text style={styles.detailText}>{selectedOrder.address} · {selectedOrder.zone}</Text>
              <Text style={styles.detailDescription}>{selectedOrder.problem}</Text>
              <View style={styles.detailActions}><Pill label={selectedOrder.status} tone={statusTone(selectedOrder.status)} /><Button compact variant="success" label="Marcar completada" onPress={() => void updateWorkOrder(selectedOrder.id, { status: 'Completada', updatedAt: new Date().toISOString() })} /></View>
            </>
          ) : <Text style={styles.emptyText}>Selecciona una cita para ver sus detalles.</Text>}
        </Card>
      </View>

      <AppModal visible={showCreate} title="Confirmar nueva cita" onClose={() => !saving && setShowCreate(false)}>
        <ScrollView>
          {formMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{formMessage}</Text></View> : null}
          <Input label="Buscar cliente" value={clientQuery} onChangeText={setClientQuery} placeholder="Nombre, empresa, teléfono o zona" />
          <View style={styles.options}>{filteredClients.map((client) => <Choice key={client.id} label={`${clientName(client)} · ${client.phone} · ${client.zone}`} active={clientId === client.id} onPress={() => { setClientId(client.id); setClientQuery(''); }} />)}</View>

          <Text style={styles.fieldLabel}>Propiedad / dirección</Text>
          <View style={styles.options}>{clientProperties.map((property) => <Choice key={property.id} label={`${property.name} · ${property.address}`} active={propertyId === property.id} onPress={() => setPropertyId(property.id)} />)}</View>
          {!clientProperties.length && selectedClient ? <Text style={styles.emptyText}>Se usará la dirección principal del cliente.</Text> : null}

          <Text style={styles.fieldLabel}>Duración</Text>
          <View style={styles.options}>{[1, 2, 3, 4].map((hours) => <Choice key={hours} label={`${hours} hora${hours !== 1 ? 's' : ''}`} active={duration === hours} onPress={() => setDuration(hours)} />)}</View>

          <Text style={styles.fieldLabel}>Van</Text>
          <View style={styles.options}>{agendaVans.map((van) => <Choice key={van.id} label={`${van.name} · ${van.dispatchStatus}${isHalfDay(van.id) ? ' · tarde libre' : ''}`} active={vanId === van.id} disabled={!vanOperational(van)} onPress={() => setVanId(van.id)} />)}</View>

          <Text style={styles.fieldLabel}>Horario</Text>
          <View style={styles.options}>{DISPLAY_SLOTS.map((slot) => {
            const available = selectedVan ? isAvailable(selectedVan, slot) : false;
            return <Choice key={slot} label={`${slotLabel(slot)}${available ? '' : ' · no disponible'}`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />;
          })}</View>

          <Input label="Descripción del trabajo" value={description} onChangeText={setDescription} multiline placeholder="Servicios, diagnóstico, cantidad de equipos e instrucciones de acceso…" />
          <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowCreate(false)} /><Button label={saving ? 'Guardando…' : 'Crear cita'} disabled={saving} onPress={() => void createOrder()} /></View>
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function AgendaSlot({ van, slot, halfDay, dayClosed, orders, clients, properties, selectedOrderId, onSelect, onCreate }: {
  van: AgendaVan; slot: string; halfDay: boolean; dayClosed: boolean; orders: WorkOrder[]; clients: Client[]; properties: Property[];
  selectedOrderId: string; onSelect: (id: string) => void; onCreate: (vanId: string, slot: string) => void;
}) {
  const afternoon = AFTERNOON_SLOTS.includes(slot);
  const regularLunchSlot = slot === EXTRA_SLOT && !halfDay;
  const order = orders.find((item) => item.vanId === van.id && orderSlots(item, halfDay).includes(slot));
  const blocked = dayClosed || !vanOperational(van) || regularLunchSlot || (halfDay && afternoon);
  if (order) {
    const start = order.time === slot;
    const conflict = halfDay && afternoon;
    const client = clients.find((item) => item.id === order.clientId);
    const property = properties.find((item) => item.id === order.propertyId);
    return (
      <Pressable onPress={() => onSelect(order.id)} style={[styles.slot, styles.slotBooked, conflict && styles.slotConflict, selectedOrderId === order.id && styles.slotSelected]}>
        <View style={styles.slotTop}><Text style={styles.slotTime}>{slotLabel(slot)}</Text>{conflict ? <Pill label="Conflicto" tone="warning" /> : <Pill label={order.status} tone={statusTone(order.status)} />}</View>
        <Text style={styles.slotClient} numberOfLines={1}>{start ? clientName(client) : 'Continuación del trabajo'}</Text>
        <Text style={styles.slotAddress} numberOfLines={1}>{start ? (property?.address ?? order.address) : order.problem}</Text>
      </Pressable>
    );
  }
  if (blocked) {
    const reason = dayClosed ? 'Día cerrado' : !vanOperational(van) ? van.dispatchStatus : regularLunchSlot ? 'Preparación / almuerzo' : 'Tarde libre';
    return <View style={[styles.slot, styles.slotBlocked]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.blockedTitle}>{reason}</Text>{halfDay && afternoon ? <Text style={styles.blockedText}>Beneficio semanal de la van</Text> : null}</View>;
  }
  return <Pressable onPress={() => onCreate(van.id, slot)} style={[styles.slot, styles.slotAvailable]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.availableTitle}>Disponible</Text><Text style={styles.addMark}>＋</Text></Pressable>;
}

function Choice({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.choice, active && styles.choiceActive, disabled && styles.choiceDisabled]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function Legend({ background, label }: { background: string; label: string }) {
  return <View style={styles.legendRow}><View style={[styles.legendSwatch, { backgroundColor: background }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 26, gap: 16, paddingBottom: 96 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#E9AAA5' },
  errorText: { flex: 1, color: colors.danger, fontWeight: '800', fontSize: 11 },
  closedBox: { padding: 13, borderRadius: 8, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#E9AAA5' },
  closedTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  closedText: { color: colors.text, fontSize: 10, marginTop: 3 },
  dateBar: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateTitle: { color: colors.text, fontWeight: '900', fontSize: 15, textTransform: 'capitalize' },
  dateHelp: { color: colors.muted, fontSize: 9, marginTop: 3, textAlign: 'center' },
  dateActions: { flexDirection: 'row', gap: 7 },
  loading: { color: colors.muted, fontSize: 10 },
  board: { flexDirection: 'row', gap: 12, paddingBottom: 5 },
  vanColumn: { width: 292, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, backgroundColor: '#FFFFFF' },
  vanHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10 },
  vanName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  vanTeam: { color: colors.muted, fontSize: 9, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: colors.border },
  afternoonHeader: { marginTop: 8 },
  sectionHeaderText: { color: colors.muted, fontWeight: '900', fontSize: 9, letterSpacing: 0.8 },
  sectionCapacity: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  slot: { minHeight: 94, borderRadius: 8, padding: 10, marginBottom: 7, borderWidth: 1 },
  slotAvailable: { backgroundColor: colors.successLight, borderColor: '#B9DEC9' },
  slotBooked: { backgroundColor: '#EAF3FF', borderColor: '#A9C8F2' },
  slotBlocked: { backgroundColor: colors.dangerLight, borderColor: '#E9AAA5' },
  slotConflict: { backgroundColor: colors.warningLight, borderColor: '#D4A72C', borderWidth: 2 },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
  slotTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  slotTime: { color: colors.text, fontWeight: '900', fontSize: 10 },
  slotClient: { color: colors.text, fontWeight: '900', fontSize: 12, marginTop: 9 },
  slotAddress: { color: colors.muted, fontSize: 9, marginTop: 3 },
  availableTitle: { color: colors.success, fontWeight: '900', fontSize: 11, marginTop: 12 },
  addMark: { color: colors.success, fontSize: 20, position: 'absolute', right: 10, bottom: 8 },
  blockedTitle: { color: colors.danger, fontWeight: '900', fontSize: 11, marginTop: 12 },
  blockedText: { color: colors.danger, fontSize: 8, marginTop: 3 },
  bottomGrid: { flexDirection: 'row', gap: 14 },
  bottomGridCompact: { flexDirection: 'column' },
  legendCard: { width: 260, gap: 9 },
  detailsCard: { flex: 1 },
  cardTitle: { color: colors.text, fontWeight: '900', fontSize: 13, marginBottom: 7 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSwatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  legendText: { color: colors.muted, fontSize: 10 },
  detailName: { color: colors.text, fontWeight: '900', fontSize: 15 },
  detailText: { color: colors.muted, fontSize: 10, marginTop: 5 },
  detailDescription: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 10 },
  detailActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  emptyText: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  formError: { padding: 11, borderRadius: 7, backgroundColor: colors.dangerLight, marginBottom: 12 },
  formErrorText: { color: colors.danger, fontWeight: '800', fontSize: 10 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 13 },
  choice: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceDisabled: { opacity: 0.42, backgroundColor: '#F1F3F5' },
  choiceText: { color: colors.text, fontWeight: '700', fontSize: 10 },
  choiceTextActive: { color: '#FFFFFF' },
  fieldLabel: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 7 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 5 },
});
