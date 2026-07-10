import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { AppointmentStatus, Client, ServiceType, Van, WorkOrder } from '../types';

const morningSlots = ['08:30', '09:30', '10:30'];
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const statusOptions: AppointmentStatus[] = ['Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada', 'Reprogramada', 'Cancelada'];

function formatDate(date: string, long = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
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
  return allSlots.indexOf(normalizeTime(time));
}

function normalizeTime(time: string) {
  if (time < '09:00') return '08:30';
  if (time >= '09:00' && time < '10:30') return '09:30';
  if (time >= '10:30' && time < '12:00') return '10:30';
  if (time >= '12:00' && time < '14:30') return '13:30';
  if (time >= '14:30' && time < '15:30') return '14:30';
  return '15:30';
}

function slotLabel(slot: string) {
  const [hour, minute] = slot.split(':').map(Number);
  const endHour = hour + 1;
  return `${slot} - ${String(endHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[]) {
  const start = slotIndex(order.time);
  const target = slotIndex(slot);
  if (start < 0 || target < 0) return false;
  const service = services.find((item) => item.id === order.serviceId);
  return target >= start && target < start + durationInSlots(service);
}

function toneForStatus(status: AppointmentStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple' {
  return statusTone(status);
}

export function AgendaScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1260;
  const { workOrders, clients, services, vans, users, addWorkOrder, updateWorkOrder } = useAppState();
  const [selectedDate, setSelectedDate] = useState('2026-07-08');
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [problem, setProblem] = useState('');
  const [vanId, setVanId] = useState(vans[0]?.id ?? '');
  const [time, setTime] = useState('08:30');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 14 }, (_, index) => addDays('2026-07-08', index)), []);
  const orders = useMemo(
    () => workOrders.filter((order) => order.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)),
    [workOrders, selectedDate],
  );
  const selectedService = services.find((item) => item.id === serviceId);
  const selectedVan = vans.find((item) => item.id === vanId);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const requiredSlots = durationInSlots(selectedService);

  const isAvailable = (candidateVan: Van, candidateTime: string, date = selectedDate) => {
    if (candidateVan.status === 'Mantenimiento') return false;
    const start = slotIndex(candidateTime);
    if (start < 0 || start + requiredSlots > allSlots.length) return false;
    if (start < morningSlots.length && start + requiredSlots > morningSlots.length) return false;
    const candidateSlots = allSlots.slice(start, start + requiredSlots);
    return !workOrders.some((order) => order.date === date && order.vanId === candidateVan.id && candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services)));
  };

  const createOrder = () => {
    const client = clients.find((item) => item.id === clientId);
    const service = services.find((item) => item.id === serviceId);
    const van = vans.find((item) => item.id === vanId);
    if (!client || !service || !van || !isAvailable(van, time)) return;
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
      problem: problem.trim() || 'Cita programada desde agenda.',
      amount: service.basePrice,
      paid: 0,
    };
    addWorkOrder(order);
    setSelectedOrderId(order.id);
    setProblem('');
    setShowCreate(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle
        title="Agendar nueva cita"
        subtitle="Selecciona fecha, van y horario disponible. Cada van tiene 3 cupos en la mañana y 3 cupos en la tarde."
        action={<Button label="Nueva cita" icon="＋" onPress={() => setShowCreate(true)} />}
      />

      <Card>
        <View style={styles.topPlanner}>
          <View style={styles.topPlannerBlock}>
            <Text style={styles.fieldCaption}>Fecha seleccionada</Text>
            <Text style={styles.topPlannerTitle}>{formatDate(selectedDate, true)}</Text>
          </View>
          <View style={styles.serviceSelect}>
            <Text style={styles.serviceIcon}>❄</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldCaption}>Servicio requerido</Text>
              <Text style={styles.serviceName}>{selectedService?.name}</Text>
            </View>
            <Text style={styles.chevron}>⌄</Text>
          </View>
          <View style={styles.durationBox}>
            <Text style={styles.fieldCaption}>Duración total</Text>
            <Text style={styles.durationValue}>{requiredSlots} cupo{requiredSlots > 1 ? 's' : ''}</Text>
          </View>
        </View>
      </Card>

      <View style={[styles.layout, compact && styles.layoutCompact]}>
        <View style={styles.leftPanel}>
          <Card>
            <View style={styles.monthHeader}><Text style={styles.monthTitle}>Julio 2026</Text><Text style={styles.monthNav}>‹  ›</Text></View>
            <View style={styles.calendarGrid}>{days.slice(0, 14).map((date) => {
              const active = date === selectedDate;
              const dateObj = new Date(`${date}T12:00:00`);
              return <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.calendarDay, active && styles.calendarDayActive]}><Text style={[styles.calendarWeekday, active && styles.calendarDayTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).slice(0, 2)}</Text><Text style={[styles.calendarNumber, active && styles.calendarDayTextActive]}>{dateObj.getDate()}</Text></Pressable>;
            })}</View>
          </Card>

          <Card>
            <Text style={styles.sideTitle}>Filtros rápidos</Text>
            <FilterRow label="Todas las citas" count={orders.length} active />
            <FilterRow label="Confirmadas" count={orders.filter((order) => order.status === 'Confirmada').length} />
            <FilterRow label="En proceso" count={orders.filter((order) => order.status === 'En proceso').length} />
            <FilterRow label="Pendientes" count={orders.filter((order) => ['Asignada', 'Pendiente'].includes(order.status)).length} />
          </Card>

          <Card>
            <Text style={styles.sideTitle}>Técnicos</Text>
            {vans.slice(0, 4).map((van) => <TechnicianFilter key={van.id} van={van} users={users} />)}
          </Card>
        </View>

        <Card style={styles.boardCard}>
          <View style={styles.boardHeader}>
            <Pressable onPress={() => setSelectedDate(addDays(selectedDate, -1))} style={styles.dateButton}><Text style={styles.dateButtonText}>← Día anterior</Text></Pressable>
            <View style={styles.boardDateCenter}><Text style={styles.boardDate}>{formatDate(selectedDate, true)}</Text><Text style={styles.workday}>Horario laboral: 8:00 AM - 5:00 PM  |  Break: 12:00 PM - 1:00 PM</Text></View>
            <Pressable onPress={() => setSelectedDate(addDays(selectedDate, 1))} style={styles.dateButton}><Text style={styles.dateButtonText}>Día siguiente →</Text></Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.boardGrid}>
              {vans.slice(0, 4).map((van) => <VanColumn key={van.id} van={van} users={users} orders={orders} services={services} clients={clients} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => { setVanId(van.id); setTime(slot); setShowCreate(true); }} />)}
            </View>
          </ScrollView>

          <View style={styles.legendBar}>
            <Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text>
            <Legend color="#EAF7E7" label="Disponible" />
            <Legend color="#FFF4DE" label="Parcial" />
            <Legend color="#EAF3FF" label="Ocupado" />
            <Legend color="#FDECEC" label="No disponible" />
          </View>
        </Card>

        <Card style={styles.detailPanel}>
          <AppointmentDetails order={selectedOrder} clients={clients} services={services} vans={vans} users={users} onUpdate={updateWorkOrder} />
        </Card>
      </View>

      <AppModal visible={showCreate} title="Confirmar nueva cita" onClose={() => setShowCreate(false)}>
        <ScrollView>
          <Text style={styles.modalIntro}>Selecciona cliente, servicio, horario y van disponible. El técnico se asigna según la van seleccionada.</Text>
          <Text style={styles.fieldLabel}>Cliente</Text>
          <View style={styles.optionWrap}>{clients.map((client) => <Option key={client.id} label={client.name} active={clientId === client.id} onPress={() => setClientId(client.id)} />)}</View>
          <Text style={styles.fieldLabel}>Servicio</Text>
          <View style={styles.optionWrap}>{services.map((service) => <Option key={service.id} label={`${service.name} · ${durationInSlots(service)} cupo${durationInSlots(service) > 1 ? 's' : ''}`} active={serviceId === service.id} onPress={() => setServiceId(service.id)} />)}</View>
          <Text style={styles.fieldLabel}>Asignar a</Text>
          <View style={styles.optionWrap}>{vans.slice(0, 4).map((van) => { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />; })}</View>
          <Text style={styles.fieldLabel}>Horario sugerido</Text>
          <View style={styles.optionWrap}>{allSlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · ocupado`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>
          <Input label="Notas adicionales" value={problem} onChangeText={setProblem} multiline placeholder="Instrucciones especiales para el técnico…" />
          <View style={styles.summaryBox}><Text style={styles.summaryTitle}>Resumen</Text><Text style={styles.summaryLine}>{selectedService?.name} · {requiredSlots} cupo{requiredSlots > 1 ? 's' : ''}</Text><Text style={styles.summaryLine}>{selectedVan?.name} · {formatDate(selectedDate)} · {time}</Text></View>
          <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowCreate(false)} /><Button label="Confirmar cita" onPress={createOrder} /></View>
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function VanColumn({ van, users, orders, services, clients, selectedOrderId, onSelectOrder, onCreate }: { van: Van; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {
  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || `${van.technicianIds.length || 1} técnico`;
  return (
    <View style={styles.vanColumn}>
      <View style={styles.vanColumnHeader}><Text style={styles.vanIcon}>🚐</Text><Text style={styles.vanTitle}>{van.name}</Text><Text style={styles.vanTechs}>{techNames}</Text></View>
      <SlotGroup title="MAÑANA" slots={morningSlots} van={van} orders={orders} services={services} clients={clients} selectedOrderId={selectedOrderId} onSelectOrder={onSelectOrder} onCreate={onCreate} />
      <SlotGroup title="TARDE" slots={afternoonSlots} van={van} orders={orders} services={services} clients={clients} selectedOrderId={selectedOrderId} onSelectOrder={onSelectOrder} onCreate={onCreate} />
    </View>
  );
}

function SlotGroup({ title, slots, van, orders, services, clients, selectedOrderId, onSelectOrder, onCreate }: { title: string; slots: string[]; van: Van; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {
  const used = slots.filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services))).length;
  return <View style={styles.slotGroup}><View style={styles.groupHeader}><Text style={styles.groupTitle}>{title}</Text><Text style={[styles.cupos, used >= slots.length && styles.cuposFull]}>{used}/{slots.length} cupos</Text></View>{slots.map((slot) => <SlotCell key={`${van.id}-${slot}`} slot={slot} van={van} orders={orders} services={services} clients={clients} selectedOrderId={selectedOrderId} onSelectOrder={onSelectOrder} onCreate={() => onCreate(slot)} />)}</View>;
}

function SlotCell({ slot, van, orders, services, clients, selectedOrderId, onSelectOrder, onCreate }: { slot: string; van: Van; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: () => void }) {
  const order = orders.find((item) => item.vanId === van.id && normalizeTime(item.time) === slot);
  if (van.status === 'Mantenimiento') return <View style={[styles.slotCard, styles.slotUnavailable]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>No disponible</Text></View>;
  if (!order) return <Pressable onPress={onCreate} style={[styles.slotCard, styles.slotAvailable]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.availableText}>Disponible</Text><Text style={styles.addSlot}>＋</Text></Pressable>;
  const service = services.find((item) => item.id === order.serviceId);
  const client = clients.find((item) => item.id === order.clientId);
  return (
    <Pressable onPress={() => onSelectOrder(order.id)} style={[styles.slotCard, styles.slotBusy, selectedOrderId === order.id && styles.slotSelected]}>
      <View style={styles.slotTop}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Pill label={order.status} tone={toneForStatus(order.status)} /></View>
      <Text style={styles.clientName} numberOfLines={1}>{client?.name}</Text>
      <Text style={styles.serviceLine} numberOfLines={1}>{service?.name}</Text>
      <Text style={styles.cupoLine}>{durationInSlots(service)} cupo{durationInSlots(service) > 1 ? 's' : ''}</Text>
    </Pressable>
  );
}

function AppointmentDetails({ order, clients, services, vans, users, onUpdate }: { order?: WorkOrder; clients: Client[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => void }) {
  if (!order) return <View style={styles.emptyDetails}><Text style={styles.detailTitle}>Detalles de la cita</Text><Text style={styles.detailMuted}>Selecciona una cita para ver la información completa.</Text></View>;
  const client = clients.find((item) => item.id === order.clientId);
  const service = services.find((item) => item.id === order.serviceId);
  const van = vans.find((item) => item.id === order.vanId);
  const techNames = order.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';
  return (
    <View>
      <View style={styles.detailHeader}><Pill label={order.status} tone={toneForStatus(order.status)} /><Text style={styles.detailId}>ID: {order.id}</Text></View>
      <Text style={styles.detailTitle}>{client?.name}</Text>
      <Text style={styles.detailSubtitle}>{service?.name}</Text>
      <View style={styles.detailTabs}><Text style={styles.detailTabActive}>Detalles</Text><Text style={styles.detailTab}>Cliente</Text><Text style={styles.detailTab}>Notas</Text></View>
      <DetailRow label="Fecha y hora" value={`${formatDate(order.date, true)} · ${slotLabel(normalizeTime(order.time))}`} />
      <DetailRow label="Dirección" value={order.address} />
      <DetailRow label="Técnico asignado" value={techNames} />
      <DetailRow label="Van asignada" value={van?.name ?? 'Sin van'} />
      <DetailRow label="Problema / instrucciones" value={order.problem} />
      <View style={styles.detailActions}><Button variant="secondary" label="Editar cita" onPress={() => {}} /><Button label="Marcar completada" onPress={() => onUpdate(order.id, { status: 'Completada' })} /></View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || '—'}</Text></View>;
}

function FilterRow({ label, count, active }: { label: string; count: number; active?: boolean }) {
  return <View style={[styles.filterRow, active && styles.filterRowActive]}><Text style={styles.filterDot}>●</Text><Text style={styles.filterLabel}>{label}</Text><Text style={styles.filterCount}>{count}</Text></View>;
}

function TechnicianFilter({ van, users }: { van: Van; users: { id: string; name: string }[] }) {
  const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';
  return <View style={styles.techFilter}><Text style={styles.checkBox}>✓</Text><View><Text style={styles.techFilterVan}>{van.name}</Text><Text style={styles.techFilterName}>{names}</Text></View></View>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendColor, { backgroundColor: color }]} /><Text style={styles.legendLabel}>{label}</Text></View>;
}

function Option({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.option, active && styles.optionActive, disabled && styles.optionDisabled]}><Text style={[styles.optionText, active && styles.optionTextActive, disabled && styles.optionTextDisabled]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { padding: 26, gap: 18, paddingBottom: 96 },
  topPlanner: { flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' },
  topPlannerBlock: { flex: 1, minWidth: 260 },
  fieldCaption: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  topPlannerTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 4, textTransform: 'capitalize' },
  serviceSelect: { minWidth: 270, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  serviceIcon: { color: colors.brandBlue, fontSize: 20 },
  serviceName: { color: colors.text, fontWeight: '800', marginTop: 2 },
  chevron: { color: colors.muted, fontSize: 18 },
  durationBox: { minWidth: 140, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 20 },
  durationValue: { color: colors.primary, fontWeight: '900', fontSize: 18, marginTop: 3 },
  layout: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  layoutCompact: { flexDirection: 'column' },
  leftPanel: { width: 250, gap: 14 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  monthTitle: { color: colors.text, fontWeight: '900', fontSize: 15 },
  monthNav: { color: colors.muted, fontSize: 17, fontWeight: '900' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  calendarDay: { width: 42, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  calendarDayActive: { backgroundColor: colors.primary },
  calendarWeekday: { color: colors.muted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  calendarNumber: { color: colors.text, fontWeight: '900', marginTop: 2 },
  calendarDayTextActive: { color: '#FFFFFF' },
  sideTitle: { color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 10 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 9, borderRadius: 8 },
  filterRowActive: { backgroundColor: '#F0F2F4' },
  filterDot: { color: colors.primary, fontSize: 10 },
  filterLabel: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '700' },
  filterCount: { color: colors.muted, backgroundColor: '#EEF0F2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontWeight: '800', fontSize: 10 },
  techFilter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkBox: { width: 18, height: 18, borderRadius: 5, overflow: 'hidden', textAlign: 'center', backgroundColor: colors.primary, color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  techFilterVan: { color: colors.text, fontWeight: '900', fontSize: 12 },
  techFilterName: { color: colors.muted, fontSize: 10, marginTop: 2 },
  boardCard: { flex: 1, minWidth: 0, padding: 0, overflow: 'hidden' },
  boardHeader: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderBottomWidth: 1, borderBottomColor: colors.border, flexWrap: 'wrap' },
  dateButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF' },
  dateButtonText: { color: colors.text, fontWeight: '800', fontSize: 12 },
  boardDateCenter: { flex: 1, minWidth: 290, alignItems: 'center' },
  boardDate: { color: colors.text, fontWeight: '900', fontSize: 15, textTransform: 'capitalize' },
  workday: { color: colors.muted, fontSize: 11, marginTop: 6, textAlign: 'center' },
  boardGrid: { flexDirection: 'row', alignItems: 'stretch' },
  vanColumn: { width: 230, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#FFFFFF' },
  vanColumnHeader: { minHeight: 74, alignItems: 'center', justifyContent: 'center', gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: '#FBFCFD' },
  vanIcon: { fontSize: 20 },
  vanTitle: { color: colors.text, fontWeight: '900', fontSize: 15 },
  vanTechs: { color: colors.muted, fontSize: 10 },
  slotGroup: { padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: '#EEF0F2' },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  groupTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  cupos: { color: colors.warning, backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, fontSize: 9, fontWeight: '900' },
  cuposFull: { color: colors.danger, backgroundColor: colors.dangerLight },
  slotCard: { minHeight: 76, borderRadius: 8, borderWidth: 1, padding: 10, justifyContent: 'center' },
  slotAvailable: { borderColor: '#B9E4B3', backgroundColor: '#F4FBF2' },
  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotBusy: { borderColor: '#B9D7FF', backgroundColor: colors.infoLight },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
  slotTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, alignItems: 'center' },
  slotTime: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  availableText: { color: colors.primary, fontWeight: '900', fontSize: 12, marginTop: 5 },
  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 12, marginTop: 5 },
  addSlot: { position: 'absolute', right: 10, bottom: 8, color: colors.primary, fontSize: 16, fontWeight: '900' },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 12, marginTop: 8 },
  serviceLine: { color: colors.text, fontSize: 10, marginTop: 3 },
  cupoLine: { color: colors.muted, fontSize: 9, marginTop: 4 },
  legendBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 14, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' },
  legendTitle: { color: colors.text, fontWeight: '900', fontSize: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendColor: { width: 13, height: 13, borderRadius: 3, borderWidth: 1, borderColor: '#D1D5DB' },
  legendLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  detailPanel: { width: 330, minHeight: 560 },
  emptyDetails: { paddingVertical: 32 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  detailId: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  detailTitle: { color: colors.text, fontWeight: '900', fontSize: 20, marginBottom: 5 },
  detailSubtitle: { color: colors.text, fontSize: 13, marginBottom: 14 },
  detailMuted: { color: colors.muted, marginTop: 8, lineHeight: 19 },
  detailTabs: { flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 16 },
  detailTabActive: { color: colors.primary, fontWeight: '900', paddingBottom: 9, borderBottomWidth: 2, borderBottomColor: colors.primary },
  detailTab: { color: colors.muted, fontWeight: '700', paddingBottom: 9 },
  detailRow: { marginBottom: 16 },
  detailLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 5 },
  detailValue: { color: colors.text, fontSize: 13, lineHeight: 18 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  modalIntro: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 14 },
  fieldLabel: { color: colors.text, fontWeight: '900', marginTop: 4, marginBottom: 8 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 15 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#FFFFFF' },
  optionActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionDisabled: { backgroundColor: '#F4F5F7', borderColor: '#E2E5E9' },
  optionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  optionTextActive: { color: colors.primaryDark },
  optionTextDisabled: { color: '#A6ADB5' },
  summaryBox: { backgroundColor: '#F4F5F7', borderRadius: 10, padding: 13, marginTop: 8 },
  summaryTitle: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 6 },
  summaryLine: { color: colors.muted, fontSize: 10, marginTop: 3 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15 },
});
