import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { AppointmentStatus, WorkOrder } from '../types';

const statusOptions: AppointmentStatus[] = ['Solicitud recibida', 'Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada', 'Reprogramada', 'Cancelada'];

export function AgendaScreen() {
  const { workOrders, clients, services, vans, users, addWorkOrder, updateWorkOrder } = useAppState();
  const [selectedDate, setSelectedDate] = useState('2026-07-08');
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [time, setTime] = useState('08:00');
  const [problem, setProblem] = useState('');
  const [vanId, setVanId] = useState(vans[0]?.id ?? '');

  const days = ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-13'];
  const orders = useMemo(() => workOrders.filter((order) => order.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)), [workOrders, selectedDate]);

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
      <SectionTitle title="Agenda y despacho" subtitle="Programa citas, asigna vans y controla el estado de cada visita." action={<Button label="Nueva cita" icon="＋" onPress={() => setShowCreate(true)} />} />
      <Card>
        <Text style={styles.label}>Selecciona el día</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
          {days.map((date) => {
            const active = date === selectedDate;
            const dateObj = new Date(`${date}T12:00:00`);
            return (
              <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.dateCard, active && styles.dateCardActive]}>
                <Text style={[styles.dateDay, active && styles.dateTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).toUpperCase()}</Text>
                <Text style={[styles.dateNumber, active && styles.dateTextActive]}>{dateObj.getDate()}</Text>
                <Text style={[styles.dateMonth, active && styles.dateTextActive]}>{dateObj.toLocaleDateString('es', { month: 'short' }).toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Card>

      <Card>
        <SectionTitle title={`Órdenes programadas (${orders.length})`} subtitle="Puedes actualizar el estado directamente desde esta vista." />
        {orders.map((order) => {
          const client = clients.find((item) => item.id === order.clientId);
          const service = services.find((item) => item.id === order.serviceId);
          const van = vans.find((item) => item.id === order.vanId);
          const techNames = order.technicianIds.map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean).join(' y ');
          return (
            <View key={order.id} style={styles.orderRow}>
              <View style={styles.timeBlock}><Text style={styles.time}>{order.time}</Text><Text style={styles.orderId}>{order.id.slice(-3)}</Text></View>
              <View style={{ flex: 1, minWidth: 210 }}>
                <Text style={styles.client}>{client?.name}</Text>
                <Text style={styles.service}>{service?.name} · {van?.name}{techNames ? ` · ${techNames}` : ''}</Text>
                <Text style={styles.address} numberOfLines={1}>{order.address}</Text>
                <Text style={styles.problem} numberOfLines={2}>{order.problem}</Text>
              </View>
              <View style={styles.statusColumn}>
                <Pill label={order.status} tone={statusTone(order.status)} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: 320 }}>
                  <View style={styles.statusActions}>
                    {statusOptions.filter((status) => status !== order.status).slice(0, 4).map((status) => (
                      <Pressable key={status} onPress={() => updateWorkOrder(order.id, { status })} style={styles.statusButton}>
                        <Text style={styles.statusButtonText}>{status}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </View>
          );
        })}
      </Card>

      <AppModal visible={showCreate} title="Crear nueva cita" onClose={() => setShowCreate(false)}>
        <ScrollView>
          <Text style={styles.fieldLabel}>Cliente</Text>
          <View style={styles.optionWrap}>{clients.map((client) => <Option key={client.id} label={client.name} active={clientId === client.id} onPress={() => setClientId(client.id)} />)}</View>
          <Text style={styles.fieldLabel}>Servicio</Text>
          <View style={styles.optionWrap}>{services.map((service) => <Option key={service.id} label={service.name} active={serviceId === service.id} onPress={() => setServiceId(service.id)} />)}</View>
          <Text style={styles.fieldLabel}>Van</Text>
          <View style={styles.optionWrap}>{vans.map((van) => <Option key={van.id} label={`${van.name} · ${van.status}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />)}</View>
          <Input label="Hora" value={time} onChangeText={setTime} placeholder="08:00" />
          <Input label="Problema reportado / instrucciones" value={problem} onChangeText={setProblem} multiline placeholder="Describe el trabajo solicitado…" />
          <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowCreate(false)} /><Button label="Guardar cita" onPress={createOrder} /></View>
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function Option({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.option, active && styles.optionActive]}><Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  label: { color: colors.text, fontWeight: '900', marginBottom: 12 },
  dateRow: { gap: 10 },
  dateCard: { width: 76, height: 92, borderWidth: 1, borderColor: colors.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBFCFE' },
  dateCardActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDay: { color: colors.muted, fontWeight: '900', fontSize: 10 },
  dateNumber: { color: colors.text, fontWeight: '900', fontSize: 27, marginVertical: 2 },
  dateMonth: { color: colors.muted, fontWeight: '800', fontSize: 10 },
  dateTextActive: { color: '#FFFFFF' },
  orderRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#EAF0F6' },
  timeBlock: { width: 68, alignItems: 'center', backgroundColor: colors.primaryLight, paddingVertical: 10, borderRadius: 12 },
  time: { color: colors.primary, fontWeight: '900', fontSize: 17 },
  orderId: { color: colors.muted, fontSize: 9, marginTop: 3 },
  client: { color: colors.text, fontWeight: '900', fontSize: 15 },
  service: { color: colors.primary, fontWeight: '700', fontSize: 12, marginTop: 3 },
  address: { color: colors.muted, fontSize: 11, marginTop: 4 },
  problem: { color: colors.text, fontSize: 12, marginTop: 6, lineHeight: 17 },
  statusColumn: { minWidth: 260, gap: 8 },
  statusActions: { flexDirection: 'row', gap: 6 },
  statusButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 9 },
  statusButtonText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  fieldLabel: { color: colors.text, fontWeight: '900', marginTop: 4, marginBottom: 8 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 15 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: '#FBFCFE' },
  optionActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  optionTextActive: { color: colors.primary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
});
