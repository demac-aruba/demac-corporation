import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { InterventionType } from '../features/technicianPortal/contracts';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';

const WORK_LABELS: Record<InterventionType, string> = {
  standard_service: 'Servicio estándar',
  deep_service: 'Servicio profundo',
  repair: 'Reparación',
  installation: 'Instalación',
  diagnostic: 'Diagnóstico',
  checkup: 'Chequeo',
};

function unique(values: (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function WorkOrdersScreen() {
  const { workOrders, workOrderEvidence, clients, services } = useAppState();
  const { staffProfiles, vans, dailyVanAssignments } = useTeamState();
  const { workVisits, visitUnits, workInterventions, equipmentSystems, workReportSections } = useTechnicianPortalState();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(workOrders[0]?.id ?? '');
  const [statusFilter, setStatusFilter] = useState('Todos');

  const filtered = useMemo(() => workOrders.filter((order) => {
    const client = clients.find((item) => item.id === order.clientId);
    const matchQuery = `${order.id} ${client?.name ?? ''} ${order.problem}`.toLowerCase().includes(query.toLowerCase());
    const matchStatus = statusFilter === 'Todos' || order.status === statusFilter;
    return matchQuery && matchStatus;
  }), [workOrders, clients, query, statusFilter]);

  const selected = workOrders.find((order) => order.id === selectedId);
  const client = clients.find((item) => item.id === selected?.clientId);
  const service = services.find((item) => item.id === selected?.serviceId);
  const visit = workVisits.find((item) => item.workOrderId === selected?.id);
  const visitUnitIds = visitUnits.filter((item) => item.visitId === visit?.id).map((item) => item.id);
  const reports = workInterventions
    .filter((item) => visitUnitIds.includes(item.visitUnitId) && item.status !== 'cancelled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const evidence = workOrderEvidence.filter((item) => item.workOrderId === selected?.id);

  const assignedStaffIds = unique([
    ...(selected?.technicianIds ?? []),
    ...(visit?.participatingStaffIds ?? []),
    visit?.leadTechnicianStaffId,
  ]);
  const technicianNames = unique([
    ...assignedStaffIds.map((id) => staffProfiles.find((staff) => staff.id === id)?.name),
    ...evidence.map((item) => item.uploadedByName),
  ]);
  const dailyAssignment = dailyVanAssignments.find((assignment) => assignment.date === selected?.date
    && [assignment.driverStaffId, assignment.helperStaffId].some((id) => id && assignedStaffIds.includes(id)));
  const primaryVanId = assignedStaffIds.map((id) => staffProfiles.find((staff) => staff.id === id)?.primaryVanId).find(Boolean);
  const assignedVan = vans.find((item) => item.id === selected?.vanId)
    ?? vans.find((item) => item.id === dailyAssignment?.vanId)
    ?? vans.find((item) => item.id === primaryVanId);

  const statuses = ['Todos', 'Solicitud recibida', 'Reserva temporal', 'Confirmada', 'Asignada', 'En proceso', 'Pendiente', 'Completada', 'Reprogramada', 'Cancelada', 'Facturada', 'Pagada'];

  function openReview(interventionId?: string) {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    params.set('screen', 'reportReview');
    if (interventionId) params.set('interventionId', interventionId);
    window.location.assign(`${window.location.pathname}?${params.toString()}`);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Órdenes de trabajo" subtitle="Supervisa asignación, alcance y reportes enviados por el Portal del Técnico." />
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
            return <ButtonRow key={order.id} active={selectedId === order.id} onPress={() => setSelectedId(order.id)} title={orderClient?.name ?? 'Cliente'} subtitle={`${order.date} · ${order.time} · ${orderService?.name ?? 'Servicio'}`} id={order.id} status={order.status} />;
          }) : <EmptyState icon="🧰" title="Sin órdenes" message="No hay resultados para los filtros seleccionados." />}
        </Card>

        <View style={styles.detailColumn}>
          {selected ? (
            <>
              <Card>
                <View style={styles.orderHeader}>
                  <View style={{ flex: 1 }}><Text style={styles.orderId}>{selected.id}</Text><Text style={styles.orderClient}>{client?.name}</Text><Text style={styles.orderMeta}>{service?.name} · {selected.date} a las {selected.time}</Text></View>
                  <Pill label={selected.status} tone={statusTone(selected.status)} />
                </View>
                <View style={styles.infoGrid}>
                  <Info label="Dirección" value={selected.address} />
                  <Info label="Van" value={assignedVan?.name ?? 'Sin asignar'} />
                  <Info label="Técnicos" value={technicianNames.join(', ') || 'Sin asignar'} />
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
                <SectionTitle title="Reportes del Portal del Técnico" subtitle="La revisión, aprobación y generación del PDF se realizan en Revisión" action={<Button compact variant="secondary" label="Abrir Revisión" onPress={() => openReview(reports.find((item) => item.status === 'ready_for_review')?.id)} />} />
                {reports.length ? reports.map((report) => {
                  const unit = visitUnits.find((item) => item.id === report.visitUnitId);
                  const equipment = equipmentSystems.find((item) => item.id === report.equipmentSystemId || item.id === unit?.equipmentSystemId);
                  const sections = workReportSections.filter((item) => item.interventionId === report.id);
                  const completed = sections.filter((item) => item.status === 'completed' || item.status === 'not_applicable').length;
                  const status = report.status === 'ready_for_review' ? 'Pendiente de revisión' : report.status === 'changes_requested' ? 'Corrección solicitada' : report.status === 'completed' ? 'Aprobado' : 'En proceso';
                  return (
                    <View key={report.id} style={styles.reportRow}>
                      <View style={{ flex: 1 }}><Text style={styles.reportType}>{WORK_LABELS[report.type]}</Text><Text style={styles.reportName}>{equipment?.locationLabel ?? unit?.locationLabel ?? 'Aire acondicionado'}</Text><Text style={styles.reportMeta}>{completed}/{sections.length} secciones cerradas · {evidence.filter((item) => item.unitId === unit?.id).length} fotografías</Text><Text style={styles.reportMeta}>Última actualización: {report.updatedByName}</Text></View>
                      <View style={styles.reportActions}><Pill label={status} tone={report.status === 'completed' ? 'success' : report.status === 'changes_requested' ? 'warning' : 'info'} /><Button compact label={report.status === 'completed' ? 'Ver / PDF' : 'Abrir en Revisión'} onPress={() => openReview(report.id)} /></View>
                    </View>
                  );
                }) : <EmptyState icon="🧾" title="Sin reportes del nuevo portal" message="Cuando el técnico envíe un reporte, aparecerá aquí y en la bandeja Revisión." />}
              </Card>
            </>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function ButtonRow({ active, onPress, title, subtitle, id, status }: { active: boolean; onPress: () => void; title: string; subtitle: string; id: string; status: string }) {
  return <View style={[styles.listRow, active && styles.listRowActive]}><View style={{ flex: 1 }}><Text onPress={onPress} style={styles.listTitle}>{title}</Text><Text onPress={onPress} style={styles.listSubtitle}>{subtitle}</Text><Text onPress={onPress} style={styles.listId}>{id}</Text></View><Pill label={status} tone={statusTone(status)} /></View>;
}
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

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
  reportRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, marginBottom: 9 },
  reportType: { color: colors.primary, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  reportName: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 4 },
  reportMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  reportActions: { alignItems: 'flex-end', gap: 8 },
});
