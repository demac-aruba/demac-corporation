import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import {
  OfficeBookingOffer,
  OfficeBookingOption,
  OfficeBookingPreset,
  checkOfficeBookingAvailability,
  createOfficeAppointment,
  createOfficeBookingRequestId,
  listOfficeBookingPresets,
} from '../services/officeBookingAuthority';
import { useAppState } from '../state/AppState';
import { BusinessCalendarSettings, CalendarClosure, useCalendarState } from '../state/CalendarState';
import { useTeamState } from '../state/TeamState';
import { useVanHalfDayState, vanHasHalfDayOnDate } from '../state/VanHalfDayState';
import { colors } from '../theme';
import { Client, Property, Van, WorkOrder } from '../types';

const MORNING_SLOTS = ['08:30', '09:30', '10:30'];
const EXTRA_SLOT = '11:30';
const AFTERNOON_SLOTS = ['13:30', '14:30', '15:30'];
const DISPLAY_SLOTS = [...MORNING_SLOTS, EXTRA_SLOT, ...AFTERNOON_SLOTS];
const INACTIVE_STATUSES = ['Cancelada', 'Completada', 'Facturada', 'Pagada'];
const QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function slotLabel(slot: string, endTime?: string) {
  if (endTime) return `${slot}–${endTime}`;
  const [hour, minute] = slot.split(':').map(Number);
  return `${slot}–${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function calendarStatus(date: string, settings: BusinessCalendarSettings, closures: CalendarClosure[]) {
  const closure = closures.find((item) => item.active !== false && item.date === date);
  if (closure) return { closed: true, reason: closure.reason };
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if ((settings.closedWeekdays ?? [0]).includes(weekday)) return { closed: true, reason: 'Día semanal cerrado' };
  return { closed: false, reason: '' };
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

function clientName(client?: Client) {
  return client?.company || client?.name || 'Cliente';
}

function optionAssignmentLabel(option: OfficeBookingOption) {
  return option.assignments
    .map((assignment) => {
      const van = assignment.vanName || assignment.vanId || 'Van';
      const time = assignment.time || option.time;
      return `${van} · ${time} · ${assignment.quantity} ud.`;
    })
    .join('  +  ');
}

export function AgendaScheduleAuthorityScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1120;
  const {
    workOrders, clients, properties, updateWorkOrder,
    dataError, dataLoading, refreshOperationalData,
  } = useAppState();
  const { vans, teamLoading, teamDataError, refreshTeamData } = useTeamState();
  const {
    calendarClosures, businessCalendarSettings, calendarLoading,
    calendarDataError, refreshCalendarData,
  } = useCalendarState();
  const { vanHalfDaySchedules, halfDayLoading, halfDayError, refreshVanHalfDays } = useVanHalfDayState();

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [requestedTime, setRequestedTime] = useState('');
  const [description, setDescription] = useState('');
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [offer, setOffer] = useState<OfficeBookingOffer | null>(null);
  const [options, setOptions] = useState<OfficeBookingOption[]>([]);
  const [checking, setChecking] = useState(false);
  const [savingOptionId, setSavingOptionId] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [lastAppointmentId, setLastAppointmentId] = useState('');
  const [presetError, setPresetError] = useState('');

  const dayStatus = calendarStatus(selectedDate, businessCalendarSettings, calendarClosures);
  const agendaVans = useMemo(() => vans.filter((van) => van.active !== false).slice(0, 4), [vans]);
  const dayOrders = useMemo(() => workOrders
    .filter((order) => order.date === selectedDate && !INACTIVE_STATUSES.includes(order.status))
    .sort((a, b) => a.time.localeCompare(b.time)), [workOrders, selectedDate]);
  const selectedClient = clients.find((client) => client.id === clientId);
  const clientProperties = properties.filter((property) => property.clientId === clientId && property.active !== false);
  const selectedProperty = clientProperties.find((property) => property.id === propertyId);
  const selectedOrder = dayOrders.find((order) => order.id === selectedOrderId);
  const combinedError = dataError ?? teamDataError ?? calendarDataError ?? halfDayError;

  const filteredClients = useMemo(() => {
    const needle = clientQuery.trim().toLowerCase();
    return clients
      .filter((client) => !needle || `${client.name} ${client.company ?? ''} ${client.phone} ${client.zone}`.toLowerCase().includes(needle))
      .slice(0, 10);
  }, [clients, clientQuery]);

  useEffect(() => {
    let active = true;
    void listOfficeBookingPresets()
      .then((result) => {
        if (!active) return;
        const available = result.presets.filter((preset) => preset.active !== false);
        setPresets(available);
        setPresetId((current) => current || available[0]?.id || '');
        setPresetError('');
      })
      .catch((error) => {
        if (!active) return;
        setPresetError(error instanceof Error ? error.message : 'No se pudieron cargar los trabajos predeterminados.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!clientId && clients[0]) setClientId(clients[0].id);
  }, [clients, clientId]);

  useEffect(() => {
    const available = properties.filter((property) => property.clientId === clientId && property.active !== false);
    if (!available.some((property) => property.id === propertyId)) setPropertyId(available[0]?.id ?? '');
  }, [clientId, properties, propertyId]);

  const isHalfDay = (vanId: string, date = selectedDate) => vanHasHalfDayOnDate(vanId, date, vanHalfDaySchedules);

  const resetAuthorityResult = () => {
    setOffer(null);
    setOptions([]);
    setFormMessage('');
  };

  const openCreate = (preferredTime = '') => {
    if (dayStatus.closed) return;
    setRequestedTime(preferredTime);
    setDescription('');
    setTechnicianInstructions('');
    setQuantity(1);
    resetAuthorityResult();
    setShowCreate(true);
  };

  const checkAvailability = async () => {
    if (!selectedClient) return setFormMessage('Selecciona un cliente.');
    if (!selectedProperty) return setFormMessage('Este cliente necesita una propiedad registrada antes de agendar.');
    if (!presetId) return setFormMessage('Selecciona un trabajo predeterminado del ERP.');
    setChecking(true);
    setFormMessage('');
    setOffer(null);
    setOptions([]);
    try {
      const result = await checkOfficeBookingAvailability({
        requestId: createOfficeBookingRequestId('agenda-availability'),
        customerId: selectedClient.id,
        propertyId: selectedProperty.id,
        presetId,
        quantity,
        requestedDate: selectedDate,
        requestedTime,
        customerFacingDescription: description.trim(),
        technicianInstructions: technicianInstructions.trim(),
        notes: 'Solicitud creada desde Agenda ERP.',
      });
      setOffer(result.offer);
      setOptions(result.options || []);
      if (!result.available || !result.options?.length) {
        setFormMessage('Booking Authority no encontró capacidad válida para esa solicitud. Cambia fecha, horario o cantidad.');
      }
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : 'No se pudo consultar Booking Authority.');
    } finally {
      setChecking(false);
    }
  };

  const confirmOption = async (option: OfficeBookingOption) => {
    if (!offer?.id || !offer.version) return setFormMessage('La oferta de Booking Authority ya no es válida. Consulta disponibilidad nuevamente.');
    setSavingOptionId(option.id);
    setFormMessage('');
    try {
      const result = await createOfficeAppointment({
        requestId: `agenda-confirm:${offer.id}:${offer.version}:${option.id}`,
        offerId: offer.id,
        offerVersion: offer.version,
        optionId: option.id,
      });
      setLastAppointmentId(result.appointmentId);
      if (result.workOrderIds?.[0]) setSelectedOrderId(result.workOrderIds[0]);
      await refreshOperationalData();
      setShowCreate(false);
      setOffer(null);
      setOptions([]);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : 'No se pudo confirmar la cita.');
    } finally {
      setSavingOptionId('');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle
        title="Agenda operativa"
        subtitle="La cuadrícula muestra ocupación actual. Los espacios vacíos se consultan con Booking Authority antes de ofrecer o confirmar una cita."
        action={<Button label={dayStatus.closed ? 'Día cerrado' : 'Nueva cita'} disabled={dayStatus.closed} icon="＋" onPress={() => openCreate()} />}
      />

      {lastAppointmentId ? (
        <View style={styles.successBox}>
          <Text style={styles.successTitle}>Cita confirmada por Booking Authority</Text>
          <Text style={styles.successText}>Appointment ID: {lastAppointmentId}</Text>
        </View>
      ) : null}

      {combinedError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{combinedError}</Text>
          <Button compact variant="secondary" label="Reintentar" onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData(), refreshVanHalfDays()])} />
        </View>
      ) : null}
      {dayStatus.closed ? <View style={styles.closedBox}><Text style={styles.closedTitle}>Calendario cerrado</Text><Text style={styles.closedText}>{dayStatus.reason}. Las citas existentes permanecen visibles.</Text></View> : null}

      <Card style={styles.dateBar}>
        <Button compact variant="secondary" label="← Día anterior" onPress={() => setSelectedDate(shiftDate(selectedDate, -1))} />
        <View style={styles.dateCenter}>
          <Text style={styles.dateTitle}>{prettyDate(selectedDate)}</Text>
          <Text style={styles.dateHelp}>Los huecos verdes no son una promesa de disponibilidad: toca “Consultar” para pedir opciones reales a Booking Authority.</Text>
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
            return (
              <View key={van.id} style={styles.vanColumn}>
                <View style={styles.vanHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vanName}>🚐 {van.name}</Text>
                    <Text style={styles.vanTeam}>{van.status || 'Estado sin especificar'}</Text>
                  </View>
                  {halfDay ? <Pill label="Tarde libre" tone="danger" /> : <Pill label="Día regular" tone="success" />}
                </View>
                <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>MAÑANA</Text><Text style={styles.sectionCapacity}>{halfDay ? '4 bloques visuales' : '3 bloques visuales'}</Text></View>
                {DISPLAY_SLOTS.map((slot, index) => {
                  const slotElement = (
                    <AuthorityAgendaSlot
                      key={`${van.id}-${slot}`}
                      van={van}
                      slot={slot}
                      halfDay={halfDay}
                      dayClosed={dayStatus.closed}
                      orders={dayOrders}
                      clients={clients}
                      properties={properties}
                      selectedOrderId={selectedOrderId}
                      onSelect={setSelectedOrderId}
                      onConsult={openCreate}
                    />
                  );
                  if (index !== 4) return slotElement;
                  return (
                    <React.Fragment key={`${van.id}-afternoon-${slot}`}>
                      <View style={[styles.sectionHeader, styles.afternoonHeader]}><Text style={styles.sectionHeaderText}>TARDE</Text><Text style={styles.sectionCapacity}>{halfDay ? 'Libre' : '3 bloques visuales'}</Text></View>
                      {slotElement}
                    </React.Fragment>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.bottomGrid, compact && styles.bottomGridCompact]}>
        <Card style={styles.legendCard}>
          <Text style={styles.cardTitle}>Leyenda</Text>
          <Legend background={colors.successLight} label="Consultar autoridad" />
          <Legend background="#EAF3FF" label="Cita programada" />
          <Legend background={colors.dangerLight} label="Bloque no consultable" />
        </Card>
        <Card style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Detalle seleccionado</Text>
          {selectedOrder ? (
            <>
              <Text style={styles.detailName}>{clientName(clients.find((client) => client.id === selectedOrder.clientId))}</Text>
              <Text style={styles.detailText}>{prettyDate(selectedOrder.date)} · {slotLabel(selectedOrder.time)} · {orderDuration(selectedOrder)} bloque{orderDuration(selectedOrder) !== 1 ? 's' : ''}</Text>
              <Text style={styles.detailText}>{selectedOrder.address} · {selectedOrder.zone}</Text>
              <Text style={styles.detailDescription}>{selectedOrder.problem}</Text>
              <View style={styles.detailActions}>
                <Pill label={selectedOrder.status} tone={statusTone(selectedOrder.status)} />
                <Button compact variant="success" label="Marcar completada" onPress={() => void updateWorkOrder(selectedOrder.id, { status: 'Completada', updatedAt: new Date().toISOString() })} />
              </View>
            </>
          ) : <Text style={styles.emptyText}>Selecciona una cita para ver sus detalles.</Text>}
        </Card>
      </View>

      <AppModal visible={showCreate} title="Consultar y confirmar con Booking Authority" onClose={() => !checking && !savingOptionId && setShowCreate(false)}>
        <ScrollView>
          {formMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{formMessage}</Text></View> : null}
          {presetError ? <View style={styles.formError}><Text style={styles.formErrorText}>{presetError}</Text></View> : null}
          <Text style={styles.authorityNote}>La oficina no crea work orders directamente. La cita solo se confirma cuando Booking Authority devuelve un appointmentId real.</Text>

          <Input label="Buscar cliente" value={clientQuery} onChangeText={setClientQuery} placeholder="Nombre, empresa, teléfono o zona" />
          <View style={styles.options}>{filteredClients.map((client) => (
            <Choice key={client.id} label={`${clientName(client)} · ${client.phone} · ${client.zone}`} active={clientId === client.id} onPress={() => { setClientId(client.id); setClientQuery(''); resetAuthorityResult(); }} />
          ))}</View>

          <Text style={styles.fieldLabel}>Propiedad / dirección</Text>
          <View style={styles.options}>{clientProperties.map((property) => (
            <Choice key={property.id} label={`${property.name} · ${property.address}`} active={propertyId === property.id} onPress={() => { setPropertyId(property.id); resetAuthorityResult(); }} />
          ))}</View>
          {!clientProperties.length && selectedClient ? <Text style={styles.warningText}>Registra una propiedad para este cliente antes de agendar. Booking Authority no acepta una dirección inventada o implícita.</Text> : null}

          <Text style={styles.fieldLabel}>Trabajo predeterminado del ERP</Text>
          <View style={styles.options}>{presets.map((preset) => (
            <Choice key={preset.id} label={`${preset.label} · ${preset.durationMinutesPerUnit} min/unidad`} active={presetId === preset.id} onPress={() => { setPresetId(preset.id); resetAuthorityResult(); }} />
          ))}</View>

          <Text style={styles.fieldLabel}>Cantidad</Text>
          <View style={styles.options}>{QUANTITIES.map((value) => <Choice key={value} label={String(value)} active={quantity === value} onPress={() => { setQuantity(value); resetAuthorityResult(); }} />)}</View>

          <Text style={styles.fieldLabel}>Fecha solicitada</Text>
          <View style={styles.readOnlyBox}><Text style={styles.readOnlyText}>{prettyDate(selectedDate)}</Text></View>

          <Text style={styles.fieldLabel}>Horario solicitado</Text>
          <View style={styles.options}>
            <Choice label="Cualquier horario" active={!requestedTime} onPress={() => { setRequestedTime(''); resetAuthorityResult(); }} />
            {DISPLAY_SLOTS.map((slot) => <Choice key={slot} label={slotLabel(slot)} active={requestedTime === slot} onPress={() => { setRequestedTime(slot); resetAuthorityResult(); }} />)}
          </View>

          <Input label="Descripción para el cliente" value={description} onChangeText={(value) => { setDescription(value); resetAuthorityResult(); }} multiline placeholder="Ej. Servicio estándar de 2 aires acondicionados" />
          <Input label="Instrucciones para el técnico" value={technicianInstructions} onChangeText={(value) => { setTechnicianInstructions(value); resetAuthorityResult(); }} multiline placeholder="Acceso, contacto en sitio, observaciones internas…" />

          <View style={styles.searchActions}>
            <Button variant="secondary" label="Cancelar" disabled={checking || Boolean(savingOptionId)} onPress={() => setShowCreate(false)} />
            <Button label={checking ? 'Consultando…' : 'Buscar disponibilidad real'} disabled={checking || Boolean(savingOptionId) || !selectedProperty || !presetId} onPress={() => void checkAvailability()} />
          </View>

          {options.length ? (
            <View style={styles.authorityResults}>
              <Text style={styles.resultsTitle}>Opciones verificadas por Booking Authority</Text>
              <Text style={styles.resultsHelp}>La van mostrada es la asignación decidida por la autoridad según capacidad, personal y reglas operativas.</Text>
              {options.map((option) => (
                <View key={option.id} style={styles.optionCard}>
                  <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>{prettyDate(option.date)} · {slotLabel(option.time, option.endTime)}</Text>
                    <Text style={styles.optionText}>{option.presetLabel || presetId} · {option.quantity || quantity} unidad{(option.quantity || quantity) !== 1 ? 'es' : ''}</Text>
                    <Text style={styles.optionText}>{optionAssignmentLabel(option)}</Text>
                    {option.address ? <Text style={styles.optionText}>{option.address}</Text> : null}
                  </View>
                  <Button compact label={savingOptionId === option.id ? 'Confirmando…' : 'Confirmar esta opción'} disabled={Boolean(savingOptionId) || checking} onPress={() => void confirmOption(option)} />
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function AuthorityAgendaSlot({ van, slot, halfDay, dayClosed, orders, clients, properties, selectedOrderId, onSelect, onConsult }: {
  van: Van;
  slot: string;
  halfDay: boolean;
  dayClosed: boolean;
  orders: WorkOrder[];
  clients: Client[];
  properties: Property[];
  selectedOrderId: string;
  onSelect: (id: string) => void;
  onConsult: (time: string) => void;
}) {
  const afternoon = AFTERNOON_SLOTS.includes(slot);
  const regularLunchSlot = slot === EXTRA_SLOT && !halfDay;
  const order = orders.find((item) => item.vanId === van.id && orderSlots(item, halfDay).includes(slot));
  const blocked = dayClosed || regularLunchSlot || (halfDay && afternoon) || van.active === false || ['Mantenimiento', 'Fuera de servicio'].includes(String(van.status || ''));
  if (order) {
    const start = order.time === slot;
    const client = clients.find((item) => item.id === order.clientId);
    const property = properties.find((item) => item.id === order.propertyId);
    return (
      <Pressable onPress={() => onSelect(order.id)} style={[styles.slot, styles.slotBooked, selectedOrderId === order.id && styles.slotSelected]}>
        <View style={styles.slotTop}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Pill label={order.status} tone={statusTone(order.status)} /></View>
        <Text style={styles.slotClient} numberOfLines={1}>{start ? clientName(client) : 'Continuación del trabajo'}</Text>
        <Text style={styles.slotAddress} numberOfLines={1}>{start ? (property?.address ?? order.address) : order.problem}</Text>
      </Pressable>
    );
  }
  if (blocked) {
    const reason = dayClosed ? 'Día cerrado' : regularLunchSlot ? 'Preparación / almuerzo' : halfDay && afternoon ? 'Tarde libre' : String(van.status || 'Van no operativa');
    return <View style={[styles.slot, styles.slotBlocked]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.blockedTitle}>{reason}</Text></View>;
  }
  return (
    <Pressable onPress={() => onConsult(slot)} style={[styles.slot, styles.slotConsult]}>
      <Text style={styles.slotTime}>{slotLabel(slot)}</Text>
      <Text style={styles.consultTitle}>Consultar</Text>
      <Text style={styles.consultText}>Booking Authority decide disponibilidad y van</Text>
      <Text style={styles.addMark}>＋</Text>
    </Pressable>
  );
}

function Choice({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.choice, active && styles.choiceActive, disabled && styles.choiceDisabled]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function Legend({ background, label }: { background: string; label: string }) {
  return <View style={styles.legendRow}><View style={[styles.legendSwatch, { backgroundColor: background }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 26, gap: 16, paddingBottom: 96 },
  successBox: { padding: 13, borderRadius: 8, backgroundColor: colors.successLight, borderWidth: 1, borderColor: '#B9DEC9' },
  successTitle: { color: colors.success, fontWeight: '900', fontSize: 12 },
  successText: { color: colors.text, fontSize: 10, marginTop: 4, fontWeight: '800' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#E9AAA5' },
  errorText: { flex: 1, color: colors.danger, fontWeight: '800', fontSize: 11 },
  closedBox: { padding: 13, borderRadius: 8, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#E9AAA5' },
  closedTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  closedText: { color: colors.text, fontSize: 10, marginTop: 3 },
  dateBar: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateTitle: { color: colors.text, fontWeight: '900', fontSize: 15, textTransform: 'capitalize' },
  dateHelp: { color: colors.muted, fontSize: 9, marginTop: 3, textAlign: 'center', maxWidth: 620 },
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
  slotConsult: { backgroundColor: colors.successLight, borderColor: '#B9DEC9' },
  slotBooked: { backgroundColor: '#EAF3FF', borderColor: '#A9C8F2' },
  slotBlocked: { backgroundColor: colors.dangerLight, borderColor: '#E9AAA5' },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
  slotTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  slotTime: { color: colors.text, fontWeight: '900', fontSize: 10 },
  slotClient: { color: colors.text, fontWeight: '900', fontSize: 12, marginTop: 9 },
  slotAddress: { color: colors.muted, fontSize: 9, marginTop: 3 },
  consultTitle: { color: colors.success, fontWeight: '900', fontSize: 11, marginTop: 10 },
  consultText: { color: colors.muted, fontSize: 8, marginTop: 3, paddingRight: 26 },
  addMark: { color: colors.success, fontSize: 20, position: 'absolute', right: 10, bottom: 8 },
  blockedTitle: { color: colors.danger, fontWeight: '900', fontSize: 11, marginTop: 12 },
  bottomGrid: { flexDirection: 'row', gap: 14 },
  bottomGridCompact: { flexDirection: 'column' },
  legendCard: { width: 260, gap: 9 },
  detailsCard: { flex: 1 },
  cardTitle: { color: colors.text, fontWeight: '900', fontSize: 13, marginBottom: 7 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  legendSwatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  legendText: { color: colors.text, fontSize: 10 },
  detailName: { color: colors.text, fontWeight: '900', fontSize: 14 },
  detailText: { color: colors.muted, fontSize: 10, marginTop: 4 },
  detailDescription: { color: colors.text, fontSize: 11, marginTop: 9 },
  detailActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  emptyText: { color: colors.muted, fontSize: 10, marginTop: 5 },
  warningText: { color: colors.danger, fontSize: 9, fontWeight: '700', marginBottom: 10 },
  fieldLabel: { color: colors.text, fontSize: 10, fontWeight: '900', marginTop: 14, marginBottom: 6 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  choice: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' },
  choiceActive: { borderColor: colors.primary, backgroundColor: '#EAF3FF' },
  choiceDisabled: { opacity: 0.35 },
  choiceText: { color: colors.text, fontSize: 9, fontWeight: '700' },
  choiceTextActive: { color: colors.primaryDark, fontWeight: '900' },
  formError: { padding: 10, borderRadius: 7, backgroundColor: colors.dangerLight, marginBottom: 10 },
  formErrorText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  authorityNote: { color: colors.text, fontSize: 10, lineHeight: 16, backgroundColor: '#EEF5FF', borderWidth: 1, borderColor: '#B9D2F3', borderRadius: 8, padding: 10, marginBottom: 12 },
  readOnlyBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, padding: 10, backgroundColor: '#F7F8FA' },
  readOnlyText: { color: colors.text, fontWeight: '800', fontSize: 10, textTransform: 'capitalize' },
  searchActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16, marginBottom: 10 },
  authorityResults: { gap: 9, marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  resultsTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  resultsHelp: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  optionCard: { borderWidth: 1, borderColor: '#B9D2F3', backgroundColor: '#F7FAFF', borderRadius: 9, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionCopy: { flex: 1 },
  optionTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 11, textTransform: 'capitalize' },
  optionText: { color: colors.text, fontSize: 9, marginTop: 3 },
});
