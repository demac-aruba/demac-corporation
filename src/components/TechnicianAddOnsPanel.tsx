import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  WORK_VISIT_ADD_ON_DEFINITIONS,
  WorkVisitAddOn,
  WorkVisitAddOnDefinition,
  workVisitAddOnLabel,
} from '../features/technicianPortal/addOns';
import { WorkIntervention, WorkVisit, VisitUnit } from '../features/technicianPortal/contracts';
import { uploadWorkOrderEvidenceImage } from '../services/firebaseStorage';
import { useAppState } from '../state/AppState';
import { useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';
import { WorkOrderEvidence } from '../types';
import { Button, Card, Input, Pill, SectionTitle } from './UI';

type Props = {
  visit: WorkVisit;
  unit: VisitUnit;
  interventions: WorkIntervention[];
  disabled?: boolean;
};

function addOnStatusLabel(status: WorkVisitAddOn['status']) {
  if (status === 'installed') return 'Instalado';
  if (status === 'cancelled') return 'Cancelado';
  return 'Seleccionado';
}

function idPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
}

export function TechnicianAddOnsPanel({ visit, unit, interventions, disabled = false }: Props) {
  const { currentUser, workOrders, workOrderEvidence, addWorkOrderEvidence } = useAppState();
  const { workVisitAddOns, saveWorkVisitAddOn } = useTechnicianPortalState();
  const activeInterventions = useMemo(
    () => interventions.filter((item) => item.status !== 'cancelled'),
    [interventions],
  );
  const [selectedInterventionId, setSelectedInterventionId] = useState(activeInterventions[0]?.id ?? '');
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState('');
  const [message, setMessage] = useState('Los add-ons son opcionales y pueden combinarse dentro de la misma visita.');

  useEffect(() => {
    if (!activeInterventions.some((item) => item.id === selectedInterventionId)) {
      setSelectedInterventionId(activeInterventions[0]?.id ?? '');
    }
  }, [activeInterventions.map((item) => item.id).join('|'), selectedInterventionId]);

  const selectedIntervention = activeInterventions.find((item) => item.id === selectedInterventionId);
  const selectedAddOns = workVisitAddOns
    .filter((item) => item.interventionId === selectedInterventionId && item.status !== 'cancelled')
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  const workOrder = workOrders.find((item) => item.id === visit.workOrderId);

  function evidenceFor(id?: string) {
    return id ? workOrderEvidence.find((item) => item.id === id) : undefined;
  }

  async function selectAddOn(definition: WorkVisitAddOnDefinition) {
    if (disabled || !selectedIntervention || !currentUser) return;
    const existing = selectedAddOns.find((item) => item.type === definition.type);
    if (existing) {
      setMessage(`${definition.label} ya está seleccionado para este trabajo.`);
      return;
    }

    const now = new Date().toISOString();
    const staffId = (currentUser as { staffId?: string }).staffId;
    const addOn: WorkVisitAddOn = {
      id: `visit-addon-${idPart(selectedIntervention.id)}-${definition.type}-${Date.now().toString(36)}`,
      workOrderId: visit.workOrderId,
      visitId: visit.id,
      visitUnitId: unit.id,
      interventionId: selectedIntervention.id,
      equipmentSystemId: selectedIntervention.equipmentSystemId ?? unit.equipmentSystemId,
      type: definition.type,
      status: 'selected',
      createdAt: now,
      createdByUserId: currentUser.id,
      createdByStaffId: staffId,
      createdByName: currentUser.name,
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: staffId,
      updatedByName: currentUser.name,
      version: 1,
    };
    setWorkingId(definition.type);
    const result = await saveWorkVisitAddOn(addOn);
    setWorkingId('');
    setMessage(result.ok
      ? `${definition.label} agregado. Toma la foto anterior y la foto del producto nuevo instalado.`
      : result.message ?? 'No se pudo registrar el add-on.');
  }

  async function updateAddOn(addOn: WorkVisitAddOn, changes: Partial<WorkVisitAddOn>) {
    if (!currentUser) return { ok: false, message: 'No se encontró el usuario activo.' };
    const now = new Date().toISOString();
    const staffId = (currentUser as { staffId?: string }).staffId;
    return saveWorkVisitAddOn({
      ...addOn,
      ...changes,
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: staffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(addOn.version ?? 1)) + 1,
    });
  }

  async function capturePhoto(addOn: WorkVisitAddOn, definition: WorkVisitAddOnDefinition, moment: 'before' | 'after') {
    if (disabled || !currentUser || !workOrder) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('Debes autorizar la cámara para documentar el add-on.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    setWorkingId(addOn.id);
    try {
      const asset = result.assets[0];
      const evidenceId = `addon-${addOn.id}-${moment}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const stored = await uploadWorkOrderEvidenceImage({
        uri: asset.uri,
        workOrderId: workOrder.id,
        unitId: unit.id,
        evidenceId,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
      const now = new Date().toISOString();
      const label = moment === 'before' ? definition.beforeLabel : definition.afterLabel;
      const evidence: WorkOrderEvidence = {
        id: evidenceId,
        workOrderId: workOrder.id,
        equipmentId: addOn.equipmentSystemId,
        unitId: unit.id,
        section: 'during_service',
        itemKey: `${addOn.id}-${moment}`,
        label,
        moment,
        ...stored,
        capturedAt: now,
        uploadedAt: now,
        uploadedByUserId: currentUser.id,
        uploadedByStaffId: (currentUser as { staffId?: string }).staffId,
        uploadedByName: currentUser.name,
      };
      const evidenceResult = await addWorkOrderEvidence(evidence);
      if (!evidenceResult.ok) throw new Error(evidenceResult.message ?? 'No se pudo guardar la evidencia del add-on.');

      const beforeEvidenceId = moment === 'before' ? evidence.id : addOn.beforeEvidenceId;
      const afterEvidenceId = moment === 'after' ? evidence.id : addOn.afterEvidenceId;
      const saved = await updateAddOn(addOn, {
        beforeEvidenceId,
        afterEvidenceId,
        status: beforeEvidenceId && afterEvidenceId ? 'installed' : 'selected',
      });
      setMessage(saved.ok ? `${label} guardada.` : saved.message ?? 'La fotografía subió, pero no pudo vincularse al add-on.');
    } catch (error) {
      setMessage(`No se pudo guardar la fotografía: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWorkingId('');
    }
  }

  async function saveNotes(addOn: WorkVisitAddOn) {
    if (disabled) return;
    setWorkingId(addOn.id);
    const result = await updateAddOn(addOn, { notes: (notesDrafts[addOn.id] ?? addOn.notes ?? '').trim() || undefined });
    setWorkingId('');
    setMessage(result.ok ? `Observación de ${workVisitAddOnLabel(addOn.type)} guardada.` : result.message ?? 'No se pudo guardar la observación.');
  }

  async function cancelAddOn(addOn: WorkVisitAddOn) {
    if (disabled) return;
    setWorkingId(addOn.id);
    const result = await updateAddOn(addOn, { status: 'cancelled' });
    setWorkingId('');
    setMessage(result.ok ? `${workVisitAddOnLabel(addOn.type)} fue quitado de esta visita.` : result.message ?? 'No se pudo quitar el add-on.');
  }

  return (
    <Card>
      <SectionTitle
        title="Add-ons en esta visita"
        subtitle="Registra switch, bracket, Armaflex o refrigerante vendidos e instalados durante el trabajo. Precios, inventario y comisiones se conectarán después."
      />

      {!activeInterventions.length ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Primero selecciona el trabajo</Text>
          <Text style={styles.infoText}>Los add-ons se vinculan al trabajo real y al aire acondicionado atendido.</Text>
        </View>
      ) : (
        <>
          {activeInterventions.length > 1 ? (
            <View style={styles.interventionSelector}>
              <Text style={styles.fieldLabel}>VINCULAR ADD-ONS AL TRABAJO</Text>
              <View style={styles.interventionOptions}>
                {activeInterventions.map((intervention) => {
                  const selected = intervention.id === selectedInterventionId;
                  return (
                    <Pressable
                      key={intervention.id}
                      disabled={disabled}
                      onPress={() => setSelectedInterventionId(intervention.id)}
                      style={[styles.interventionOption, selected && styles.interventionOptionSelected]}
                    >
                      <Text style={[styles.interventionOptionText, selected && styles.interventionOptionTextSelected]}>{intervention.templateId.replace(/_/g, ' ')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.addOnGrid}>
            {WORK_VISIT_ADD_ON_DEFINITIONS.map((definition) => {
              const selected = selectedAddOns.some((item) => item.type === definition.type);
              return (
                <Pressable
                  key={definition.type}
                  disabled={disabled || Boolean(workingId)}
                  onPress={() => void selectAddOn(definition)}
                  style={[styles.addOnChoice, selected && styles.addOnChoiceSelected]}
                >
                  <Text style={styles.addOnIcon}>{selected ? '✓' : definition.icon}</Text>
                  <Text style={[styles.addOnChoiceTitle, selected && styles.addOnChoiceTitleSelected]}>{definition.label}</Text>
                  <Text style={styles.addOnChoiceAction}>{selected ? 'Seleccionado' : workingId === definition.type ? 'Guardando…' : 'Agregar'}</Text>
                </Pressable>
              );
            })}
          </View>

          {selectedAddOns.map((addOn) => {
            const definition = WORK_VISIT_ADD_ON_DEFINITIONS.find((item) => item.type === addOn.type);
            if (!definition) return null;
            const beforeEvidence = evidenceFor(addOn.beforeEvidenceId);
            const afterEvidence = evidenceFor(addOn.afterEvidenceId);
            const busy = workingId === addOn.id;
            return (
              <View key={addOn.id} style={styles.detailCard}>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{definition.icon} {definition.label}</Text>
                    <Text style={styles.detailDescription}>{definition.description}</Text>
                  </View>
                  <Pill label={addOnStatusLabel(addOn.status)} tone={addOn.status === 'installed' ? 'success' : 'info'} />
                </View>

                <View style={styles.photoGrid}>
                  <AddOnPhoto
                    label={definition.beforeLabel}
                    evidence={beforeEvidence}
                    disabled={disabled || busy}
                    onPress={() => void capturePhoto(addOn, definition, 'before')}
                  />
                  <AddOnPhoto
                    label={definition.afterLabel}
                    evidence={afterEvidence}
                    disabled={disabled || busy}
                    onPress={() => void capturePhoto(addOn, definition, 'after')}
                  />
                </View>

                <Input
                  label="Observación opcional"
                  value={notesDrafts[addOn.id] ?? addOn.notes ?? ''}
                  onChangeText={(value) => setNotesDrafts((previous) => ({ ...previous, [addOn.id]: value }))}
                  multiline
                  placeholder="Detalle de la instalación o condición encontrada."
                  editable={!disabled && !busy}
                />
                <View style={styles.detailActions}>
                  <Button compact variant="ghost" label="Quitar add-on" disabled={disabled || busy} onPress={() => void cancelAddOn(addOn)} />
                  <Button compact variant="secondary" label={busy ? 'Guardando…' : 'Guardar observación'} disabled={disabled || busy} onPress={() => void saveNotes(addOn)} />
                </View>
              </View>
            );
          })}
        </>
      )}

      <View style={styles.messageBox}><Text style={styles.messageText}>{message}</Text></View>
    </Card>
  );
}

function AddOnPhoto({ label, evidence, disabled, onPress }: { label: string; evidence?: WorkOrderEvidence; disabled: boolean; onPress: () => void }) {
  return (
    <View style={styles.photoCard}>
      <Text style={styles.photoLabel}>{label}</Text>
      {evidence ? <Image source={{ uri: evidence.thumbnailUrl ?? evidence.downloadUrl }} style={styles.photoPreview} /> : <View style={styles.photoPlaceholder}><Text style={styles.photoPlaceholderText}>Sin foto</Text></View>}
      <Button compact variant={evidence ? 'secondary' : 'primary'} label={evidence ? 'Repetir foto' : 'Tomar foto'} disabled={disabled} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  infoBox: { backgroundColor: colors.infoLight, borderRadius: 11, padding: 12 },
  infoTitle: { color: colors.info, fontWeight: '900', fontSize: 11 },
  infoText: { color: colors.text, fontSize: 9, lineHeight: 15, marginTop: 4 },
  interventionSelector: { gap: 7, marginBottom: 12 },
  fieldLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  interventionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  interventionOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  interventionOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  interventionOptionText: { color: colors.text, fontSize: 9, fontWeight: '800', textTransform: 'capitalize' },
  interventionOptionTextSelected: { color: '#FFFFFF' },
  addOnGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  addOnChoice: { width: '31%', minWidth: 105, flexGrow: 1, minHeight: 112, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  addOnChoiceSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  addOnIcon: { fontSize: 21, marginBottom: 7 },
  addOnChoiceTitle: { color: colors.text, fontSize: 10, fontWeight: '900', textAlign: 'center' },
  addOnChoiceTitleSelected: { color: colors.primaryDark },
  addOnChoiceAction: { color: colors.muted, fontSize: 8, fontWeight: '800', marginTop: 5 },
  detailCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, marginTop: 11, backgroundColor: '#FFFFFF' },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  detailTitle: { color: colors.text, fontSize: 13, fontWeight: '900' },
  detailDescription: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 11, marginBottom: 10 },
  photoCard: { flex: 1, minWidth: 135, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 9, gap: 8 },
  photoLabel: { color: colors.text, fontSize: 9, fontWeight: '900' },
  photoPreview: { width: '100%', height: 110, borderRadius: 8, backgroundColor: '#EEF1F5' },
  photoPlaceholder: { height: 70, borderRadius: 8, backgroundColor: '#F1F3F5', alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  messageBox: { backgroundColor: '#F3F7F3', borderRadius: 11, padding: 10, marginTop: 12 },
  messageText: { color: colors.text, fontSize: 9, lineHeight: 15 },
});
