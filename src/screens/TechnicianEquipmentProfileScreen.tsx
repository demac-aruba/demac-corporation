import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Pill, SectionTitle } from '../components/UI';
import { InterventionType, WorkIntervention } from '../features/technicianPortal/contracts';
import { useAppState } from '../state/AppState';
import { useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';

type WorkTypeDefinition = {
  type: InterventionType;
  label: string;
  description: string;
  templateId: string;
};

const WORK_TYPES: WorkTypeDefinition[] = [
  {
    type: 'standard_service',
    label: 'Servicio estándar',
    description: 'Limpieza y revisión con la unidad instalada.',
    templateId: 'service_standard',
  },
  {
    type: 'deep_service',
    label: 'Servicio profundo',
    description: 'Desmontaje o desinstalación completa para una limpieza profunda.',
    templateId: 'service_deep',
  },
  {
    type: 'repair',
    label: 'Reparación',
    description: 'Corrección de una falla o reemplazo de un componente.',
    templateId: 'repair',
  },
  {
    type: 'installation',
    label: 'Instalación',
    description: 'Instalación, puesta en marcha y entrega del equipo.',
    templateId: 'installation',
  },
  {
    type: 'diagnostic',
    label: 'Diagnóstico',
    description: 'Investigación de una falla concreta y de su causa.',
    templateId: 'diagnostic',
  },
  {
    type: 'checkup',
    label: 'Chequeo',
    description: 'Inspección general del estado y funcionamiento.',
    templateId: 'checkup',
  },
];

function queryValue(name: string) {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

function workTypeLabel(type: InterventionType) {
  return WORK_TYPES.find((item) => item.type === type)?.label ?? type;
}

function interventionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: 'Por iniciar',
    in_progress: 'En proceso',
    pending_authorization: 'Por autorizar',
    pending_part: 'Pendiente por pieza',
    ready_for_review: 'Listo para revisión',
    completed: 'Completado',
    cancelled: 'Cancelado',
  };
  return labels[status] ?? status.replace(/_/g, ' ');
}

function formatBtu(value?: number) {
  return value ? `${value.toLocaleString('en-US')} BTU` : 'BTU pendiente';
}

export function TechnicianEquipmentProfileScreen() {
  const { clients, properties, currentUser } = useAppState();
  const {
    workVisits,
    visitUnits,
    workInterventions,
    equipmentSystems,
    addWorkIntervention,
    saveWorkIntervention,
  } = useTechnicianPortalState();

  const visitId = useMemo(() => queryValue('visitId'), []);
  const unitId = useMemo(() => queryValue('unitId'), []);
  const returnToTechnician = useMemo(() => queryValue('returnTo') === 'technician', []);
  const [working, setWorking] = useState(false);
  const [pendingRemovalId, setPendingRemovalId] = useState('');
  const [message, setMessage] = useState('Selecciona el trabajo real que se realizará en este aire acondicionado.');

  const visit = workVisits.find((item) => item.id === visitId);
  const unit = visitUnits.find((item) => item.id === unitId && item.visitId === visitId);
  const equipment = equipmentSystems.find((item) => item.id === unit?.equipmentSystemId);
  const client = clients.find((item) => item.id === visit?.clientId);
  const property = properties.find((item) => item.id === visit?.propertyId);
  const allInterventions = workInterventions
    .filter((item) => item.visitUnitId === unitId)
    .sort((first, second) => Number(second.isPrimary) - Number(first.isPrimary) || first.createdAt.localeCompare(second.createdAt));
  const interventions = allInterventions.filter((item) => item.status !== 'cancelled');
  const primaryIntervention = interventions.find((item) => item.isPrimary) ?? interventions[0];
  const mainComponent = equipment?.components.find((item) => item.componentType === 'indoor') ?? equipment?.components[0];

  function goBack() {
    if (typeof window === 'undefined') return;
    const workOrderId = visit?.workOrderId ?? '';
    const returnParameter = returnToTechnician ? '&returnTo=technician' : '';
    window.location.assign(`${window.location.pathname}?technicianPortalEquipment=1&workOrderId=${encodeURIComponent(workOrderId)}${returnParameter}`);
  }

  async function createIntervention(definition: WorkTypeDefinition) {
    if (!visit || !unit || !equipment) {
      setMessage('No se encontró la visita o el equipo seleccionado.');
      return;
    }

    const duplicate = interventions.some((item) => item.type === definition.type);
    if (duplicate) {
      setMessage(`${definition.label} ya está agregado para este aire.`);
      return;
    }

    setWorking(true);
    const isPrimary = !primaryIntervention;
    const { result } = await addWorkIntervention({
      visitId: visit.id,
      visitUnitId: unit.id,
      equipmentSystemId: equipment.id,
      type: definition.type,
      templateId: definition.templateId,
      templateVersion: 1,
      isPrimary,
      requestedBy: 'technician',
    });
    setWorking(false);

    setMessage(result.ok
      ? `${definition.label} ${isPrimary ? 'seleccionado como trabajo principal' : 'agregado como trabajo adicional'}.`
      : result.message ?? 'No se pudo guardar el trabajo.');
  }

  async function removeIntervention(intervention: WorkIntervention) {
    if (!currentUser) {
      setMessage('No se encontró el usuario activo.');
      return;
    }
    if (intervention.status === 'ready_for_review' || intervention.status === 'completed') {
      setPendingRemovalId('');
      setMessage('Este trabajo ya fue enviado o completado. La oficina debe corregirlo desde la revisión.');
      return;
    }

    setWorking(true);
    const now = new Date().toISOString();
    const removalNote = `Trabajo quitado por selección incorrecta. Usuario: ${currentUser.name}. Fecha: ${now}.`;
    const result = await saveWorkIntervention({
      ...intervention,
      status: 'cancelled',
      resultNotes: [intervention.resultNotes, removalNote].filter(Boolean).join('\n'),
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? intervention.updatedByStaffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(intervention.version ?? 1)) + 1,
    });
    setWorking(false);
    setPendingRemovalId('');
    setMessage(result.ok
      ? `${workTypeLabel(intervention.type)} fue quitado de este aire. El registro queda conservado en el historial de auditoría.`
      : result.message ?? 'No se pudo quitar el trabajo.');
  }

  if (!visit || !unit || !equipment) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card>
          <EmptyState
            icon="❄"
            title="No se encontró el perfil del aire"
            message="Regresa a la lista de equipos y abre nuevamente el aire registrado."
          />
          <Button variant="secondary" label="Volver a equipos" onPress={goBack} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>PORTAL DEL TÉCNICO V2</Text>
          <Text style={styles.title}>{equipment.locationLabel}</Text>
          <Text style={styles.copy}>{mainComponent?.brand ?? 'Marca pendiente'} · {formatBtu(mainComponent?.btu)}</Text>
        </View>
        <Pill label="Equipo registrado" tone="success" />
      </View>

      <Card>
        <SectionTitle
          title="Perfil del aire acondicionado"
          subtitle={`${client?.name ?? 'Cliente'} · ${property?.name ?? property?.address ?? 'Propiedad'}`}
          action={<Button compact label="Volver" variant="ghost" onPress={goBack} />}
        />
        <View style={styles.identityGrid}>
          <Fact label="Tipo de sistema" value={equipment.systemType} />
          <Fact label="Marca" value={mainComponent?.brand ?? 'Pendiente'} />
          <Fact label="Capacidad" value={formatBtu(mainComponent?.btu)} />
          <Fact label="Refrigerante" value={mainComponent?.refrigerant ?? 'Pendiente'} />
          <Fact label="Voltaje" value={mainComponent?.voltage ? `${mainComponent.voltage} V` : 'Pendiente'} />
          <Fact label="Código QR" value={equipment.qrCode || 'Sin QR vinculado'} />
        </View>
      </Card>

      <Card>
        <SectionTitle title="Alcance de esta visita" subtitle="La cita original permanece separada del trabajo real" />
        <View style={styles.scopeGrid}>
          <View style={styles.scopeBox}>
            <Text style={styles.scopeLabel}>PROGRAMADO POR LA OFICINA</Text>
            <Text style={styles.scopeValue}>{visit.scheduledScopeSnapshot.serviceName ?? 'Trabajo por confirmar'}</Text>
            <Text style={styles.scopeMeta}>{visit.scheduledScopeSnapshot.estimatedUnitCount} aire(s) estimado(s)</Text>
          </View>
          <View style={styles.scopeBox}>
            <Text style={styles.scopeLabel}>TRABAJO REAL EN ESTE AIRE</Text>
            <Text style={styles.scopeValue}>{primaryIntervention ? workTypeLabel(primaryIntervention.type) : 'Aún no seleccionado'}</Text>
            <Text style={styles.scopeMeta}>{interventions.length} trabajo(s) activo(s)</Text>
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle
          title={primaryIntervention ? 'Trabajos registrados' : '¿Qué trabajo se realizará?'}
          subtitle={primaryIntervention ? 'Puedes abrir el reporte, añadir otro trabajo o quitar una selección incorrecta' : 'La primera selección será el trabajo principal'}
        />

        {interventions.map((intervention) => {
          const effectivePrimary = intervention.id === primaryIntervention?.id;
          const canRemove = intervention.status !== 'ready_for_review' && intervention.status !== 'completed';
          return (
            <View key={intervention.id} style={[styles.interventionCard, effectivePrimary && styles.primaryIntervention]}>
              <View style={styles.interventionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.interventionRole}>{effectivePrimary ? 'TRABAJO PRINCIPAL' : 'TRABAJO ADICIONAL'}</Text>
                  <Text style={styles.interventionName}>{workTypeLabel(intervention.type)}</Text>
                  <Text style={styles.interventionMeta}>Plantilla {intervention.templateId} · versión {intervention.templateVersion}</Text>
                </View>
                <Pill label={interventionStatusLabel(intervention.status)} tone="info" />
              </View>

              {pendingRemovalId === intervention.id ? (
                <View style={styles.removalConfirm}>
                  <Text style={styles.removalTitle}>¿Quitar {workTypeLabel(intervention.type)}?</Text>
                  <Text style={styles.removalText}>El trabajo desaparecerá de la lista activa. La información existente se conservará únicamente como historial de auditoría.</Text>
                  <View style={styles.removalActions}>
                    <Button compact variant="secondary" label="Cancelar" disabled={working} onPress={() => setPendingRemovalId('')} />
                    <Button compact variant="ghost" label={working ? 'Quitando…' : 'Confirmar y quitar'} disabled={working} onPress={() => void removeIntervention(intervention)} />
                  </View>
                </View>
              ) : (
                <View style={styles.interventionFooter}>
                  <Button
                    compact
                    variant="ghost"
                    label={canRemove ? 'Quitar trabajo' : 'No se puede quitar'}
                    disabled={working || !canRemove}
                    onPress={() => setPendingRemovalId(intervention.id)}
                  />
                </View>
              )}
            </View>
          );
        })}

        <Text style={styles.selectionTitle}>{primaryIntervention ? 'Agregar otro trabajo' : 'Seleccionar trabajo principal'}</Text>
        <View style={styles.workTypeGrid}>
          {WORK_TYPES.map((definition) => {
            const alreadyAdded = interventions.some((item) => item.type === definition.type);
            return (
              <View key={definition.type} style={[styles.workTypeCard, alreadyAdded && styles.workTypeDisabled]}>
                <Text style={styles.workTypeName}>{alreadyAdded ? '✓ ' : ''}{definition.label}</Text>
                <Text style={styles.workTypeDescription}>{alreadyAdded ? 'Ya agregado a este aire.' : definition.description}</Text>
                <Button
                  compact
                  label={alreadyAdded ? 'Agregado' : primaryIntervention ? 'Agregar trabajo' : 'Seleccionar'}
                  variant={alreadyAdded ? 'secondary' : 'primary'}
                  disabled={working || alreadyAdded}
                  onPress={() => void createIntervention(definition)}
                />
              </View>
            );
          })}
        </View>
      </Card>

      <View style={styles.messageBox}>
        <Text style={styles.messageTitle}>Estado</Text>
        <Text style={styles.messageText}>{message}</Text>
      </View>

      {interventions.length ? (
        <View style={styles.nextBox}>
          <Text style={styles.nextTitle}>Reportes por trabajo</Text>
          <Text style={styles.nextText}>Cada trabajo activo mantiene su propia plantilla técnica, fotografías, mediciones, hallazgos y estado de revisión.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 100, backgroundColor: '#F7F9FC' },
  hero: { backgroundColor: colors.primary, borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#A9D1FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginTop: 5 },
  copy: { color: '#D8E9FF', marginTop: 6, lineHeight: 18 },
  identityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  fact: { width: '31%', minWidth: 140, flexGrow: 1, backgroundColor: '#F7F9FC', borderRadius: 11, padding: 11 },
  factLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  factValue: { color: colors.text, fontWeight: '900', marginTop: 4 },
  scopeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scopeBox: { flex: 1, minWidth: 240, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13 },
  scopeLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  scopeValue: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: 5 },
  scopeMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  interventionCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, marginBottom: 9, backgroundColor: '#FFFFFF' },
  interventionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryIntervention: { borderColor: colors.primary, backgroundColor: '#F7FAFF' },
  interventionRole: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  interventionName: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: 4 },
  interventionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  interventionFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  removalConfirm: { backgroundColor: '#FFF8EC', borderRadius: 10, padding: 11, marginTop: 10 },
  removalTitle: { color: '#8A5200', fontSize: 11, fontWeight: '900' },
  removalText: { color: colors.text, fontSize: 9, lineHeight: 14, marginTop: 4 },
  removalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 9 },
  selectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 12, marginBottom: 9 },
  workTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  workTypeCard: { width: '48%', minWidth: 230, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 13, gap: 8, backgroundColor: '#FFFFFF' },
  workTypeDisabled: { opacity: 0.55, backgroundColor: '#F4F6F8' },
  workTypeName: { color: colors.text, fontSize: 13, fontWeight: '900' },
  workTypeDescription: { color: colors.muted, fontSize: 9, lineHeight: 14, minHeight: 28 },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 13, padding: 13 },
  messageTitle: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  messageText: { color: colors.text, marginTop: 5, lineHeight: 18 },
  nextBox: { backgroundColor: '#F3F7F3', borderRadius: 13, padding: 13 },
  nextTitle: { color: '#30643B', fontWeight: '900' },
  nextText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },
});
