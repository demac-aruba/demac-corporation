import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

export function WorkOrdersScreen() {
  const { workOrders, workOrderEvidence, clients, services, users, vans, updateWorkOrder } = useAppState();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(workOrders[0]?.id ?? '');
  const [statusFilter, setStatusFilter] = useState('Todos');

  const filtered = useMemo(() => {
    return workOrders.filter((order) => {
      const client = clients.find((item) => item.id === order.clientId);
      const matchQuery = `${order.id} ${client?.name ?? ''} ${order.problem}`.toLowerCase().includes(query.toLowerCase());
      const matchStatus = statusFilter === 'Todos' || order.status === statusFilter;
      return matchQuery && matchStatus;
    });
  }, [workOrders, clients, query, statusFilter]);

  const selected = workOrders.find((order) => order.id === selectedId);
  const client = clients.find((item) => item.id === selected?.clientId);
  const service = services.find((item) => item.id === selected?.serviceId);
  const van = vans.find((item) => item.id === selected?.vanId);
  const technicians = selected?.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean) ?? [];
  const selectedEvidence = workOrderEvidence.filter((item) => item.workOrderId === selected?.id);

  const statuses = ['Todos', 'Solicitud recibida', 'Reserva temporal', 'Confirmada', 'Asignada', 'En proceso', 'Pendiente', 'Completada', 'Reprogramada', 'Cancelada', 'Facturada', 'Pagada'];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Órdenes de trabajo" subtitle="Supervisa diagnósticos, avances, reportes y balances por trabajo." />
      <View style={styles.toolbar}>
        <View style={{ flex: 1, minWidth: 280 }}><Input placeholder="Buscar orden, cliente o problema…" value={query} onChangeText={setQuery} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {statuses.map((status) => <Button key={status} compact variant={statusFilter === status ? 'primary' : 'secondary'} label={status} onPress={() => setStatusFilter(status)} />)}
        </ScrollView>
      </View>

      <View style={styles.columns}>
        <Card style={styles.listCard}>
          {filtered.length ? filtered.map((order) => {
            const orderClient = clients.find((item) => item.id === order.clientId);
            const orderService = services.find((item) => item.id === order.serviceId);
            return (
              <ButtonRow
                key={order.id}
                active={selectedId === order.id}
                onPress={() => setSelectedId(order.id)}
                title={orderClient?.name ?? 'Cliente'}
                subtitle={`${order.date} · ${order.time} · ${orderService?.name}`}
                id={order.id}
                status={order.status}
              />
            );
          }) : <EmptyState icon="🧰" title="Sin órdenes" message="No hay resultados para los filtros seleccionados." />}
        </Card>

        <View style={styles.detailColumn}>
          {selected ? (
            <>
              <Card>
                <View style={styles.orderHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orderId}>{selected.id}</Text>
                    <Text style={styles.orderClient}>{client?.name}</Text>
                    <Text style={styles.orderMeta}>{service?.name} · {selected.date} a las {selected.time}</Text>
                  </View>
                  <Pill label={selected.status} tone={statusTone(selected.status)} />
                </View>
                <View style={styles.infoGrid}>
                  <Info label="Dirección" value={selected.address} />
                  <Info label="Van" value={van?.name ?? 'Sin asignar'} />
                  <Info label="Técnicos" value={technicians.join(', ') || 'Sin asignar'} />
                  <Info label="Monto" value={formatMoney(selected.amount)} />
                  <Info label="Pagado" value={formatMoney(selected.paid)} />
                  <Info label="Balance" value={formatMoney(selected.amount - selected.paid)} />
                </View>
              </Card>

              <Card>
                <SectionTitle title="Trabajo solicitado" />
                <Text style={styles.bodyText}>{selected.problem}</Text>
                {selected.officeNotes ? <View style={styles.noteBox}><Text style={styles.noteTitle}>NOTA INTERNA DE OFICINA</Text><Text style={styles.noteText}>{selected.officeNotes}</Text></View> : null}
              </Card>

              <Card>
                <SectionTitle title="Reporte técnico" subtitle={selected.reportGenerated ? 'Reporte marcado como generado.' : 'Pendiente de completar o aprobar.'} />
                <ReportField label="Diagnóstico" value={selected.diagnosis} />
                <ReportField label="Trabajo realizado" value={selected.workPerformed} />
                <ReportField label="Recomendación" value={selected.recommendation} />
                {selected.measurements ? (
                  <View style={styles.measureGrid}>
                    {Object.entries(selected.measurements).map(([key, value]) => <View key={key} style={styles.measure}><Text style={styles.measureKey}>{key}</Text><Text style={styles.measureValue}>{value}</Text></View>)}
                  </View>
                ) : null}
                {selectedEvidence.length ? <View style={styles.evidenceSection}><Text style={styles.reportLabel}>Evidencia fotográfica ({selectedEvidence.length})</Text><View style={styles.evidenceGrid}>{selectedEvidence.map((evidence) => <View key={evidence.id} style={styles.evidenceItem}><Image source={{ uri: evidence.downloadUrl }} style={styles.evidenceImage} /><Text style={styles.evidenceLabel}>{evidence.label}</Text><Text style={styles.evidenceMeta}>{evidence.uploadedByName}</Text></View>)}</View></View> : <Text style={styles.reportValue}>No hay fotografías permanentes registradas.</Text>}
                <View style={styles.actionRow}>
                  <Button variant="secondary" label="Marcar pendiente" onPress={() => updateWorkOrder(selected.id, { status: 'Pendiente' })} />
                  <Button variant="success" label={selected.reportGenerated ? 'Reporte generado' : 'Aprobar y generar reporte'} disabled={selected.reportGenerated} onPress={() => updateWorkOrder(selected.id, { reportGenerated: true, status: selected.status === 'Completada' ? 'Facturada' : selected.status })} />
                </View>
              </Card>
            </>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function ButtonRow({ active, onPress, title, subtitle, id, status }: { active: boolean; onPress: () => void; title: string; subtitle: string; id: string; status: string }) {
  return (
    <View style={[styles.listRow, active && styles.listRowActive]}>
      <View style={{ flex: 1 }}>
        <Text onPress={onPress} style={styles.listTitle}>{title}</Text>
        <Text onPress={onPress} style={styles.listSubtitle}>{subtitle}</Text>
        <Text onPress={onPress} style={styles.listId}>{id}</Text>
      </View>
      <Pill label={status} tone={statusTone(status)} />
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
function ReportField({ label, value }: { label: string; value?: string }) { return <View style={styles.reportField}><Text style={styles.reportLabel}>{label}</Text><Text style={styles.reportValue}>{value || 'No registrado todavía.'}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  filterRow: { flexDirection: 'row', gap: 7, paddingBottom: 12 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  listCard: { flex: 1, minWidth: 330, maxWidth: 470 },
  detailColumn: { flex: 1.7, minWidth: 350, gap: 18 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  listRowActive: { backgroundColor: colors.primaryLight },
  listTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  listSubtitle: { color: colors.muted, fontSize: 10, marginTop: 4 },
  listId: { color: colors.primary, fontSize: 9, marginTop: 4, fontWeight: '800' },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  orderId: { color: colors.primary, fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  orderClient: { color: colors.text, fontWeight: '900', fontSize: 22, marginTop: 5 },
  orderMeta: { color: colors.muted, fontSize: 12, marginTop: 5 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 20, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.border },
  info: { flex: 1, minWidth: 145 },
  infoLabel: { color: colors.muted, fontWeight: '900', fontSize: 9, textTransform: 'uppercase' },
  infoValue: { color: colors.text, fontWeight: '800', fontSize: 12, marginTop: 5 },
  bodyText: { color: colors.text, lineHeight: 21 },
  noteBox: { marginTop: 16, padding: 14, backgroundColor: colors.warningLight, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: colors.warning },
  noteTitle: { color: colors.warning, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  noteText: { color: colors.text, marginTop: 6, lineHeight: 19 },
  reportField: { marginBottom: 16 },
  reportLabel: { color: colors.muted, fontWeight: '900', fontSize: 10, textTransform: 'uppercase' },
  reportValue: { color: colors.text, marginTop: 5, lineHeight: 20 },
  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  measure: { minWidth: 120, flex: 1, backgroundColor: '#F6F8FB', borderRadius: 10, padding: 12 },
  measureKey: { color: colors.muted, fontSize: 9, textTransform: 'uppercase' },
  measureValue: { color: colors.text, fontWeight: '900', marginTop: 5 },
  evidenceSection: { marginTop: 18 },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  evidenceItem: { width: 150, gap: 4 },
  evidenceImage: { width: 150, height: 112, borderRadius: 10, backgroundColor: '#EEF2F6' },
  evidenceLabel: { color: colors.text, fontSize: 10, fontWeight: '800' },
  evidenceMeta: { color: colors.muted, fontSize: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
});
