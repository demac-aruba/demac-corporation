import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, formatMoney, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { AppointmentStatus, WorkOrder } from '../types';

const statusOptions: AppointmentStatus[] = ['Solicitud recibida', 'Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada', 'Reprogramada', 'Cancelada'];
const statusFilters: (AppointmentStatus | 'Todos')[] = ['Todos', 'Solicitud recibida', 'Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Completada'];
const days = ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-13'];
const workingHours = ['08:00', '09:30', '11:00', '13:00', '14:30', '16:00'];

export function AgendaScreen() {
  const { workOrders, clients, services, vans, users, addWorkOrder, updateWorkOrder } = useAppState();
  const { width } = useWindowDimensions();
  const isWide = width >= 1120;
  const [selectedDate, setSelectedDate] = useState('2026-07-08');
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [time, setTime] = useState('08:00');
  const [problem, setProblem] = useState('');
  const [vanId, setVanId] = useState(vans[0]?.id ?? '');
  const [selectedStatus, setSelectedStatus] = useState<AppointmentStatus | 'Todos'>('Todos');
  const [selectedVan, setSelectedVan] = useState('Todos');
  const [search, setSearch] = useState('');

  const selectedDateLabel = useMemo(() => formatDateLong(selectedDate), [selectedDate]);

  const dayOrders = useMemo(
    () => workOrders.filter((order) => order.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)),
    [workOrders, selectedDate],
  );

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return dayOrders.filter((order) => {
      const client = clients.find((item) => item.id === order.clientId);
      const service = services.find((item) => item.id === order.serviceId);
      const matchesStatus = selectedStatus === 'Todos' || order.status === selectedStatus;
      const matchesVan = selectedVan === 'Todos' || order.vanId === selectedVan;
      const matchesSearch = !needle || [client?.name, service?.name, order.address, order.problem, order.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
      return matchesStatus && matchesVan && matchesSearch;
    });
  }, [clients, dayOrders, search, selectedStatus, selectedVan, services]);

  const summary = useMemo(() => {
    const completed = dayOrders.filter((order) => ['Completada', 'Facturada', 'Pagada'].includes(order.status)).length;
    const active = dayOrders.filter((order) => ['Asignada', 'En camino', 'En el sitio', 'En proceso'].includes(order.status)).length;
    const pending = dayOrders.filter((order) => ['Solicitud recibida', 'Confirmada', 'Pendiente', 'Reprogramada'].includes(order.status)).length;
    const amount = dayOrders.reduce((total, order) => total + order.amount, 0);
    return { completed, active, pending, amount };
  }, [dayOrders]);

  const createOrder = () => {
    const client = clients.find((item) => item.id === clientId);
    const service = services.find((item) => item.id === serviceId);
    const van = vans.find((item) => item.id === vanId);
    if (!client || !service || !van || !problem.trim()) return;
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
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>AGENDA Y DESPACHO</Text>
          <Text style={styles.heroTitle}>{selectedDateLabel}</Text>
          <Text style={styles.heroSubtitle}>Planifica citas, asigna vans y mueve cada trabajo por su estado operativo.</Text>
        </View>
        <View style={styles.heroActions}>
          <Button label="Nueva cita" icon="＋" onPress={() => setShowCreate(true)} />
          <Button variant="secondary" label="Vista despacho" compact onPress={() => setSelectedStatus('Todos')} />
        </View>
      </View>

      <View style={[styles.summaryGrid, isWide && styles.summaryGridWide]}>
        <MetricCard icon="📅" label="Citas del día" value={String(dayOrders.length)} detail={`${filteredOrders.length} visibles`} />
        <MetricCard icon="🚐" label="En operación" value={String(summary.active)} detail="Asignadas / en ruta" />
        <MetricCard icon="✓" label="Completadas" value={String(summary.completed)} detail={`${summary.pending} pendientes`} />
        <MetricCard icon="💳" label="Valor programado" value={formatMoney(summary.amount)} detail="Según servicio base" />
      </View>

      <Card style={styles.dateCardWrap}>
        <View style={styles.dateHeader}>
          <View>
            <Text style={styles.blockTitle}>Calendario rápido</Text>
            <Text style={styles.blockSubtitle}>Selecciona el día de trabajo.</Text>
          </View>
          <Pill label="Tiempo real" tone="success" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
          {days.map((date) => {
            const active = date === selectedDate;
            const dateObj = new Date(`${date}T12:00:00`);
            const count = workOrders.filter((order) => order.date === date).length;
            return (
              <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dateCard, active && styles.dateCardActive]}>
                <Text style={[styles.dateDay, active && styles.dateTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).toUpperCase()}</Text>
                <Text style={[styles.dateNumber, active && styles.dateTextActive]}>{dateObj.getDate()}</Text>
                <Text style={[styles.dateMonth, active && styles.dateTextActive]}>{dateObj.toLocaleDateString('es', { month: 'short' }).toUpperCase()}</Text>
                <View style={[styles.dateBadge, active && styles.dateBadgeActive]}><Text style={[styles.dateBadgeText, active && styles.dateBadgeTextActive]}>{count}</Text></View>
              </Pressable>
            );
          })}
        </ScrollView>
      </Card>

      <View style={[styles.workspace, isWide && styles.workspaceWide]}>
        <Card style={styles.mainBoard}>
          <SectionTitle
            title="Programación del día"
            subtitle="Controla la ruta como una pantalla de operaciones: hora, cliente, servicio, van y estado."
            action={<Button label="Nueva cita" compact icon="＋" onPress={() => setShowCreate(true)} />}
          />

          <View style={styles.toolbar}>
            <Input style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Buscar cliente, dirección, servicio u orden…" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {statusFilters.map((status) => <FilterChip key={status} label={status} active={selectedStatus === status} onPress={() => setSelectedStatus(status)} />)}
            </ScrollView>
          </View>

          <View style={styles.timelineHeader}>
            <Text style={[styles.tableHead, { width: 86 }]}>HORA</Text>
            <Text style={[styles.tableHead, { flex: 1 }]}>CLIENTE / SERVICIO</Text>
            <Text style={[styles.tableHead, styles.hideSmall]}>VAN</Text>
            <Text style={[styles.tableHead, styles.statusHead]}>ESTADO</Text>
          </View>

          {filteredOrders.length ? filteredOrders.map((order) => (
            <OrderLine
              key={order.id}
              order={order}
              clients={clients}
              services={services}
              vans={vans}
              users={users}
              onStatusChange={(status) => updateWorkOrder(order.id, { status })}
            />
          )) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>No hay citas con estos filtros</Text>
              <Text style={styles.emptyText}>Ajusta el estado, la van o la búsqueda para ver más resultados.</Text>
            </View>
          )}
        </Card>

        <View style={styles.sideColumn}>
          <Card>
            <Text style={styles.blockTitle}>Despacho por van</Text>
            <Text style={styles.blockSubtitle}>Filtra la agenda tocando una van.</Text>
            <View style={styles.vanList}>
              <VanFilter label="Todas las vans" active={selectedVan === 'Todos'} count={dayOrders.length} onPress={() => setSelectedVan('Todos')} />
              {vans.map((van) => {
                const count = dayOrders.filter((order) => order.vanId === van.id).length;
                const techNames = van.technicianIds.map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean).join(' y ');
                return <VanFilter key={van.id} label={van.name} detail={techNames || van.status} active={selectedVan === van.id} count={count} onPress={() => setSelectedVan(van.id)} />;
              })}
            </View>
          </Card>

          <Card>
            <Text style={styles.blockTitle}>Horas disponibles</Text>
            <Text style={styles.blockSubtitle}>Referencia rápida para crear nuevas citas.</Text>
            <View style={styles.slotGrid}>
              {workingHours.map((slot) => {
                const busy = dayOrders.some((order) => order.time === slot);
                return (
                  <Pressable key={slot} onPress={() => { setTime(slot); setShowCreate(true); }} style={[styles.slot, busy && styles.slotBusy]}>
                    <Text style={[styles.slotText, busy && styles.slotBusyText]}>{slot}</Text>
                    <Text style={styles.slotHint}>{busy ? 'Ocupada' : 'Libre'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </View>
      </View>

      <AppModal visible={showCreate} title="Crear nueva cita" onClose={() => setShowCreate(false)}>
        <ScrollView>
          <Text style={styles.modalSubtitle}>Agenda una orden rápida para {selectedDateLabel}.</Text>
          <Text style={styles.fieldLabel}>Cliente</Text>
          <View style={styles.optionWrap}>{clients.map((client) => <Option key={client.id} label={client.name} active={clientId === client.id} onPress={() => setClientId(client.id)} />)}</View>
          <Text style={styles.fieldLabel}>Servicio</Text>
          <View style={styles.optionWrap}>{services.map((service) => <Option key={service.id} label={`${service.name} · ${formatMoney(service.basePrice)}`} active={serviceId === service.id} onPress={() => setServiceId(service.id)} />)}</View>
          <Text style={styles.fieldLabel}>Van asignada</Text>
          <View style={styles.optionWrap}>{vans.map((van) => <Option key={van.id} label={`${van.name} · ${van.status}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />)}</View>
          <Input label="Hora" value={time} onChangeText={setTime} placeholder="08:00" />
          <Input label="Problema reportado / instrucciones" value={problem} onChangeText={setProblem} multiline placeholder="Describe el trabajo solicitado…" />
          <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowCreate(false)} /><Button label="Guardar cita" onPress={createOrder} /></View>
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function OrderLine({ order, clients, services, vans, users, onStatusChange }: {
  order: WorkOrder;
  clients: ReturnType<typeof useAppState>['clients'];
  services: ReturnType<typeof useAppState>['services'];
  vans: ReturnType<typeof useAppState>['vans'];
  users: ReturnType<typeof useAppState>['users'];
  onStatusChange: (status: AppointmentStatus) => void;
}) {
  const client = clients.find((item) => item.id === order.clientId);
  const service = services.find((item) => item.id === order.serviceId);
  const van = vans.find((item) => item.id === order.vanId);
  const techNames = order.technicianIds.map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean).join(' y ');
  const nextStatuses = statusOptions.filter((status) => status !== order.status).slice(0, 5);

  return (
    <View style={styles.orderRow}>
      <View style={styles.timeBlock}>
        <Text style={styles.time}>{order.time}</Text>
        <Text style={styles.orderId}>{order.id.slice(-3)}</Text>
      </View>
      <View style={styles.orderMain}>
        <View style={styles.clientLine}>
          <Text style={styles.client}>{client?.name}</Text>
          <Text style={styles.amount}>{formatMoney(order.amount)}</Text>
        </View>
        <Text style={styles.service}>{service?.name} · {order.address}</Text>
        <Text style={styles.problem} numberOfLines={2}>{order.problem}</Text>
      </View>
      <View style={styles.vanColumn}>
        <Text style={styles.vanName}>{van?.name ?? 'Sin van'}</Text>
        <Text style={styles.techs} numberOfLines={1}>{techNames || 'Sin técnico'}</Text>
      </View>
      <View style={styles.statusColumn}>
        <Pill label={order.status} tone={statusTone(order.status)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusScroll}>
          <View style={styles.statusActions}>
            {nextStatuses.map((status) => (
              <Pressable key={status} onPress={() => onStatusChange(status)} style={styles.statusButton}>
                <Text style={styles.statusButtonText}>{status}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <Card style={styles.metricCard}>
      <View style={styles.metricIcon}><Text>{icon}</Text></View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </Card>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
}

function VanFilter({ label, detail, count, active, onPress }: { label: string; detail?: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.vanFilter, active && styles.vanFilterActive]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.vanFilterLabel, active && styles.vanFilterLabelActive]}>{label}</Text>
        {detail ? <Text style={styles.vanFilterDetail}>{detail}</Text> : null}
      </View>
      <View style={[styles.vanCount, active && styles.vanCountActive]}><Text style={[styles.vanCountText, active && styles.vanCountTextActive]}>{count}</Text></View>
    </Pressable>
  );
}

function Option({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.option, active && styles.optionActive]}><Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text></Pressable>;
}

function formatDateLong(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  kicker: { color: '#8DB7E2', fontSize: 10, fontWeight: '900', letterSpacing: 2.4, textTransform: 'uppercase' },
  heroTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 28, marginTop: 8, textTransform: 'capitalize' },
  heroSubtitle: { color: '#D7E7FF', marginTop: 8, fontSize: 14, lineHeight: 20 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  summaryGrid: { gap: 14 },
  summaryGridWide: { flexDirection: 'row' },
  metricCard: { flex: 1, minWidth: 190, gap: 7 },
  metricIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  metricValue: { color: colors.text, fontSize: 24, fontWeight: '900' },
  metricDetail: { color: colors.muted, fontSize: 11 },
  dateCardWrap: { gap: 14 },
  dateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  blockTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  blockSubtitle: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 18 },
  dateRow: { gap: 10 },
  dateCard: { width: 88, height: 104, borderWidth: 1, borderColor: colors.border, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBFCFE', position: 'relative' },
  dateCardActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDay: { color: colors.muted, fontWeight: '900', fontSize: 10 },
  dateNumber: { color: colors.text, fontWeight: '900', fontSize: 30, marginVertical: 2 },
  dateMonth: { color: colors.muted, fontWeight: '800', fontSize: 10 },
  dateTextActive: { color: '#FFFFFF' },
  dateBadge: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  dateBadgeActive: { backgroundColor: '#FFFFFF' },
  dateBadgeText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  dateBadgeTextActive: { color: colors.primary },
  workspace: { gap: 16 },
  workspaceWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mainBoard: { flex: 1, minWidth: 0 },
  sideColumn: { gap: 16, minWidth: 300, flexBasis: 350 },
  toolbar: { gap: 10, marginBottom: 8 },
  searchInput: { marginBottom: 0 },
  filterRow: { gap: 8, paddingBottom: 2 },
  filterChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  filterTextActive: { color: '#FFFFFF' },
  timelineHeader: { flexDirection: 'row', gap: 14, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10, marginTop: 4 },
  tableHead: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  hideSmall: { width: 120 },
  statusHead: { width: 250 },
  orderRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: '#EAF0F6' },
  timeBlock: { width: 86, alignItems: 'center', backgroundColor: colors.primaryLight, paddingVertical: 12, borderRadius: 14 },
  time: { color: colors.primary, fontWeight: '900', fontSize: 17 },
  orderId: { color: colors.muted, fontSize: 9, marginTop: 3, fontWeight: '800' },
  orderMain: { flex: 1, minWidth: 250 },
  clientLine: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  client: { color: colors.text, fontWeight: '900', fontSize: 15 },
  amount: { color: colors.success, fontWeight: '900', fontSize: 12 },
  service: { color: colors.primary, fontWeight: '800', fontSize: 12, marginTop: 3 },
  problem: { color: colors.text, fontSize: 12, marginTop: 6, lineHeight: 17 },
  vanColumn: { width: 120 },
  vanName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  techs: { color: colors.muted, fontSize: 10, marginTop: 4, fontWeight: '700' },
  statusColumn: { width: 250, gap: 8 },
  statusScroll: { maxWidth: 250 },
  statusActions: { flexDirection: 'row', gap: 6 },
  statusButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#FFFFFF' },
  statusButtonText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  emptyBox: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 18 },
  emptyIcon: { fontSize: 34, marginBottom: 8 },
  emptyTitle: { color: colors.text, fontWeight: '900', fontSize: 16 },
  emptyText: { color: colors.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  vanList: { gap: 9, marginTop: 14 },
  vanFilter: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, backgroundColor: '#FBFCFE' },
  vanFilterActive: { backgroundColor: colors.primaryLight, borderColor: '#BFD7FF' },
  vanFilterLabel: { color: colors.text, fontWeight: '900', fontSize: 13 },
  vanFilterLabelActive: { color: colors.primary },
  vanFilterDetail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  vanCount: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EDF1F6', alignItems: 'center', justifyContent: 'center' },
  vanCountActive: { backgroundColor: colors.primary },
  vanCountText: { color: colors.muted, fontWeight: '900', fontSize: 11 },
  vanCountTextActive: { color: '#FFFFFF' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  slot: { width: 76, borderWidth: 1, borderColor: '#CFE0F6', backgroundColor: '#F7FBFF', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  slotBusy: { backgroundColor: colors.warningLight, borderColor: '#F8D48A' },
  slotText: { color: colors.primary, fontWeight: '900' },
  slotBusyText: { color: colors.warning },
  slotHint: { color: colors.muted, fontSize: 9, marginTop: 2, fontWeight: '700' },
  modalSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  fieldLabel: { color: colors.text, fontWeight: '900', marginTop: 4, marginBottom: 8 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 15 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: '#FBFCFE' },
  optionActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  optionTextActive: { color: colors.primary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
});