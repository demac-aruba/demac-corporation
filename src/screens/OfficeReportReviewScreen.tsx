import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';
import { InterventionStatus, InterventionType, ReportSection, WorkIntervention } from '../features/technicianPortal/contracts';
import { getTechnicianReportTemplate, TemplateFieldDefinition } from '../features/technicianPortal/templates';
import { useAppState } from '../state/AppState';
import { useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';
import { WorkOrderEvidence } from '../types';

type ReviewFilter = 'pending' | 'changes_requested' | 'approved';

const WORK_LABELS: Record<InterventionType, string> = {
  standard_service: 'Servicio estándar',
  deep_service: 'Servicio profundo',
  repair: 'Reparación',
  installation: 'Instalación',
  diagnostic: 'Diagnóstico',
  checkup: 'Chequeo',
};

function statusLabel(status: InterventionStatus) {
  const labels: Record<InterventionStatus, string> = {
    draft: 'Por iniciar',
    in_progress: 'En proceso',
    pending_authorization: 'Por autorizar',
    pending_part: 'Pendiente por pieza',
    ready_for_review: 'Pendiente de revisión',
    changes_requested: 'Corrección solicitada',
    completed: 'Aprobado',
    cancelled: 'Cancelado',
  };
  return labels[status];
}

function statusTone(status: InterventionStatus): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'completed') return 'success';
  if (status === 'ready_for_review') return 'info';
  if (status === 'changes_requested' || status === 'pending_part' || status === 'pending_authorization') return 'warning';
  return 'neutral';
}

function formatDate(value?: string) {
  if (!value) return 'Fecha pendiente';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-AW');
}

function fieldValue(value: ReportSection['fields'][string], field: TemplateFieldDefinition) {
  if (value === null || value === undefined || value === '') return 'Sin información';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.join(', ') || 'Sin información';
  return `${String(value)}${field.unit ? ` ${field.unit}` : ''}`;
}

function appendAuditNote(existing: string | undefined, title: string, note: string, reviewer: string, timestamp: string) {
  const entry = `[${title}] ${note}\nRevisado por: ${reviewer}\nFecha: ${timestamp}`;
  return [existing, entry].filter(Boolean).join('\n\n');
}

export function OfficeReportReviewScreen() {
  const {
    currentUser,
    clients,
    properties,
    workOrders,
    workOrderEvidence,
  } = useAppState();
  const {
    workVisits,
    visitUnits,
    workInterventions,
    workReportSections,
    equipmentSystems,
    saveWorkIntervention,
    saveVisitUnit,
    refreshTechnicianPortalData,
    loading,
  } = useTechnicianPortalState();

  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [selectedInterventionId, setSelectedInterventionId] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Selecciona un reporte pendiente para revisar sus secciones, mediciones y fotografías.');

  const allowed = currentUser && ['admin', 'office', 'supervisor'].includes(currentUser.role);
  const reviewable = useMemo(() => workInterventions
    .filter((item) => item.status === 'ready_for_review' || item.status === 'changes_requested' || item.status === 'completed')
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)), [workInterventions]);

  const filtered = reviewable.filter((item) => {
    if (filter === 'pending') return item.status === 'ready_for_review';
    if (filter === 'changes_requested') return item.status === 'changes_requested';
    return item.status === 'completed';
  });

  const selected = reviewable.find((item) => item.id === selectedInterventionId);
  const selectedVisit = workVisits.find((item) => item.id === selected?.visitId);
  const selectedUnit = visitUnits.find((item) => item.id === selected?.visitUnitId);
  const selectedEquipment = equipmentSystems.find((item) => item.id === selected?.equipmentSystemId || item.id === selectedUnit?.equipmentSystemId);
  const selectedClient = clients.find((item) => item.id === selectedVisit?.clientId);
  const selectedProperty = properties.find((item) => item.id === selectedVisit?.propertyId);
  const selectedOrder = workOrders.find((item) => item.id === selectedVisit?.workOrderId);
  const selectedTemplate = selected ? getTechnicianReportTemplate(selected.templateId, selected.templateVersion) : undefined;
  const selectedSections = selectedTemplate
    ? selectedTemplate.sections.map((definition) => ({
        definition,
        section: workReportSections.find((item) => item.interventionId === selected?.id && item.sectionType === definition.sectionType),
      }))
    : [];

  const pendingCount = reviewable.filter((item) => item.status === 'ready_for_review').length;
  const correctionsCount = reviewable.filter((item) => item.status === 'changes_requested').length;
  const approvedCount = reviewable.filter((item) => item.status === 'completed').length;

  function evidenceFor(value: ReportSection['fields'][string]) {
    if (typeof value !== 'string') return undefined;
    return workOrderEvidence.find((item) => item.id === value);
  }

  function openReport(intervention: WorkIntervention) {
    setSelectedInterventionId(intervention.id);
    setCorrectionNote('');
    setMessage(`Revisando ${WORK_LABELS[intervention.type]}.`);
  }

  function closeReport() {
    setSelectedInterventionId('');
    setCorrectionNote('');
    setMessage('Selecciona otro reporte para revisar.');
  }

  async function approveReport() {
    if (!selected || !selectedUnit || !currentUser) return;
    setWorking(true);
    const now = new Date().toISOString();
    const approvalNote = appendAuditNote(
      selected.resultNotes,
      'REPORTE APROBADO',
      correctionNote.trim() || 'Reporte técnico revisado y aprobado sin observaciones adicionales.',
      currentUser.name,
      now,
    );
    const result = await saveWorkIntervention({
      ...selected,
      status: 'completed',
      resultCode: 'approved',
      resultNotes: approvalNote,
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: currentUser.staffId ?? selected.updatedByStaffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(selected.version ?? 1)) + 1,
    });

    if (!result.ok) {
      setWorking(false);
      setMessage(result.message ?? 'No se pudo aprobar el reporte.');
      return;
    }

    const activeInterventions = workInterventions
      .filter((item) => item.visitUnitId === selected.visitUnitId && item.status !== 'cancelled')
      .map((item) => item.id === selected.id ? { ...item, status: 'completed' as const } : item);
    if (activeInterventions.length && activeInterventions.every((item) => item.status === 'completed')) {
      await saveVisitUnit({
        ...selectedUnit,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: currentUser.staffId ?? selectedUnit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(selectedUnit.version ?? 1)) + 1,
      });
    }

    setWorking(false);
    setMessage('Reporte aprobado. El trabajo quedó completado y el aire se cerrará cuando todos sus trabajos estén aprobados.');
    setSelectedInterventionId('');
    setCorrectionNote('');
  }

  async function returnForCorrection() {
    if (!selected || !currentUser) return;
    const note = correctionNote.trim();
    if (!note) {
      setMessage('Escribe qué debe corregir el técnico antes de devolver el reporte.');
      return;
    }

    setWorking(true);
    const now = new Date().toISOString();
    const result = await saveWorkIntervention({
      ...selected,
      status: 'changes_requested',
      resultCode: 'changes_requested',
      resultNotes: appendAuditNote(selected.resultNotes, 'CORRECCIÓN SOLICITADA', note, currentUser.name, now),
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: currentUser.staffId ?? selected.updatedByStaffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(selected.version ?? 1)) + 1,
    });
    setWorking(false);

    if (!result.ok) {
      setMessage(result.message ?? 'No se pudo devolver el reporte al técnico.');
      return;
    }

    setMessage('Reporte devuelto al técnico con la corrección solicitada.');
    setSelectedInterventionId('');
    setCorrectionNote('');
    setFilter('changes_requested');
  }

  if (!allowed) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card>
          <EmptyState icon="🔒" title="Acceso restringido" message="La revisión de reportes está disponible para oficina, supervisión y administración." />
        </Card>
      </ScrollView>
    );
  }

  if (selected && selectedTemplate && selectedUnit) {
    const mainComponent = selectedEquipment?.components.find((item) => item.componentType === 'indoor') ?? selectedEquipment?.components[0];
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>REVISIÓN DE REPORTE</Text>
            <Text style={styles.title}>{selectedEquipment?.locationLabel ?? selectedUnit.locationLabel}</Text>
            <Text style={styles.copy}>{WORK_LABELS[selected.type]} · {selectedClient?.name ?? 'Cliente'}</Text>
          </View>
          <Pill label={statusLabel(selected.status)} tone={statusTone(selected.status)} />
        </View>

        <Card>
          <SectionTitle
            title="Resumen del trabajo"
            subtitle={`${selectedProperty?.name ?? selectedProperty?.address ?? selectedOrder?.address ?? 'Propiedad'} · enviado ${formatDate(selected.updatedAt)}`}
            action={<Button compact variant="ghost" label="Volver a bandeja" onPress={closeReport} />}
          />
          <View style={styles.factGrid}>
            <Fact label="Cliente" value={selectedClient?.name ?? 'Pendiente'} />
            <Fact label="Aire" value={selectedEquipment?.locationLabel ?? selectedUnit.locationLabel} />
            <Fact label="Marca / capacidad" value={`${mainComponent?.brand ?? 'Marca pendiente'} · ${mainComponent?.btu ? `${mainComponent.btu.toLocaleString('en-US')} BTU` : 'BTU pendiente'}`} />
            <Fact label="Técnico que envió" value={selected.updatedByName} />
            <Fact label="Orden" value={selectedOrder?.id ?? selectedVisit?.workOrderId ?? 'Pendiente'} />
            <Fact label="Estado" value={statusLabel(selected.status)} />
          </View>
        </Card>

        {selected.status === 'changes_requested' && selected.resultNotes ? (
          <View style={styles.warningBox}>
            <Text style={styles.warningTitle}>Corrección pendiente</Text>
            <Text style={styles.warningText}>{selected.resultNotes}</Text>
          </View>
        ) : null}

        <Card>
          <SectionTitle title="Secciones del reporte" subtitle="Verifica información, mediciones y fotografías antes de aprobar" />
          <View style={styles.sectionList}>
            {selectedSections.map(({ definition, section }) => (
              <View key={definition.sectionType} style={styles.reviewSection}>
                <View style={styles.reviewSectionHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewSectionTitle}>{definition.title}</Text>
                    <Text style={styles.reviewSectionMeta}>{definition.required ? 'Sección obligatoria' : 'Sección opcional'} · {section?.updatedByName ?? 'Sin edición'}</Text>
                  </View>
                  <Pill label={section?.status === 'completed' ? 'Completada' : section?.status === 'not_applicable' ? 'No aplica' : 'Incompleta'} tone={section?.status === 'completed' ? 'success' : section?.status === 'not_applicable' ? 'neutral' : 'warning'} />
                </View>

                {definition.fields.map((field) => {
                  const value = section?.fields[field.key];
                  const evidence = evidenceFor(value);
                  return (
                    <View key={field.key} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</Text>
                      {field.type === 'photo' ? (
                        evidence
                          ? <EvidencePreview evidence={evidence} />
                          : <Text style={styles.missingValue}>Fotografía no disponible</Text>
                      ) : (
                        <Text style={styles.fieldValue}>{fieldValue(value, field)}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </Card>

        {selected.status === 'ready_for_review' ? (
          <Card>
            <SectionTitle title="Decisión de la oficina" subtitle="Aprueba el reporte o explica claramente qué debe corregir el técnico" />
            <Input
              label="Observación de revisión"
              value={correctionNote}
              onChangeText={setCorrectionNote}
              multiline
              placeholder="Escribe la corrección solicitada o una observación opcional de aprobación."
              editable={!working}
            />
            <View style={styles.actionRow}>
              <Button variant="secondary" label={working ? 'Procesando…' : 'Devolver al técnico'} disabled={working} onPress={() => void returnForCorrection()} />
              <Button variant="success" label={working ? 'Procesando…' : 'Aprobar reporte'} disabled={working} onPress={() => void approveReport()} />
            </View>
          </Card>
        ) : null}

        {selected.status === 'completed' ? (
          <View style={styles.successBox}>
            <Text style={styles.successTitle}>Reporte aprobado</Text>
            <Text style={styles.successText}>{selected.resultNotes ?? 'Este reporte fue aprobado por la oficina.'}</Text>
          </View>
        ) : null}

        <View style={styles.messageBox}>
          <Text style={styles.messageTitle}>Estado</Text>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>OPERACIONES · OFICINA</Text>
          <Text style={styles.title}>Revisión de reportes</Text>
          <Text style={styles.copy}>Reportes técnicos enviados por los equipos de campo.</Text>
        </View>
        <Pill label={`${pendingCount} pendientes`} tone={pendingCount ? 'warning' : 'success'} />
      </View>

      <View style={styles.summaryGrid}>
        <SummaryBox label="Pendientes" value={pendingCount} active={filter === 'pending'} onPress={() => setFilter('pending')} />
        <SummaryBox label="Devueltos" value={correctionsCount} active={filter === 'changes_requested'} onPress={() => setFilter('changes_requested')} />
        <SummaryBox label="Aprobados" value={approvedCount} active={filter === 'approved'} onPress={() => setFilter('approved')} />
      </View>

      <Card>
        <SectionTitle
          title={filter === 'pending' ? 'Pendientes de revisión' : filter === 'changes_requested' ? 'Devueltos para corrección' : 'Reportes aprobados'}
          subtitle="Selecciona un reporte para ver todas sus secciones"
          action={<Button compact variant="ghost" label={loading ? 'Actualizando…' : 'Actualizar'} disabled={loading} onPress={() => void refreshTechnicianPortalData()} />}
        />

        {filtered.length ? filtered.map((intervention) => {
          const visit = workVisits.find((item) => item.id === intervention.visitId);
          const unit = visitUnits.find((item) => item.id === intervention.visitUnitId);
          const equipment = equipmentSystems.find((item) => item.id === intervention.equipmentSystemId || item.id === unit?.equipmentSystemId);
          const client = clients.find((item) => item.id === visit?.clientId);
          const property = properties.find((item) => item.id === visit?.propertyId);
          const sections = workReportSections.filter((item) => item.interventionId === intervention.id);
          const completeSections = sections.filter((item) => item.status === 'completed' || item.status === 'not_applicable').length;
          return (
            <View key={intervention.id} style={styles.reportRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportEyebrow}>{WORK_LABELS[intervention.type].toUpperCase()}</Text>
                <Text style={styles.reportTitle}>{equipment?.locationLabel ?? unit?.locationLabel ?? 'Aire acondicionado'}</Text>
                <Text style={styles.reportMeta}>{client?.name ?? 'Cliente'} · {property?.name ?? property?.address ?? 'Propiedad'}</Text>
                <Text style={styles.reportMeta}>{completeSections}/{sections.length} secciones cerradas · enviado por {intervention.updatedByName}</Text>
                <Text style={styles.reportDate}>{formatDate(intervention.updatedAt)}</Text>
              </View>
              <View style={styles.reportActions}>
                <Pill label={statusLabel(intervention.status)} tone={statusTone(intervention.status)} />
                <Button compact label={intervention.status === 'completed' ? 'Ver reporte' : 'Revisar reporte'} onPress={() => openReport(intervention)} />
              </View>
            </View>
          );
        }) : (
          <EmptyState
            icon="✓"
            title="No hay reportes en esta bandeja"
            message={filter === 'pending' ? 'Los reportes enviados por los técnicos aparecerán aquí.' : 'No hay registros con este estado.'}
          />
        )}
      </Card>

      <View style={styles.messageBox}>
        <Text style={styles.messageTitle}>Estado</Text>
        <Text style={styles.messageText}>{message}</Text>
      </View>
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

function SummaryBox({ label, value, active, onPress }: { label: string; value: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.summaryBox, active && styles.summaryBoxActive]}>
      <Text style={[styles.summaryValue, active && styles.summaryValueActive]}>{value}</Text>
      <Text style={[styles.summaryLabel, active && styles.summaryLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function EvidencePreview({ evidence }: { evidence: WorkOrderEvidence }) {
  return (
    <View style={styles.evidenceBox}>
      <Image source={{ uri: evidence.downloadUrl }} style={styles.evidenceImage} />
      <Text style={styles.evidenceMeta}>{evidence.label} · {evidence.uploadedByName}</Text>
      <Text style={styles.evidenceMeta}>{formatDate(evidence.uploadedAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 100, backgroundColor: '#F7F9FC' },
  hero: { backgroundColor: colors.primary, borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#A9D1FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5 },
  copy: { color: '#D8E9FF', marginTop: 6, lineHeight: 18 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryBox: { flex: 1, minWidth: 150, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14 },
  summaryBoxActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  summaryValue: { color: colors.text, fontSize: 24, fontWeight: '900' },
  summaryValueActive: { color: colors.primaryDark },
  summaryLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', marginTop: 3 },
  summaryLabelActive: { color: colors.primaryDark },
  reportRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14, marginBottom: 9, backgroundColor: '#FFFFFF' },
  reportEyebrow: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  reportTitle: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  reportMeta: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  reportDate: { color: colors.text, fontSize: 9, fontWeight: '800', marginTop: 6 },
  reportActions: { alignItems: 'flex-end', gap: 8 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  fact: { flex: 1, minWidth: 180, backgroundColor: '#F7F9FC', borderRadius: 11, padding: 11 },
  factLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  factValue: { color: colors.text, fontWeight: '900', marginTop: 4 },
  sectionList: { gap: 12 },
  reviewSection: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 13, backgroundColor: '#FFFFFF' },
  reviewSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  reviewSectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  reviewSectionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  fieldRow: { borderTopWidth: 1, borderTopColor: '#EEF1F4', paddingVertical: 10 },
  fieldLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', marginBottom: 5 },
  fieldValue: { color: colors.text, lineHeight: 18 },
  missingValue: { color: '#9A5A00', fontSize: 10, fontWeight: '800' },
  evidenceBox: { gap: 5 },
  evidenceImage: { width: '100%', maxWidth: 520, height: 260, borderRadius: 12, backgroundColor: '#EEF1F5' },
  evidenceMeta: { color: colors.muted, fontSize: 9 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  warningBox: { backgroundColor: '#FFF8EC', borderRadius: 13, padding: 14 },
  warningTitle: { color: '#8A5200', fontWeight: '900' },
  warningText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },
  successBox: { backgroundColor: '#F0F8F1', borderRadius: 13, padding: 14 },
  successTitle: { color: '#2F6A3B', fontWeight: '900' },
  successText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 13, padding: 13 },
  messageTitle: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  messageText: { color: colors.text, marginTop: 5, lineHeight: 18 },
});
