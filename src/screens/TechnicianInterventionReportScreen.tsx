import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';
import { ReportSection } from '../features/technicianPortal/contracts';
import { getTechnicianReportTemplate, TemplateFieldDefinition, TemplateSectionDefinition } from '../features/technicianPortal/templates';
import { uploadWorkOrderEvidenceImage } from '../services/firebaseStorage';
import { useAppState } from '../state/AppState';
import { useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';
import { EvidenceSection, WorkOrderEvidence } from '../types';

type DraftValue = string | number | boolean | null | string[];
type DraftFields = Record<string, DraftValue>;

function queryValue(name: string) {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    not_started: 'No iniciado',
    in_progress: 'En proceso',
    completed: 'Completado',
    blocked: 'Bloqueado',
    not_applicable: 'No aplica',
    draft: 'Por iniciar',
    ready_for_review: 'Listo para revisión',
  };
  return labels[status] ?? status.replace(/_/g, ' ');
}

function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'completed' || status === 'ready_for_review') return 'success';
  if (status === 'in_progress') return 'info';
  if (status === 'blocked') return 'warning';
  return 'neutral';
}

function sectionOwnerLabel(owner: TemplateSectionDefinition['ownerSuggestion']) {
  const labels = {
    indoor: 'Sugerido: técnico indoor',
    outdoor: 'Sugerido: técnico outdoor',
    lead: 'Sugerido: técnico responsable',
    any: 'Puede completarlo cualquier miembro del equipo',
  };
  return labels[owner];
}

function fieldHasValue(value: DraftValue | undefined) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function sectionEvidenceType(section: ReportSection['sectionType']): EvidenceSection {
  if (section === 'identification') return 'identification';
  if (section === 'initial_measurements') return 'initial_pressures';
  if (section === 'final_measurements') return 'final_pressures';
  if (section === 'electrical') return 'electrical_disconnect';
  if (section === 'findings') return 'finding';
  if (section === 'completion') return 'after_service';
  if (section === 'indoor' || section === 'outdoor' || section === 'work_process') return 'during_service';
  return 'general';
}

function evidenceMoment(section: ReportSection['sectionType']) {
  if (section === 'identification' || section === 'initial_measurements') return 'before' as const;
  if (section === 'completion' || section === 'final_measurements') return 'after' as const;
  return 'during' as const;
}

function workLabel(templateName?: string) {
  return templateName ?? 'Reporte técnico';
}

export function TechnicianInterventionReportScreen() {
  const {
    currentUser,
    clients,
    properties,
    workOrders,
    workOrderEvidence,
    addWorkOrderEvidence,
  } = useAppState();
  const {
    workVisits,
    visitUnits,
    workInterventions,
    workReportSections,
    equipmentSystems,
    initializeReportSections,
    updateReportSection,
    saveWorkIntervention,
  } = useTechnicianPortalState();

  const visitId = useMemo(() => queryValue('visitId'), []);
  const unitId = useMemo(() => queryValue('unitId'), []);
  const interventionId = useMemo(() => queryValue('interventionId'), []);
  const returnToTechnician = useMemo(() => queryValue('returnTo') === 'technician', []);

  const visit = workVisits.find((item) => item.id === visitId);
  const unit = visitUnits.find((item) => item.id === unitId && item.visitId === visitId);
  const intervention = workInterventions.find((item) => item.id === interventionId && item.visitUnitId === unitId);
  const equipment = equipmentSystems.find((item) => item.id === unit?.equipmentSystemId);
  const template = intervention ? getTechnicianReportTemplate(intervention.templateId, intervention.templateVersion) : undefined;
  const client = clients.find((item) => item.id === visit?.clientId);
  const property = properties.find((item) => item.id === visit?.propertyId);
  const workOrder = workOrders.find((item) => item.id === visit?.workOrderId);

  const reportSections = useMemo(() => {
    if (!template) return [];
    const existing = workReportSections.filter((section) => section.interventionId === interventionId);
    return template.sections
      .map((definition) => ({ definition, section: existing.find((item) => item.sectionType === definition.sectionType) }))
      .filter((item): item is { definition: TemplateSectionDefinition; section: ReportSection } => Boolean(item.section));
  }, [template, workReportSections, interventionId]);

  const [activeSectionId, setActiveSectionId] = useState('');
  const [draft, setDraft] = useState<DraftFields>({});
  const [initializing, setInitializing] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Preparando la plantilla técnica del trabajo seleccionado.');

  const activeItem = reportSections.find((item) => item.section.id === activeSectionId) ?? reportSections[0];
  const requiredSections = reportSections.filter((item) => item.definition.required);
  const completedRequiredSections = requiredSections.filter((item) => item.section.status === 'completed');
  const reportReady = requiredSections.length > 0 && completedRequiredSections.length === requiredSections.length;

  useEffect(() => {
    if (!intervention || !template || !equipment || initializing) return;
    const existing = workReportSections.some((section) => section.interventionId === intervention.id);
    if (existing) return;
    setInitializing(true);
    void initializeReportSections(intervention, equipment)
      .then((result) => setMessage(result.ok ? 'Plantilla preparada. Abre una sección para comenzar.' : result.message ?? 'No se pudo preparar la plantilla.'))
      .finally(() => setInitializing(false));
  }, [intervention?.id, template?.id, equipment?.id, workReportSections.length, initializing]);

  useEffect(() => {
    if (!activeItem) return;
    if (!activeSectionId) setActiveSectionId(activeItem.section.id);
    setDraft({ ...activeItem.section.fields });
  }, [activeItem?.section.id, activeItem?.section.updatedAt]);

  function goBack() {
    if (typeof window === 'undefined') return;
    const returnParameter = returnToTechnician ? '&returnTo=technician' : '';
    window.location.assign(`${window.location.pathname}?technicianPortalIntervention=1&visitId=${encodeURIComponent(visitId)}&unitId=${encodeURIComponent(unitId)}${returnParameter}`);
  }

  function selectSection(section: ReportSection) {
    setActiveSectionId(section.id);
    setDraft({ ...section.fields });
    setMessage(`${statusLabel(section.status)} · ${section.updatedByName ?? 'Sin edición reciente'}`);
  }

  function setDraftValue(key: string, value: DraftValue) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function saveSection(status?: ReportSection['status']) {
    if (!activeItem) return;
    setWorking(true);
    const result = await updateReportSection(activeItem.section, { fields: draft, status });
    setWorking(false);
    setMessage(result.ok
      ? status === 'completed' ? `${activeItem.definition.title} completada.` : `${activeItem.definition.title} guardada.`
      : result.message ?? 'No se pudo guardar la sección.');
  }

  async function capturePhoto(field: TemplateFieldDefinition) {
    if (!activeItem || !visit || !unit || !intervention || !equipment || !workOrder || !currentUser) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('Debes autorizar la cámara para tomar fotografías del reporte.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.78 });
    if (result.canceled || !result.assets[0]) return;

    setWorking(true);
    try {
      const asset = result.assets[0];
      const evidenceId = `report-${intervention.id}-${activeItem.section.sectionType}-${field.key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const stored = await uploadWorkOrderEvidenceImage({
        uri: asset.uri,
        workOrderId: workOrder.id,
        unitId: unit.id,
        evidenceId,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
      const now = new Date().toISOString();
      const evidence: WorkOrderEvidence = {
        id: evidenceId,
        workOrderId: workOrder.id,
        equipmentId: equipment.id,
        unitId: unit.id,
        section: sectionEvidenceType(activeItem.section.sectionType),
        itemKey: `${intervention.id}-${activeItem.section.sectionType}-${field.key}`,
        label: field.label,
        moment: evidenceMoment(activeItem.section.sectionType),
        ...stored,
        capturedAt: now,
        uploadedAt: now,
        uploadedByUserId: currentUser.id,
        uploadedByName: currentUser.name,
      };
      const savedEvidence = await addWorkOrderEvidence(evidence);
      if (!savedEvidence.ok) throw new Error(savedEvidence.message ?? 'No se pudo guardar la evidencia fotográfica.');

      const nextDraft = { ...draft, [field.key]: evidence.id };
      setDraft(nextDraft);
      const savedSection = await updateReportSection(activeItem.section, {
        fields: nextDraft,
        evidenceIds: [evidence.id],
      });
      setMessage(savedSection.ok ? `${field.label} guardada.` : savedSection.message ?? 'La foto subió, pero no se pudo vincular a la sección.');
    } catch (error) {
      setMessage(`No se pudo guardar la fotografía: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWorking(false);
    }
  }

  async function submitForReview() {
    if (!intervention || !reportReady || !currentUser) return;
    setWorking(true);
    const now = new Date().toISOString();
    const result = await saveWorkIntervention({
      ...intervention,
      status: 'ready_for_review',
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(intervention.version ?? 1)) + 1,
    });
    setWorking(false);
    setMessage(result.ok ? 'Reporte enviado para revisión de la oficina.' : result.message ?? 'No se pudo enviar el reporte.');
  }

  if (!visit || !unit || !intervention || !equipment || !template) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card>
          <EmptyState icon="🧾" title="No se encontró el reporte" message="Regresa al perfil del aire y abre nuevamente el trabajo registrado." />
          <Button variant="secondary" label="Volver al perfil del aire" onPress={goBack} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>REPORTE TÉCNICO · {equipment.locationLabel.toUpperCase()}</Text>
          <Text style={styles.title}>{workLabel(template.name)}</Text>
          <Text style={styles.copy}>{client?.name ?? 'Cliente'} · {property?.name ?? property?.address ?? workOrder?.address ?? 'Propiedad'}</Text>
        </View>
        <Pill label={statusLabel(intervention.status)} tone={statusTone(intervention.status)} />
      </View>

      <Card>
        <SectionTitle
          title="Progreso del reporte"
          subtitle={`${completedRequiredSections.length} de ${requiredSections.length} secciones obligatorias completadas`}
          action={<Button compact label="Volver" variant="ghost" onPress={goBack} />}
        />
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${requiredSections.length ? Math.round((completedRequiredSections.length / requiredSections.length) * 100) : 0}%` }]} />
        </View>
        <Text style={styles.templateDescription}>{template.description}</Text>
      </Card>

      <Card>
        <SectionTitle title="Secciones del reporte" subtitle="Indoor y Outdoor se guardan por separado para permitir trabajo simultáneo" />
        {initializing && !reportSections.length ? <Text style={styles.loadingText}>Preparando secciones…</Text> : null}
        <View style={styles.sectionList}>
          {reportSections.map(({ definition, section }) => {
            const requiredCount = definition.fields.filter((field) => field.required).length;
            const completedCount = definition.fields.filter((field) => field.required && fieldHasValue(section.fields[field.key])).length;
            const active = activeItem?.section.id === section.id;
            return (
              <Pressable key={section.id} onPress={() => selectSection(section)} style={[styles.sectionRow, active && styles.sectionRowActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionName}>{definition.title}</Text>
                  <Text style={styles.sectionMeta}>{sectionOwnerLabel(definition.ownerSuggestion)}</Text>
                  <Text style={styles.sectionMeta}>{section.assignedToName ? `Editando / asignado: ${section.assignedToName}` : 'Aún sin asignar'} · {completedCount}/{requiredCount} obligatorios</Text>
                </View>
                <Pill label={statusLabel(section.status)} tone={statusTone(section.status)} />
              </Pressable>
            );
          })}
        </View>
      </Card>

      {activeItem ? (
        <Card>
          <SectionTitle
            title={activeItem.definition.title}
            subtitle={`${sectionOwnerLabel(activeItem.definition.ownerSuggestion)} · Última edición: ${activeItem.section.updatedByName ?? 'Sin editar'}`}
          />

          <View style={styles.fieldList}>
            {activeItem.definition.fields.map((field) => (
              <FieldEditor
                key={field.key}
                field={field}
                value={draft[field.key]}
                evidence={typeof draft[field.key] === 'string' ? workOrderEvidence.find((item) => item.id === draft[field.key]) : undefined}
                disabled={working}
                onChange={(value) => setDraftValue(field.key, value)}
                onPhoto={() => void capturePhoto(field)}
              />
            ))}
          </View>

          <View style={styles.sectionActions}>
            <Button variant="secondary" label={working ? 'Guardando…' : 'Guardar sección'} disabled={working} onPress={() => void saveSection()} />
            <Button variant="success" label="Completar sección" disabled={working} onPress={() => void saveSection('completed')} />
            {!activeItem.definition.required ? (
              <Button variant="ghost" label="Marcar No aplica" disabled={working} onPress={() => void saveSection('not_applicable')} />
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Reglas de finalización" />
        {template.completionRules.map((rule) => <Text key={rule} style={styles.ruleText}>• {rule}</Text>)}
        <Button
          variant="success"
          label={intervention.status === 'ready_for_review' ? 'Enviado para revisión' : 'Enviar reporte a revisión'}
          disabled={working || !reportReady || intervention.status === 'ready_for_review'}
          onPress={() => void submitForReview()}
        />
        {!reportReady ? <Text style={styles.helpText}>Completa todas las secciones obligatorias para enviar el reporte.</Text> : null}
      </Card>

      <View style={styles.messageBox}>
        <Text style={styles.messageTitle}>Estado</Text>
        <Text style={styles.messageText}>{message}</Text>
      </View>
    </ScrollView>
  );
}

function FieldEditor({
  field,
  value,
  evidence,
  disabled,
  onChange,
  onPhoto,
}: {
  field: TemplateFieldDefinition;
  value: DraftValue | undefined;
  evidence?: WorkOrderEvidence;
  disabled: boolean;
  onChange: (value: DraftValue) => void;
  onPhoto: () => void;
}) {
  const label = `${field.label}${field.required ? ' *' : ''}${field.unit ? ` (${field.unit})` : ''}`;

  if (field.type === 'select') {
    return (
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.choiceRow}>
          {(field.options ?? []).map((option) => {
            const selected = value === option;
            return (
              <Pressable key={option} disabled={disabled} onPress={() => onChange(option)} style={[styles.choice, selected && styles.choiceSelected]}>
                <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (field.type === 'boolean') {
    return (
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.choiceRow}>
          <Pressable disabled={disabled} onPress={() => onChange(true)} style={[styles.choice, value === true && styles.choiceSelected]}>
            <Text style={[styles.choiceText, value === true && styles.choiceTextSelected]}>Sí</Text>
          </Pressable>
          <Pressable disabled={disabled} onPress={() => onChange(false)} style={[styles.choice, value === false && styles.choiceSelected]}>
            <Text style={[styles.choiceText, value === false && styles.choiceTextSelected]}>No</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (field.type === 'photo') {
    return (
      <View style={styles.photoBlock}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.photoHelp}>{evidence ? `Guardada por ${evidence.uploadedByName}` : field.helperText ?? 'Toma la fotografía requerida para esta sección.'}</Text>
          {evidence ? <Image source={{ uri: evidence.downloadUrl }} style={styles.photoPreview} /> : null}
        </View>
        <Button compact label={evidence ? 'Repetir foto' : 'Tomar foto'} variant={evidence ? 'secondary' : 'primary'} disabled={disabled} onPress={onPhoto} />
      </View>
    );
  }

  return (
    <Input
      label={label}
      value={value === null || value === undefined ? '' : String(value)}
      onChangeText={(text) => onChange(text)}
      multiline={field.type === 'textarea'}
      keyboardType={field.type === 'number' || field.type === 'measurement' ? 'decimal-pad' : 'default'}
      placeholder={field.helperText}
      editable={!disabled}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 100, backgroundColor: '#F7F9FC' },
  hero: { backgroundColor: colors.primary, borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#A9D1FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5 },
  copy: { color: '#D8E9FF', marginTop: 6, lineHeight: 18 },
  progressTrack: { height: 9, borderRadius: 5, backgroundColor: '#E4E9EF', overflow: 'hidden' },
  progressFill: { height: 9, backgroundColor: colors.primary, borderRadius: 5 },
  templateDescription: { color: colors.muted, marginTop: 10, lineHeight: 18 },
  loadingText: { color: colors.muted, textAlign: 'center', paddingVertical: 18 },
  sectionList: { gap: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, backgroundColor: '#FFFFFF' },
  sectionRowActive: { borderColor: colors.primary, backgroundColor: '#F7FAFF' },
  sectionName: { color: colors.text, fontSize: 14, fontWeight: '900' },
  sectionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  fieldList: { gap: 12 },
  fieldBlock: { gap: 7 },
  fieldLabel: { color: colors.text, fontSize: 10, fontWeight: '900' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#FFFFFF' },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  choiceTextSelected: { color: '#FFFFFF' },
  photoBlock: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 },
  photoHelp: { color: colors.muted, fontSize: 9, marginTop: 4, lineHeight: 14 },
  photoPreview: { width: 150, height: 110, borderRadius: 10, marginTop: 9, backgroundColor: '#EEF1F5' },
  sectionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 14 },
  ruleText: { color: colors.text, lineHeight: 19, marginBottom: 5 },
  helpText: { color: colors.muted, fontSize: 9, marginTop: 8, textAlign: 'center' },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14 },
  messageTitle: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  messageText: { color: colors.text, marginTop: 5, lineHeight: 18 },
});
