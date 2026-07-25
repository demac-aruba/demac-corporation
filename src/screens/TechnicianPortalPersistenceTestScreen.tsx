import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Pill, SectionTitle, statusTone } from '../components/UI';
import { getTechnicianReportTemplate } from '../features/technicianPortal/templates';
import { InterventionType } from '../features/technicianPortal/contracts';
import { useTechnicianPortalState } from '../state/TechnicianPortalState';
import { useAppState } from '../state/TeamState';
import { colors } from '../theme';

const CLOSED_STATUSES = ['Cancelada', 'Reprogramada'] as const;

function templateForService(serviceName?: string): { type: InterventionType; templateId: string } {
  const normalized = (serviceName ?? '').toLowerCase();
  if (normalized.includes('profundo')) return { type: 'deep_service', templateId: 'service_deep' };
  if (normalized.includes('repar')) return { type: 'repair', templateId: 'repair' };
  if (normalized.includes('instal')) return { type: 'installation', templateId: 'installation' };
  if (normalized.includes('diagn')) return { type: 'diagnostic', templateId: 'diagnostic' };
  if (normalized.includes('cheque') || normalized.includes('check')) return { type: 'checkup', templateId: 'checkup' };
  return { type: 'standard_service', templateId: 'service_standard' };
}

export function TechnicianPortalPersistenceTestScreen() {
  const { workOrders, clients, services, currentUser } = useAppState();
  const {
    workVisits,
    visitUnits,
    workInterventions,
    loading,
    dataError,
    lastSyncedAt,
    refreshTechnicianPortalData,
    prepareVisitFromWorkOrder,
    addVisitUnit,
    addWorkIntervention,
  } = useTechnicianPortalState();
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Selecciona una orden real para probar la nueva estructura sin modificar el reporte antiguo.');

  const eligibleOrders = useMemo(() => workOrders
    .filter((order) => !CLOSED_STATUSES.includes(order.status as typeof CLOSED_STATUSES[number]))
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))
    .slice(0, 12), [workOrders]);

  useEffect(() => {
    if (!selectedOrderId && eligibleOrders.length) setSelectedOrderId(eligibleOrders[0].id);
  }, [eligibleOrders, selectedOrderId]);

  const selectedOrder = eligibleOrders.find((order) => order.id === selectedOrderId);
  const selectedClient = clients.find((client) => client.id === selectedOrder?.clientId);
  const selectedService = services.find((service) => service.id === selectedOrder?.serviceId);
  const selectedVisit = workVisits.find((visit) => visit.workOrderId === selectedOrderId);
  const selectedUnits = visitUnits.filter((unit) => unit.visitId === selectedVisit?.id);
  const selectedInterventions = workInterventions.filter((intervention) => intervention.visitId === selectedVisit?.id);

  async function prepareVisit() {
    if (!selectedOrder) return;
    setWorking(true);
    const { result, visit } = await prepareVisitFromWorkOrder(selectedOrder, {
      serviceName: selectedService?.name,
      participatingStaffIds: selectedOrder.technicianIds,
    });
    setWorking(false);
    setMessage(result.ok
      ? `Visita ${visit?.id ?? ''} preparada. El booking original quedó guardado como snapshot.`
      : result.message ?? 'No se pudo preparar la visita.');
  }

  async function addUnit() {
    if (!selectedOrder || !selectedVisit) return;
    setWorking(true);
    const number = selectedUnits.length + 1;
    const { result, unit } = await addVisitUnit({
      visitId: selectedVisit.id,
      workOrderId: selectedOrder.id,
      locationLabel: `Aire ${number}`,
      source: number <= selectedVisit.scheduledScopeSnapshot.estimatedUnitCount ? 'scheduled' : 'registered_on_site',
      addedOnSite: number > selectedVisit.scheduledScopeSnapshot.estimatedUnitCount,
      addedReason: number > selectedVisit.scheduledScopeSnapshot.estimatedUnitCount ? 'Agregado durante prueba del Portal del Técnico v2.' : undefined,
    });
    setWorking(false);
    setMessage(result.ok ? `${unit?.locationLabel ?? 'Aire'} agregado a la visita.` : result.message ?? 'No se pudo agregar el aire.');
  }

  async function addPrimaryIntervention() {
    if (!selectedVisit || !selectedUnits.length) return;
    const unit = selectedUnits.find((candidate) => !selectedInterventions.some((intervention) => intervention.visitUnitId === candidate.id)) ?? selectedUnits[0];
    const serviceTemplate = templateForService(selectedService?.name);
    const template = getTechnicianReportTemplate(serviceTemplate.templateId);
    if (!template) {
      setMessage('No se encontró la plantilla correspondiente.');
      return;
    }
    if (selectedInterventions.some((intervention) => intervention.visitUnitId === unit.id && intervention.isPrimary)) {
      setMessage(`${unit.locationLabel} ya tiene una intervención principal.`);
      return;
    }
    setWorking(true);
    const { result, intervention } = await addWorkIntervention({
      visitId: selectedVisit.id,
      visitUnitId: unit.id,
      equipmentSystemId: unit.equipmentSystemId,
      type: serviceTemplate.type,
      templateId: template.id,
      templateVersion: template.version,
      isPrimary: true,
      requestedBy: 'office',
    });
    setWorking(false);
    setMessage(result.ok
      ? `Intervención ${intervention?.templateId ?? ''} creada para ${unit.locationLabel}.`
      : result.message ?? 'No se pudo crear la intervención.');
  }

  function returnToPreview() {
    if (typeof window === 'undefined') return;
    window.location.assign(`${window.location.pathname}?technicianPortalV2=1`);
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>PORTAL DEL TÉCNICO V2</Text>
          <Text style={styles.title}>Prueba de persistencia</Text>
          <Text style={styles.copy}>Crea documentos nuevos de visita, aire e intervención sin reemplazar la cita ni el reporte técnico actual.</Text>
        </View>
        <Pill label={currentUser?.authProvider === 'firebase' ? 'Firebase real' : 'Modo demo'} tone={currentUser?.authProvider === 'firebase' ? 'success' : 'warning'} />
      </View>

      <View style={styles.metrics}>
        <Metric label="Visitas" value={workVisits.length} />
        <Metric label="Aires" value={visitUnits.length} />
        <Metric label="Intervenciones" value={workInterventions.length} />
      </View>

      {dataError ? <View style={styles.errorBox}><Text style={styles.errorText}>{dataError}</Text></View> : null}

      <Card>
        <SectionTitle title="Seleccionar orden real" subtitle="Solo se muestran órdenes activas o históricas no canceladas" />
        {eligibleOrders.length ? eligibleOrders.map((order) => {
          const client = clients.find((item) => item.id === order.clientId);
          const service = services.find((item) => item.id === order.serviceId);
          const active = order.id === selectedOrderId;
          return (
            <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={[styles.orderRow, active && styles.orderRowActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderId}>{order.id}</Text>
                <Text style={styles.orderClient}>{client?.name ?? 'Cliente'}</Text>
                <Text style={styles.orderMeta}>{order.date} · {order.time} · {service?.name ?? order.problem}</Text>
              </View>
              <Pill label={order.status} tone={statusTone(order.status)} />
            </Pressable>
          );
        }) : <EmptyState icon="📋" title="Sin órdenes disponibles" message="Crea o asigna una cita antes de probar la persistencia." />}
      </Card>

      {selectedOrder ? (
        <Card>
          <SectionTitle title={selectedClient?.name ?? 'Cliente'} subtitle={`${selectedOrder.id} · ${selectedService?.name ?? selectedOrder.problem}`} />
          <View style={styles.snapshotBox}>
            <Text style={styles.snapshotTitle}>ALCANCE PROGRAMADO</Text>
            <Text style={styles.snapshotText}>{selectedOrder.airConditionerCount ?? 1} aire(s) · {selectedOrder.problem}</Text>
            {selectedOrder.officeNotes ? <Text style={styles.snapshotNote}>Instrucciones internas: {selectedOrder.officeNotes}</Text> : null}
          </View>

          <View style={styles.actionRow}>
            <Button label={selectedVisit ? 'Visita ya preparada' : working ? 'Preparando…' : '1. Preparar visita'} disabled={working || Boolean(selectedVisit)} onPress={() => void prepareVisit()} />
            <Button variant="secondary" label={working ? 'Guardando…' : '2. Agregar aire'} disabled={working || !selectedVisit} onPress={() => void addUnit()} />
            <Button variant="secondary" label={working ? 'Guardando…' : '3. Crear intervención'} disabled={working || !selectedUnits.length} onPress={() => void addPrimaryIntervention()} />
          </View>

          {selectedVisit ? (
            <View style={styles.persistedBox}>
              <Text style={styles.persistedTitle}>VISITA PERSISTIDA</Text>
              <Text style={styles.persistedText}>ID: {selectedVisit.id}</Text>
              <Text style={styles.persistedText}>Snapshot: {selectedVisit.scheduledScopeSnapshot.estimatedUnitCount} aire(s)</Text>
              <Text style={styles.persistedText}>Aires reales registrados: {selectedUnits.length}</Text>
              <Text style={styles.persistedText}>Intervenciones: {selectedInterventions.length}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.messageBox}>
        <Text style={styles.messageTitle}>Resultado</Text>
        <Text style={styles.messageText}>{message}</Text>
        <Text style={styles.syncText}>Última sincronización: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('es-AW') : loading ? 'Sincronizando…' : 'Pendiente'}</Text>
      </View>

      <View style={styles.footerActions}>
        <Button variant="secondary" label="Actualizar datos" disabled={loading} onPress={() => void refreshTechnicianPortalData()} />
        <Button variant="secondary" label="Volver al diseño piloto" onPress={returnToPreview} />
      </View>
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 90, backgroundColor: '#F7F9FC' },
  hero: { backgroundColor: colors.primary, borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#A9D1FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginTop: 5 },
  copy: { color: '#D8E9FF', marginTop: 7, lineHeight: 19 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flex: 1, minWidth: 120, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14 },
  metricValue: { color: colors.primary, fontSize: 24, fontWeight: '900' },
  metricLabel: { color: colors.muted, fontSize: 10, marginTop: 3, fontWeight: '700' },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 12, padding: 13 },
  errorText: { color: colors.danger, fontWeight: '800', lineHeight: 18 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', marginBottom: 7 },
  orderRowActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  orderId: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  orderClient: { color: colors.text, fontWeight: '900', marginTop: 3 },
  orderMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  snapshotBox: { backgroundColor: '#F6F8FB', borderRadius: 12, padding: 13, marginBottom: 14 },
  snapshotTitle: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  snapshotText: { color: colors.text, fontWeight: '800', marginTop: 6, lineHeight: 18 },
  snapshotNote: { color: colors.muted, marginTop: 6, lineHeight: 17 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  persistedBox: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 13, marginTop: 14 },
  persistedTitle: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  persistedText: { color: colors.text, marginTop: 5, fontWeight: '700' },
  messageBox: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14 },
  messageTitle: { color: colors.text, fontWeight: '900' },
  messageText: { color: colors.text, marginTop: 6, lineHeight: 18 },
  syncText: { color: colors.muted, fontSize: 9, marginTop: 8 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
});
