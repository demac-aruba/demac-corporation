import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { Client } from '../types';

export function ClientsScreen() {
  const { clients, equipment, workOrders, addClient } = useAppState();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(clients[0]?.id ?? '');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '', zone: 'Oranjestad' });

  const filtered = useMemo(() => clients.filter((client) => `${client.name} ${client.company ?? ''} ${client.phone}`.toLowerCase().includes(query.toLowerCase())), [clients, query]);
  const selected = clients.find((client) => client.id === selectedId);
  const clientEquipment = equipment.filter((item) => item.clientId === selectedId);
  const clientOrders = workOrders.filter((item) => item.clientId === selectedId);

  const createClient = () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) return;
    const client: Client = {
      id: `c${Date.now()}`,
      name: form.name.trim(),
      phone: form.phone.trim(),
      whatsapp: form.phone.trim(),
      address: form.address.trim(),
      zone: form.zone.trim() || 'Aruba',
      balance: 0,
      equipmentCount: 0,
    };
    addClient(client);
    setSelectedId(client.id);
    setForm({ name: '', phone: '', address: '', zone: 'Oranjestad' });
    setShowCreate(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Clientes y propiedades" subtitle="Consulta contactos, balances, equipos e historial técnico." action={<Button label="Nuevo cliente" icon="＋" onPress={() => setShowCreate(true)} />} />
      <View style={styles.columns}>
        <Card style={styles.listCard}>
          <Input placeholder="Buscar por nombre, empresa o teléfono…" value={query} onChangeText={setQuery} />
          {filtered.length ? filtered.map((client) => (
            <Pressable key={client.id} onPress={() => setSelectedId(client.id)} style={[styles.clientRow, selectedId === client.id && styles.clientRowActive]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{client.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.clientName}>{client.name}</Text><Text style={styles.clientMeta}>{client.company || client.zone} · {client.phone}</Text></View>
              {client.balance > 0 ? <Pill label={formatMoney(client.balance)} tone="warning" /> : <Pill label="Al día" tone="success" />}
            </Pressable>
          )) : <EmptyState icon="🔎" title="Sin resultados" message="No encontramos clientes con ese criterio." />}
        </Card>

        <View style={styles.detailColumn}>
          {selected ? (
            <>
              <Card>
                <View style={styles.detailHeader}>
                  <View style={[styles.avatar, styles.avatarLarge]}><Text style={[styles.avatarText, { fontSize: 18 }]}>{selected.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</Text></View>
                  <View style={{ flex: 1 }}><Text style={styles.detailName}>{selected.name}</Text><Text style={styles.detailCompany}>{selected.company || 'Cliente residencial'}</Text></View>
                  <Pill label={selected.balance > 0 ? `Balance ${formatMoney(selected.balance)}` : 'Cuenta al día'} tone={selected.balance > 0 ? 'warning' : 'success'} />
                </View>
                <View style={styles.infoGrid}>
                  <Info label="Teléfono / WhatsApp" value={selected.whatsapp} />
                  <Info label="Correo" value={selected.email || 'No registrado'} />
                  <Info label="Dirección" value={selected.address} />
                  <Info label="Zona" value={selected.zone} />
                </View>
              </Card>

              <Card>
                <SectionTitle title={`Equipos registrados (${clientEquipment.length})`} />
                {clientEquipment.length ? clientEquipment.map((item) => (
                  <View key={item.id} style={styles.equipmentRow}>
                    <View style={styles.equipmentIcon}><Text>❄️</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.equipmentName}>{item.brand} {item.model}</Text><Text style={styles.equipmentMeta}>{item.location} · {item.btu.toLocaleString()} BTU · {item.refrigerant} · {item.voltage}</Text><Text style={styles.equipmentSerial}>S/N {item.serial}</Text></View>
                    <Pill label={item.condition} tone={item.condition === 'Fuera de servicio' ? 'danger' : item.condition === 'Requiere atención' ? 'warning' : 'success'} />
                  </View>
                )) : <EmptyState icon="❄️" title="Sin equipos" message="Este cliente todavía no tiene equipos registrados." />}
              </Card>

              <Card>
                <SectionTitle title={`Historial de órdenes (${clientOrders.length})`} />
                {clientOrders.map((order) => <View key={order.id} style={styles.historyRow}><Text style={styles.historyDate}>{order.date}</Text><View style={{ flex: 1 }}><Text style={styles.historyId}>{order.id}</Text><Text style={styles.historyProblem} numberOfLines={1}>{order.problem}</Text></View><Pill label={order.status} tone={order.status === 'Completada' ? 'success' : 'info'} /></View>)}
              </Card>
            </>
          ) : null}
        </View>
      </View>

      <AppModal visible={showCreate} title="Registrar nuevo cliente" onClose={() => setShowCreate(false)}>
        <Input label="Nombre completo o empresa" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Input label="Teléfono / WhatsApp" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" />
        <Input label="Dirección" value={form.address} onChangeText={(address) => setForm({ ...form, address })} />
        <Input label="Zona" value={form.zone} onChangeText={(zone) => setForm({ ...form, zone })} />
        <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowCreate(false)} /><Button label="Guardar cliente" onPress={createClient} /></View>
      </AppModal>
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoItem}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  listCard: { flex: 1, minWidth: 320, maxWidth: 470 },
  detailColumn: { flex: 1.8, minWidth: 340, gap: 18 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, marginBottom: 5 },
  clientRowActive: { backgroundColor: colors.primaryLight },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F1FF' },
  avatarLarge: { width: 58, height: 58, borderRadius: 16 },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 12 },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  clientMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  detailName: { color: colors.text, fontWeight: '900', fontSize: 20 },
  detailCompany: { color: colors.muted, marginTop: 4 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
  infoItem: { minWidth: 190, flex: 1 },
  infoLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  infoValue: { color: colors.text, fontSize: 13, marginTop: 5, fontWeight: '700' },
  equipmentRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  equipmentIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  equipmentName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  equipmentMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  equipmentSerial: { color: colors.muted, fontSize: 9, marginTop: 3 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  historyDate: { color: colors.primary, fontWeight: '900', fontSize: 11, width: 80 },
  historyId: { color: colors.text, fontWeight: '800', fontSize: 11 },
  historyProblem: { color: colors.muted, fontSize: 10, marginTop: 3 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
});
