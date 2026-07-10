import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { AppointmentStatus, ServiceType, Van, WorkOrder } from '../types';

const morningSlots = ['08:30', '09:30', '10:30'];
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const statusOptions: AppointmentStatus[] = ['Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada', 'Reprogramada', 'Cancelada'];

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

function addDays(date: string, amount: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + amount);
  return next.toISOString().slice(0, 10);
}

function durationInSlots(service?: ServiceType) {
  return Math.max(1, Math.min(3, Math.ceil((service?.durationMinutes ?? 60) / 60)));
}

function slotIndex(time: string) {
  return allSlots.indexOf(time);
}

function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[]) {
  const start = slotIndex(order.time);
  const target = slotIndex(slot);
  if (start < 0 || target < 0) return false;
  const service = services.find((item) => item.id === order.serviceId);
  return target >= start && target < start + durationInSlots(service);
}

export function AgendaScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1050;
  const { workOrders, clients, services, vans, users, addWorkOrder, updateWorkOrder } = useAppState();
  const [selectedDate, setSelectedDate] = useState('2026-07-08');
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [problem, setProblem] = useState('');
  const [vanId, setVanId] = useState(vans[0]?.id ?? '');
  const [time, setTime] = useState('08:30');

  const days = useMemo(() => Array.from({ length: 8 }, (_, index) => addDays('2026-07-08', index)), []);
  const orders = useMemo(
    () => workOrders.filter((order) => order.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)),
    [workOrders, selectedDate],
  );
  const selectedService = services.find((item) => item.id === serviceId);
  const selectedVan = vans.find((item) => item.id === vanId);
  const requiredSlots = durationInSlots(selectedService);

  const isAvailable = (candidateVan: Van, candidateTime: string, date = selectedDate) => {
    if (candidateVan.status === 'Mantenimiento') return false;
    const start = slotIndex(candidateTime);
    if (start < 0 || start + requiredSlots > allSlots.length) return false;
    if (start < morningSlots.length && start + requiredSlots > morningSlots.length) return false;
    const candidateSlots = allSlots.slice(start, start + requiredSlots);
    return !workOrders.some((order) => order.date === date && order.vanId === candidateVan.id && candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services)));
  };

  const nextAvailableDates = useMemo(() => {
    const dates: string[] = [];
    for (let offset = 1; offset <= 14 && dates.length < 4; offset += 1) {
      const date = addDays(selectedDate, offset);
      if (vans.some((van) => allSlots.some((slot) => isAvailable(van, slot, date)))) dates.push(date);
    }
    return dates;
  }, [selectedDate, requiredSlots, workOrders, vans]);

  const createOrder = () => {
    const client = clients.find((item) => item.id === clientId);
    const service = services.find((item) => item.id === serviceId);
    const van = vans.find((item) => item.id === vanId);
    if (!client || !service || !van || !problem.trim() || !isAvailable(van, time)) return;
    const order: WorkOrder = {
      id: `WO-${selectedDate.replaceAll('-', '').slice(2)}-${String(workOrders.length + 1).padStart(3, '0')}`,
      clientId,
      serviceId,
      date: selectedDate,
      time,
      status: van.technicianIds.length ? 'Asignada' : 'Confirmada',
      technicianIds: van.technicianIds,
      vanId,
      address: client.address,
      problem: problem.trim(),
      amount: service.basePrice,
      paid: 0,
    };
    addWorkOrder(order);
    setProblem('');
    setShowCreate(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle
        title="Agenda"
        subtitle="Planifica el día por van, disponibilidad y duración del servicio."
        action={<Button label="Nueva cita" icon="＋" onPress={() => setShowCreate(true)} />}
      />

      <Card>
        <View style={styles.toolbar}>
          <View>
            <Text style={styles.eyebrow}>CALENDARIO OPERATIVO</Text>
            <Text style={styles.toolbarTitle}>{formatDate(selectedDate)}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
            {days.map((date) => {
              const active = date === selectedDate;
              const dateObj = new Date(`${date}T12:00:00`);
              return (
                <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dateChip, active && styles.dateChipActive]}>
                  <Text style={[styles.dateWeekday, active && styles.dateTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).toUpperCase()}</Text>
                  <Text style={[styles.dateNumber, active && styles.dateTextActive]}>{dateObj.getDate()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Card>

      <Card style={styles.scheduleCard}>
        <View style={styles.scheduleHeader}>
          <View>
            <Text style={styles.scheduleTitle}>Disponibilidad de vans</Text>
            <Text style={styles.scheduleSubtitle}>3 citas en la mañana · Almuerzo 12:00–13:00 · 3 citas en la tarde</Text>
          </View>
          <View style={styles.legend}><View style={styles.legendDot} /><Text style={styles.legendText}>Disponible</Text><View style={[styles.legendDot, styles.legendBusy]} /><Text style={styles.legendText}>Ocupado</Text></View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: compact ? 980 : '100%' }}>
            <View style={styles.gridHeader}>
              <View style={styles.vanHeader}><Text style={styles.headerText}>VAN / EQUIPO</Text></View>
              {morningSlots.map((slot) => <View key={slot} style={styles.slotHeader}><Text style={styles.headerText}>{slot}</Text><Text style={styles.headerSub}>AM</Text></View>)}
              <View style={styles.lunchHeader}><Text style={styles.lunchText}>ALMUERZO</Text></View>
              {afternoonSlots.map((slot) => <View key={slot} style={styles.slotHeader}><Text style={styles.headerText}>{slot}</Text><Text style={styles.headerSub}>PM</Text></View>)}
            </View>

            {vans.slice(0, 4).map((van) => {
              const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ');
              return (
                <View key={van.id} style={styles.gridRow}>
                  <View style={styles.vanCell}>
                    <View style={styles.vanBadge}><Text style={styles.vanBadgeText}>{van.name.replace(/\D/g, '') || van.name.slice(-1)}</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.vanName}>{van.name}</Text><Text style={styles.techNames}>{techNames || 'Sin equipo asignado'}</Text></View>
                    <Pill label={van.status} tone={van.status === 'Disponible' ? 'green' : van.status === 'Mantenimiento' ? 'red' : 'blue'} />
                  </View>
                  {morningSlots.map((slot) => <ScheduleCell key={`${van.id}-${slot}`} van={van} slot={slot} orders={orders} services={services} clients={clients} onCreate={() => { setVanId(van.id); setTime(slot); setShowCreate(true); }} />)}
                  <View style={styles.lunchCell}><Text style={styles.lunchIcon}>☕</Text></View>
                  {afternoonSlots.map((slot) => <ScheduleCell key={`${van.id}-${slot}`} van={van} slot={slot} orders={orders} services={services} clients={clients} onCreate={() => { setVanId(van.id); setTime(slot); setShowCreate(true); }} />)}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </Card>

      <Card>
        <SectionTitle title={`Citas del día (${orders.length})`} subtitle="Actualiza el estado sin salir de la agenda." />
        {orders.length === 0 ? <Text style={styles.emptyText}>No hay citas programadas para este día.</Text> : orders.map((order) => {
          const client = clients.find((item) => item.id === order.clientId);
          const service = services.find((item) => item.id === order.serviceId);
          const van = vans.find((item) => item.id === order.vanId);
          return (
            <View key={order.id} style={styles.orderRow}>
              <View style={styles.timeBlock}><Text style={styles.timeText}>{order.time}</Text><Text style={styles.durationText}>{durationInSlots(service)} cupo{durationInSlots(service) > 1 ? 's' : ''}</Text></View>
              <View style={styles.orderInfo}><Text style={styles.clientName}>{client?.name}</Text><Text style={styles.orderMeta}>{service?.name} · {van?.name}</Text><Text style={styles.orderAddress}>{order.address}</Text></View>
              <View style={styles.statusArea}><Pill label={order.status} tone={statusTone(order.status)} /><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.statusActions}>{statusOptions.filter((status) => status !== order.status).slice(0, 4).map((status) => <Pressable key={status} onPress={() => updateWorkOrder(order.id, { status })} style={styles.statusButton}><Text style={styles.statusButtonText}>{status}</Text></Pressable>)}</View></ScrollView></View>
            </View>
          );
        })}
      </Card>

      <AppModal visible={showCreate} title="Nueva cita" onClose={() => setShowCreate(false)}>
        <ScrollView>
          <Text style={styles.modalIntro}>Selecciona cliente, servicio, van y un cupo disponible. El equipo técnico se asigna automáticamente según la van.</Text>
          <Text style={styles.fieldLabel}>Cliente</Text>
          <View style={styles.optionWrap}>{clients.map((client) => <Option key={client.id} label={client.name} active={clientId === client.id} onPress={() => setClientId(client.id)} />)}</View>
          <Text style={styles.fieldLabel}>Servicio</Text>
          <View style={styles.optionWrap}>{services.map((service) => <Option key={service.id} label={`${service.name} · ${durationInSlots(service)} cupo${durationInSlots(service) > 1 ? 's' : ''}`} active={serviceId === service.id} onPress={() => setServiceId(service.id)} />)}</View>
          <Text style={styles.fieldLabel}>Van y equipo</Text>
          <View style={styles.optionWrap}>{vans.slice(0, 4).map((van) => { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />; })}</View>
          <Text style={styles.fieldLabel}>Hora disponible</Text>
          <View style={styles.optionWrap}>{allSlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slot : `${slot} · Ocupado`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>
          {selectedVan && !allSlots.some((slot) => isAvailable(selectedVan, slot)) ? <View style={styles.noAvailability}><Text style={styles.noAvailabilityTitle}>No hay espacio para esta van en el día seleccionado.</Text><Text style={styles.noAvailabilityText}>Próximas fechas con disponibilidad:</Text><View style={styles.optionWrap}>{nextAvailableDates.map((date) => <Option key={date} label={formatDate(date)} active={false} onPress={() => setSelectedDate(date)} />)}</View></View> : null}
          <Input label="Problema reportado / instrucciones" value={problem} onChangeText={setProblem} multiline placeholder="Describe el trabajo solicitado…" />
          <View style={styles.summaryBox}><Text style={styles.summaryTitle}>Resumen de asignación</Text><Text style={styles.summaryLine}>{selectedService?.name} · {requiredSlots} cupo{requiredSlots > 1 ? 's' : ''}</Text><Text style={styles.summaryLine}>{selectedVan?.name} · {selectedVan?.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo'}</Text><Text style={styles.summaryLine}>{formatDate(selectedDate)} · {time}</Text></View>
          <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowCreate(false)} /><Button label="Guardar cita" onPress={createOrder} /></View>
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function ScheduleCell({ van, slot, orders, services, clients, onCreate }: { van: Van; slot: string; orders: WorkOrder[]; services: ServiceType[]; clients: { id: string; name: string }[]; onCreate: () => void }) {
  const order = orders.find((item) => item.vanId === van.id && orderOccupiesSlot(item, slot, services));
  if (!order) return <Pressable onPress={onCreate} style={styles.freeCell}><Text style={styles.plus}>＋</Text><Text style={styles.freeText}>Disponible</Text></Pressable>;
  const service = services.find((item) => item.id === order.serviceId);
  const client = clients.find((item) => item.id === order.clientId);
  const isStart = order.time === slot;
  return <View style={[styles.busyCell, !isStart && styles.continuationCell]}>{isStart ? <><Text style={styles.busyClient} numberOfLines={1}>{client?.name}</Text><Text style={styles.busyService} numberOfLines={2}>{service?.name}</Text><Text style={styles.busyStatus}>{order.status}</Text></> : <Text style={styles.continuationText}>Continúa</Text>}</View>;
}

function Option({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.option, active && styles.optionActive, disabled && styles.optionDisabled]}><Text style={[styles.optionText, active && styles.optionTextActive, disabled && styles.optionTextDisabled]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  toolbarTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 4, textTransform: 'capitalize' },
  dateRow: { gap: 8 },
  dateChip: { width: 58, minHeight: 58, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  dateChipActive: { backgroundColor: '#2CA01C', borderColor: '#2CA01C' },
  dateWeekday: { color: colors.muted, fontWeight: '800', fontSize: 9 },
  dateNumber: { color: colors.text, fontWeight: '900', fontSize: 19, marginTop: 2 },
  dateTextActive: { color: '#FFFFFF' },
  scheduleCard: { padding: 0, overflow: 'hidden' },
  scheduleHeader: { paddingHorizontal: 20, paddingVertical: 17, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: colors.border },
  scheduleTitle: { color: colors.text, fontWeight: '900', fontSize: 17 },
  scheduleSubtitle: { color: colors.muted, fontSize: 11, marginTop: 4 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#DDF5D8', borderWidth: 1, borderColor: '#2CA01C' },
  legendBusy: { backgroundColor: '#DCEBFF', borderColor: colors.primary, marginLeft: 8 },
  legendText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  gridHeader: { flexDirection: 'row', backgroundColor: '#F4F5F7', borderBottomWidth: 1, borderBottomColor: colors.border },
  vanHeader: { width: 245, padding: 12, justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border },
  slotHeader: { width: 122, paddingVertical: 10, alignItems: 'center', borderRightWidth: 1, borderRightColor: colors.border },
  lunchHeader: { width: 70, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8E8', borderRightWidth: 1, borderRightColor: colors.border },
  headerText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  headerSub: { color: colors.muted, fontSize: 8, fontWeight: '700', marginTop: 2 },
  lunchText: { color: '#9A6B00', fontSize: 8, fontWeight: '900', transform: [{ rotate: '-90deg' }] },
  gridRow: { flexDirection: 'row', minHeight: 108, borderBottomWidth: 1, borderBottomColor: colors.border },
  vanCell: { width: 245, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#FFFFFF' },
  vanBadge: { width: 36, height: 36, borderRadius: 9, backgroundColor: '#EAF3FF', alignItems: 'center', justifyContent: 'center' },
  vanBadgeText: { color: colors.primary, fontWeight: '900' },
  vanName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  techNames: { color: colors.muted, fontSize: 9, marginTop: 3 },
  freeCell: { width: 122, padding: 8, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#FBFEFB' },
  plus: { color: '#2CA01C', fontWeight: '900', fontSize: 18 },
  freeText: { color: '#2CA01C', fontSize: 9, fontWeight: '800', marginTop: 2 },
  busyCell: { width: 122, padding: 9, justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#EAF3FF', borderLeftWidth: 4, borderLeftColor: colors.primary },
  continuationCell: { backgroundColor: '#F1F6FD', borderLeftWidth: 0 },
  busyClient: { color: colors.text, fontWeight: '900', fontSize: 11 },
  busyService: { color: colors.primary, fontWeight: '700', fontSize: 9, marginTop: 4, lineHeight: 13 },
  busyStatus: { color: colors.muted, fontSize: 8, marginTop: 6, fontWeight: '700' },
  continuationText: { color: colors.muted, fontSize: 9, fontWeight: '800', textAlign: 'center' },
  lunchCell: { width: 70, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDF7', borderRightWidth: 1, borderRightColor: colors.border },
  lunchIcon: { fontSize: 18 },
  emptyText: { color: colors.muted, textAlign: 'center', paddingVertical: 28 },
  orderRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#EAF0F6' },
  timeBlock: { width: 78, alignItems: 'center', backgroundColor: '#F4F5F7', paddingVertical: 10, borderRadius: 9 },
  timeText: { color: colors.text, fontWeight: '900', fontSize: 16 },
  durationText: { color: colors.muted, fontSize: 8, marginTop: 3 },
  orderInfo: { flex: 1, minWidth: 220 },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 14 },
  orderMeta: { color: colors.primary, fontWeight: '700', fontSize: 11, marginTop: 3 },
  orderAddress: { color: colors.muted, fontSize: 10, marginTop: 4 },
  statusArea: { minWidth: 280, gap: 8 },
  statusActions: { flexDirection: 'row', gap: 6 },
  statusButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#FFFFFF' },
  statusButtonText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  modalIntro: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 14 },
  fieldLabel: { color: colors.text, fontWeight: '900', marginTop: 4, marginBottom: 8 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 15 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#FFFFFF' },
  optionActive: { backgroundColor: '#EAF7E7', borderColor: '#2CA01C' },
  optionDisabled: { backgroundColor: '#F4F5F7', borderColor: '#E2E5E9' },
  optionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  optionTextActive: { color: '#1E7F14' },
  optionTextDisabled: { color: '#A6ADB5' },
  noAvailability: { backgroundColor: '#FFF8E8', borderRadius: 10, padding: 12, marginBottom: 15 },
  noAvailabilityTitle: { color: '#7A5700', fontWeight: '900', fontSize: 11 },
  noAvailabilityText: { color: '#98701A', fontSize: 10, marginTop: 4, marginBottom: 9 },
  summaryBox: { backgroundColor: '#F4F5F7', borderRadius: 10, padding: 13, marginTop: 8 },
  summaryTitle: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 6 },
  summaryLine: { color: colors.muted, fontSize: 10, marginTop: 3 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15 },
});
