import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { deleteWorkOrderEvidenceImage, uploadWorkOrderEvidenceImage } from '../services/firebaseStorage';
import { useAppState } from '../state/TeamState';
import { colors } from '../theme';
import {
  EvidenceMoment,
  EvidenceSection,
  StaffProfile,
  UnitFinding,
  UnitMeasurements,
  WorkOrder,
  WorkOrderEvidence,
  WorkOrderUnit,
} from '../types';
import { Button, Card, Input, Pill, SectionTitle } from './UI';

type EvidenceItem = {
  key: string;
  label: string;
  help?: string;
  moment: EvidenceMoment;
  requiresSafeIsolation?: boolean;
};

type ReportSection = {
  key: EvidenceSection;
  title: string;
  subtitle: string;
  icon: string;
  items: EvidenceItem[];
};

const sections: ReportSection[] = [
  {
    key: 'identification',
    title: 'Identificación del equipo',
    subtitle: 'Ubicación, vistas generales y placas de información.',
    icon: '🏷️',
    items: [
      { key: 'indoor-wide', label: 'Indoor a distancia', help: 'Debe mostrar dónde está instalada la unidad.', moment: 'before' },
      { key: 'indoor-front', label: 'Indoor frontal', moment: 'before' },
      { key: 'indoor-nameplate', label: 'Placa de información del indoor', help: 'Modelo, serial, BTU, voltaje y refrigerante legibles.', moment: 'before' },
      { key: 'outdoor-wide', label: 'Outdoor a distancia', help: 'Debe mostrar ubicación, ventilación y acceso.', moment: 'before' },
      { key: 'outdoor-front', label: 'Outdoor frontal', moment: 'before' },
      { key: 'outdoor-nameplate', label: 'Placa del outdoor', help: 'Puede marcarse No aplica cuando está borrada o ilegible.', moment: 'before' },
    ],
  },
  {
    key: 'before_service',
    title: 'Estado actual / Antes del servicio',
    subtitle: 'Condición inicial del indoor, outdoor y componentes visibles.',
    icon: '📷',
    items: [
      { key: 'indoor-condition-before', label: 'Condición general del indoor', moment: 'before' },
      { key: 'filters-before', label: 'Filtros antes del servicio', moment: 'before' },
      { key: 'indoor-coil-before', label: 'Coil indoor antes del servicio', moment: 'before' },
      { key: 'drain-pan-before', label: 'Bandeja y drenaje antes del servicio', moment: 'before' },
      { key: 'outdoor-condition-before', label: 'Condición general del outdoor', moment: 'before' },
      { key: 'outdoor-coil-before', label: 'Coil outdoor antes del servicio', moment: 'before' },
      { key: 'bracket-before', label: 'Bracket / soporte del outdoor', moment: 'before' },
      { key: 'existing-damage-before', label: 'Daños existentes antes de comenzar', moment: 'before' },
    ],
  },
  {
    key: 'initial_pressures',
    title: 'Presiones iniciales',
    subtitle: 'Foto del manómetro y mediciones antes del trabajo.',
    icon: '🧭',
    items: [
      { key: 'initial-gauge', label: 'Manómetro conectado antes del servicio', moment: 'before' },
    ],
  },
  {
    key: 'electrical_disconnect',
    title: 'Switch eléctrico / Disconnect',
    subtitle: 'Gabinete, tapa, interior, terminales, cables y conduit.',
    icon: '⚡',
    items: [
      { key: 'disconnect-location', label: 'Switch a distancia y ubicación', moment: 'before' },
      { key: 'disconnect-closed', label: 'Tapa cerrada y gabinete exterior', moment: 'before' },
      { key: 'disconnect-open', label: 'Switch sin la tapa', moment: 'before', requiresSafeIsolation: true },
      { key: 'disconnect-wiring', label: 'Cableado y terminales internos', moment: 'before', requiresSafeIsolation: true },
      { key: 'disconnect-conduit', label: 'Conduit y entrada de cables', moment: 'before' },
    ],
  },
  {
    key: 'during_service',
    title: 'Durante el servicio',
    subtitle: 'Desarme, limpieza, drenaje, reparación o tratamiento.',
    icon: '🛠️',
    items: [
      { key: 'unit-disassembled', label: 'Unidad desarmada', moment: 'during' },
      { key: 'cleaning-process', label: 'Proceso de limpieza', moment: 'during' },
      { key: 'drain-test', label: 'Prueba o limpieza de drenaje', moment: 'during' },
      { key: 'repair-process', label: 'Pieza, reparación o tratamiento realizado', moment: 'during' },
    ],
  },
  {
    key: 'final_pressures',
    title: 'Presiones finales',
    subtitle: 'Foto del manómetro y mediciones después del trabajo.',
    icon: '📈',
    items: [
      { key: 'final-gauge', label: 'Manómetro conectado después del servicio', moment: 'after' },
    ],
  },
  {
    key: 'after_service',
    title: 'Estado final / Después del servicio',
    subtitle: 'Resultado final y área de trabajo terminada.',
    icon: '✅',
    items: [
      { key: 'indoor-wide-after', label: 'Indoor terminado a distancia', moment: 'after' },
      { key: 'indoor-front-after', label: 'Indoor frontal terminado', moment: 'after' },
      { key: 'filters-after', label: 'Filtros limpios', moment: 'after' },
      { key: 'indoor-coil-after', label: 'Coil indoor limpio', moment: 'after' },
      { key: 'outdoor-after', label: 'Outdoor terminado', moment: 'after' },
      { key: 'outdoor-coil-after', label: 'Coil outdoor limpio', moment: 'after' },
      { key: 'work-area-after', label: 'Área de trabajo limpia', moment: 'after' },
    ],
  },
  {
    key: 'finding',
    title: 'Hallazgos y daños',
    subtitle: 'Corrosión, tapa partida, cable quemado, fuga, instalación deficiente u otro hallazgo.',
    icon: '⚠️',
    items: [],
  },
];

const emptyMeasurements: UnitMeasurements = {
  lowPressure: '',
  highPressure: '',
  returnTemp: '',
  supplyTemp: '',
  amperage: '',
  refrigerant: '',
  ambientTemp: '',
  notes: '',
};

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sectionEvidence(evidence: WorkOrderEvidence[], unitId: string, section: EvidenceSection) {
  return evidence.filter((item) => item.unitId === unitId && item.section === section);
}

function resolvedCount(section: ReportSection, evidence: WorkOrderEvidence[], unit: WorkOrderUnit) {
  return section.items.filter((item) => evidence.some((photo) => photo.itemKey === item.key) || unit.skippedItems?.[item.key]).length;
}

export function TechnicianEvidenceReport({ order, currentStaff }: { order: WorkOrder; currentStaff?: StaffProfile }) {
  const {
    currentUser,
    workOrderUnits,
    workOrderEvidence,
    saveWorkOrderUnit,
    addWorkOrderEvidence,
    removeWorkOrderEvidence,
  } = useAppState();

  const units = useMemo(
    () => workOrderUnits.filter((unit) => unit.workOrderId === order.id).sort((a, b) => a.sequence - b.sequence),
    [order.id, workOrderUnits],
  );
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [activeSection, setActiveSection] = useState<EvidenceSection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [findingCategory, setFindingCategory] = useState('Corrosión');
  const [findingSeverity, setFindingSeverity] = useState<UnitFinding['severity']>('Mantenimiento recomendado');
  const [findingDescription, setFindingDescription] = useState('');

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? units[0];
  const evidence = workOrderEvidence.filter((item) => item.workOrderId === order.id && item.unitId === selectedUnit?.id);
  const section = sections.find((item) => item.key === activeSection);

  useEffect(() => {
    if (!units.length) {
      setSelectedUnitId('');
      return;
    }
    if (!selectedUnitId || !units.some((unit) => unit.id === selectedUnitId)) setSelectedUnitId(units[0].id);
  }, [selectedUnitId, units]);

  useEffect(() => {
    setUnitLabel(selectedUnit?.label ?? '');
  }, [selectedUnit?.id, selectedUnit?.label]);

  async function initializeUnits() {
    if (!currentUser || units.length) return;
    setBusy(true);
    setMessage('');
    const count = Math.max(1, Number(order.airConditionerCount || 1));
    for (let index = 0; index < count; index += 1) {
      const now = new Date().toISOString();
      const unit: WorkOrderUnit = {
        id: `unit-${order.id}-${index + 1}`,
        workOrderId: order.id,
        equipmentId: index === 0 ? order.equipmentId : undefined,
        label: count === 1 ? 'Aire acondicionado principal' : `Unidad ${index + 1}`,
        sequence: index + 1,
        status: 'not_started',
        skippedItems: {},
        findings: [],
        initialMeasurements: { ...emptyMeasurements },
        finalMeasurements: { ...emptyMeasurements },
        disconnectInspection: { safetyConfirmed: false, condition: 'No inspeccionado', notes: '' },
        createdAt: now,
        updatedAt: now,
        createdByUserId: currentUser.id,
        createdByName: currentStaff?.name ?? currentUser.name,
      };
      const result = await saveWorkOrderUnit(unit);
      if (!result.ok) {
        setMessage(result.message ?? 'No se pudieron preparar las unidades.');
        setBusy(false);
        return;
      }
    }
    setMessage(`${count} unidad${count === 1 ? '' : 'es'} preparada${count === 1 ? '' : 's'} para el reporte.`);
    setBusy(false);
  }

  async function saveUnit(changes: Partial<WorkOrderUnit>, successMessage?: string) {
    if (!selectedUnit) return false;
    setBusy(true);
    const result = await saveWorkOrderUnit({ ...selectedUnit, ...changes, updatedAt: new Date().toISOString() });
    setBusy(false);
    setMessage(result.ok ? (successMessage ?? 'Sección guardada.') : result.message ?? 'No se pudo guardar.');
    return result.ok;
  }

  async function capture(item: EvidenceItem, camera: boolean) {
    if (!selectedUnit || !section || !currentUser) return;
    if (item.requiresSafeIsolation && !selectedUnit.disconnectInspection?.safetyConfirmed) {
      setMessage('Confirma primero que la energía está aislada y que es seguro abrir el disconnect.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Debes autorizar el acceso a la cámara o galería.');
      const picker = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.72 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.72 });
      if (picker.canceled) return;

      let uploaded = 0;
      for (const asset of picker.assets) {
        const evidenceId = nowId('evidence');
        const stored = await uploadWorkOrderEvidenceImage({
          uri: asset.uri,
          workOrderId: order.id,
          unitId: selectedUnit.id,
          evidenceId,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
        });
        const now = new Date().toISOString();
        const record: WorkOrderEvidence = {
          id: evidenceId,
          workOrderId: order.id,
          unitId: selectedUnit.id,
          equipmentId: selectedUnit.equipmentId,
          section: section.key,
          itemKey: item.key,
          label: item.label,
          moment: item.moment,
          ...stored,
          capturedAt: now,
          uploadedAt: now,
          uploadedByUserId: currentUser.id,
          uploadedByStaffId: currentStaff?.id,
          uploadedByName: currentStaff?.name ?? currentUser.name,
        };
        const result = await addWorkOrderEvidence(record);
        if (!result.ok) {
          await deleteWorkOrderEvidenceImage(stored.storagePath).catch(() => undefined);
          throw new Error(result.message ?? 'No se pudo registrar la evidencia.');
        }
        uploaded += 1;
      }
      const skippedItems = { ...(selectedUnit.skippedItems ?? {}) };
      delete skippedItems[item.key];
      await saveUnit({ skippedItems, status: selectedUnit.status === 'not_started' ? 'in_progress' : selectedUnit.status });
      setMessage(`${uploaded} foto${uploaded === 1 ? '' : 's'} subida${uploaded === 1 ? '' : 's'}: ${item.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeEvidence(evidenceItem: WorkOrderEvidence) {
    setBusy(true);
    const result = await removeWorkOrderEvidence(evidenceItem.id);
    if (result.ok) await deleteWorkOrderEvidenceImage(evidenceItem.storagePath).catch(() => undefined);
    setBusy(false);
    setMessage(result.ok ? 'Fotografía eliminada.' : result.message ?? 'No se pudo eliminar la fotografía.');
  }

  async function toggleSkipped(item: EvidenceItem) {
    if (!selectedUnit) return;
    const skippedItems = { ...(selectedUnit.skippedItems ?? {}) };
    if (skippedItems[item.key]) delete skippedItems[item.key];
    else skippedItems[item.key] = item.requiresSafeIsolation ? 'No fue seguro abrir o inspeccionar el componente.' : 'No aplica a este servicio o no fue accesible.';
    await saveUnit({ skippedItems });
  }

  async function saveMeasurements(kind: 'initial' | 'final', measurements: UnitMeasurements) {
    await saveUnit(kind === 'initial' ? { initialMeasurements: measurements } : { finalMeasurements: measurements }, 'Mediciones guardadas.');
  }

  async function addFinding() {
    if (!selectedUnit || !findingDescription.trim()) {
      setMessage('Describe el hallazgo antes de guardarlo.');
      return;
    }
    const finding: UnitFinding = {
      id: nowId('finding'),
      category: findingCategory,
      severity: findingSeverity,
      description: findingDescription.trim(),
      clientInformed: false,
      createdAt: new Date().toISOString(),
      createdByName: currentStaff?.name ?? currentUser?.name ?? 'Técnico DEMAC',
    };
    await saveUnit({ findings: [...(selectedUnit.findings ?? []), finding] }, 'Hallazgo registrado. Ahora puedes añadir su fotografía.');
    setFindingDescription('');
  }

  if (!['En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada'].includes(order.status)) {
    return <Card><SectionTitle title="Reporte guiado por equipo" subtitle="Presiona Iniciar trabajo para habilitar las secciones de evidencia." /></Card>;
  }

  if (!units.length) {
    return (
      <Card>
        <SectionTitle title="Preparar reporte por aire acondicionado" subtitle={`La cita indica ${Math.max(1, Number(order.airConditionerCount || 1))} unidad(es).`} />
        <Text style={styles.help}>DEMAC creará un reporte separado para cada aire. Después podrás nombrarlos Sala, Cuarto principal, Oficina 2, etc.</Text>
        <Button label={busy ? 'Preparando…' : 'Preparar unidades del reporte'} disabled={busy} onPress={() => void initializeUnits()} />
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Card>
    );
  }

  if (section && selectedUnit) {
    const sectionPhotos = sectionEvidence(evidence, selectedUnit.id, section.key);
    const initial = selectedUnit.initialMeasurements ?? { ...emptyMeasurements };
    const final = selectedUnit.finalMeasurements ?? { ...emptyMeasurements };
    return (
      <Card>
        <Button compact variant="secondary" label="← Regresar al menú del reporte" onPress={() => setActiveSection(null)} />
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>{section.icon}</Text>
          <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>{section.title}</Text><Text style={styles.sectionSubtitle}>{selectedUnit.label} · {section.subtitle}</Text></View>
          <Pill label={`${resolvedCount(section, sectionPhotos, selectedUnit)}/${section.items.length}`} tone={resolvedCount(section, sectionPhotos, selectedUnit) === section.items.length ? 'success' : 'warning'} />
        </View>

        {section.key === 'electrical_disconnect' ? (
          <View style={styles.protocolBox}>
            <Text style={styles.protocolTitle}>Confirmación de seguridad</Text>
            <Pressable style={[styles.safetyToggle, selectedUnit.disconnectInspection?.safetyConfirmed && styles.safetyToggleActive]} onPress={() => void saveUnit({ disconnectInspection: { ...selectedUnit.disconnectInspection, safetyConfirmed: !selectedUnit.disconnectInspection?.safetyConfirmed } })}>
              <Text style={styles.safetyMark}>{selectedUnit.disconnectInspection?.safetyConfirmed ? '✓' : '○'}</Text>
              <Text style={styles.safetyText}>La energía fue aislada y es seguro abrir e inspeccionar el disconnect.</Text>
            </Pressable>
            <View style={styles.optionRow}>
              {['Buen estado', 'Requiere mantenimiento', 'Reemplazo recomendado', 'Peligro de seguridad', 'No inspeccionado'].map((condition) => (
                <Button key={condition} compact variant={selectedUnit.disconnectInspection?.condition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => void saveUnit({ disconnectInspection: { ...selectedUnit.disconnectInspection, condition: condition as WorkOrderUnit['disconnectInspection']['condition'] } })} />
              ))}
            </View>
            <Input label="Observaciones del switch" multiline value={selectedUnit.disconnectInspection?.notes ?? ''} onChangeText={(notes) => void saveUnit({ disconnectInspection: { ...selectedUnit.disconnectInspection, notes } })} placeholder="Corrosión, agua, cables quemados, terminales flojos, tierra, capacidad…" />
          </View>
        ) : null}

        {section.key === 'initial_pressures' ? <MeasurementsEditor title="Mediciones antes del servicio" value={initial} disabled={busy} onSave={(value) => void saveMeasurements('initial', value)} /> : null}
        {section.key === 'final_pressures' ? <MeasurementsEditor title="Mediciones después del servicio" value={final} disabled={busy} onSave={(value) => void saveMeasurements('final', value)} /> : null}

        {section.key === 'finding' ? (
          <View style={styles.protocolBox}>
            <Text style={styles.protocolTitle}>Registrar hallazgo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              {['Tapa partida', 'Corrosión', 'Bracket oxidado', 'Cable quemado', 'Disconnect deteriorado', 'Coil dañado', 'Aislamiento deteriorado', 'Fuga de aceite', 'Drenaje incorrecto', 'Instalación deficiente', 'Otro'].map((category) => <Button key={category} compact variant={findingCategory === category ? 'primary' : 'secondary'} label={category} onPress={() => setFindingCategory(category)} />)}
            </ScrollView>
            <View style={styles.optionRow}>{(['Informativo', 'Mantenimiento recomendado', 'Urgente', 'Peligro de seguridad'] as UnitFinding['severity'][]).map((severity) => <Button key={severity} compact variant={findingSeverity === severity ? 'primary' : 'secondary'} label={severity} onPress={() => setFindingSeverity(severity)} />)}</View>
            <Input label="Descripción" multiline value={findingDescription} onChangeText={setFindingDescription} placeholder="Describe lo encontrado y su ubicación…" />
            <Button label="Guardar hallazgo" disabled={busy} onPress={() => void addFinding()} />
            {(selectedUnit.findings ?? []).map((finding) => <View key={finding.id} style={styles.findingRow}><View style={{ flex: 1 }}><Text style={styles.findingTitle}>{finding.category}</Text><Text style={styles.findingDescription}>{finding.description}</Text></View><Pill label={finding.severity} tone={finding.severity === 'Peligro de seguridad' ? 'danger' : finding.severity === 'Urgente' ? 'warning' : 'info'} /></View>)}
            <EvidenceChecklistItem item={{ key: 'finding-photo', label: 'Fotografía adicional del hallazgo', moment: 'during' }} photos={sectionPhotos.filter((photo) => photo.itemKey === 'finding-photo')} skipped={false} busy={busy} onCamera={() => void capture({ key: 'finding-photo', label: 'Fotografía adicional del hallazgo', moment: 'during' }, true)} onGallery={() => void capture({ key: 'finding-photo', label: 'Fotografía adicional del hallazgo', moment: 'during' }, false)} onSkip={() => undefined} onDelete={(photo) => void removeEvidence(photo)} />
          </View>
        ) : null}

        {section.items.map((item) => (
          <EvidenceChecklistItem
            key={item.key}
            item={item}
            photos={sectionPhotos.filter((photo) => photo.itemKey === item.key)}
            skipped={Boolean(selectedUnit.skippedItems?.[item.key])}
            skipReason={selectedUnit.skippedItems?.[item.key]}
            busy={busy}
            locked={Boolean(item.requiresSafeIsolation && !selectedUnit.disconnectInspection?.safetyConfirmed)}
            onCamera={() => void capture(item, true)}
            onGallery={() => void capture(item, false)}
            onSkip={() => void toggleSkipped(item)}
            onDelete={(photo) => void removeEvidence(photo)}
          />
        ))}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Card>
    );
  }

  const totalItems = sections.reduce((sum, item) => sum + item.items.length, 0);
  const totalResolved = sections.reduce((sum, item) => sum + resolvedCount(item, evidence, selectedUnit), 0);

  return (
    <Card>
      <SectionTitle title="Reporte guiado por aire acondicionado" subtitle="Selecciona una unidad y completa cada sección. Las fotografías se agrupan automáticamente en el informe." />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitTabs}>
        {units.map((unit) => <Button key={unit.id} compact variant={selectedUnit?.id === unit.id ? 'primary' : 'secondary'} label={unit.label} onPress={() => { setSelectedUnitId(unit.id); setActiveSection(null); }} />)}
      </ScrollView>

      {selectedUnit ? (
        <>
          <View style={styles.unitEditor}>
            <Input style={{ flex: 1 }} label="Nombre o ubicación de esta unidad" value={unitLabel} onChangeText={setUnitLabel} placeholder="Ej. Cuarto principal" />
            <Button compact label="Guardar nombre" disabled={busy || !unitLabel.trim()} onPress={() => void saveUnit({ label: unitLabel.trim() }, 'Nombre de la unidad actualizado.')} />
          </View>
          <View style={styles.overallProgress}><Text style={styles.overallTitle}>{selectedUnit.label}</Text><Text style={styles.overallText}>{totalResolved} de {totalItems} evidencias resueltas</Text><Pill label={selectedUnit.status === 'completed' ? 'Unidad completada' : selectedUnit.status === 'pending' ? 'Pendiente' : 'En proceso'} tone={selectedUnit.status === 'completed' ? 'success' : selectedUnit.status === 'pending' ? 'warning' : 'info'} /></View>
          <View style={styles.sectionGrid}>
            {sections.map((item) => {
              const photos = sectionEvidence(evidence, selectedUnit.id, item.key);
              const resolved = resolvedCount(item, photos, selectedUnit);
              return (
                <Pressable key={item.key} onPress={() => setActiveSection(item.key)} style={({ pressed }) => [styles.sectionCard, pressed && { opacity: 0.78 }]}>
                  <Text style={styles.sectionCardIcon}>{item.icon}</Text>
                  <View style={{ flex: 1 }}><Text style={styles.sectionCardTitle}>{item.title}</Text><Text style={styles.sectionCardSubtitle}>{item.subtitle}</Text></View>
                  {item.items.length ? <Pill label={`${resolved}/${item.items.length}`} tone={resolved === item.items.length ? 'success' : resolved ? 'warning' : 'neutral'} /> : <Pill label={`${selectedUnit.findings?.length ?? 0}`} tone={(selectedUnit.findings?.length ?? 0) ? 'warning' : 'neutral'} />}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.completionActions}>
            <Button variant="secondary" label="Dejar esta unidad pendiente" disabled={busy} onPress={() => void saveUnit({ status: 'pending' }, 'Unidad marcada pendiente. Describe el motivo en el reporte general.')} />
            <Button variant="success" label="Completar esta unidad" disabled={busy || totalResolved < totalItems} onPress={() => void saveUnit({ status: 'completed', completedAt: new Date().toISOString() }, 'Unidad completada correctamente.')} />
          </View>
          {totalResolved < totalItems ? <Text style={styles.help}>Para completar la unidad, cada evidencia recomendada debe tener una foto o estar marcada como No aplica / condición insegura.</Text> : null}
        </>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Card>
  );
}

function MeasurementsEditor({ title, value, disabled, onSave }: { title: string; value: UnitMeasurements; disabled: boolean; onSave: (value: UnitMeasurements) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const field = (key: keyof UnitMeasurements, label: string, placeholder: string) => <Input style={styles.measureField} label={label} value={draft[key] ?? ''} onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))} placeholder={placeholder} />;
  return <View style={styles.protocolBox}><Text style={styles.protocolTitle}>{title}</Text><View style={styles.measureGrid}>{field('lowPressure', 'Presión baja', '125 PSI')}{field('highPressure', 'Presión alta', '410 PSI')}{field('returnTemp', 'Temperatura retorno', '27 °C')}{field('supplyTemp', 'Temperatura suministro', '14 °C')}{field('amperage', 'Amperaje', '12.4 A')}{field('refrigerant', 'Refrigerante', 'R410A')}{field('ambientTemp', 'Temperatura exterior', '31 °C')}</View><Input label="Observaciones" multiline value={draft.notes ?? ''} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} placeholder="Condición de operación al tomar las lecturas…" /><Button label="Guardar mediciones" disabled={disabled} onPress={() => onSave(draft)} /></View>;
}

function EvidenceChecklistItem({ item, photos, skipped, skipReason, busy, locked, onCamera, onGallery, onSkip, onDelete }: { item: EvidenceItem; photos: WorkOrderEvidence[]; skipped: boolean; skipReason?: string; busy: boolean; locked?: boolean; onCamera: () => void; onGallery: () => void; onSkip: () => void; onDelete: (photo: WorkOrderEvidence) => void }) {
  const complete = photos.length > 0 || skipped;
  return (
    <View style={[styles.checkItem, complete && styles.checkItemComplete]}>
      <View style={styles.checkHeader}><Text style={styles.checkMark}>{complete ? '✓' : '○'}</Text><View style={{ flex: 1 }}><Text style={styles.checkTitle}>{item.label}</Text>{item.help ? <Text style={styles.checkHelp}>{item.help}</Text> : null}{locked ? <Text style={styles.lockedText}>Confirma aislamiento seguro para habilitar esta evidencia.</Text> : null}{skipReason ? <Text style={styles.skippedText}>{skipReason}</Text> : null}</View><Pill label={photos.length ? `${photos.length} foto${photos.length === 1 ? '' : 's'}` : skipped ? 'No aplica' : 'Pendiente'} tone={complete ? 'success' : 'warning'} /></View>
      {photos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>{photos.map((photo) => <View key={photo.id} style={styles.photoItem}><Image source={{ uri: photo.downloadUrl }} style={styles.photo} /><Button compact variant="danger" label="Eliminar" disabled={busy} onPress={() => onDelete(photo)} /></View>)}</ScrollView> : null}
      <View style={styles.itemActions}><Button compact label="Tomar foto" disabled={busy || locked} onPress={onCamera} /><Button compact variant="secondary" label="Galería" disabled={busy || locked} onPress={onGallery} /><Button compact variant="secondary" label={skipped ? 'Quitar No aplica' : 'No aplica / inseguro'} disabled={busy || photos.length > 0} onPress={onSkip} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 12 },
  message: { color: colors.primaryDark, backgroundColor: colors.primaryLight, borderRadius: 10, padding: 11, fontWeight: '800', marginTop: 10 },
  unitTabs: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  unitEditor: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, marginBottom: 12 },
  overallProgress: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 13, backgroundColor: '#F4F7FB', borderRadius: 12, marginBottom: 12 },
  overallTitle: { color: colors.text, fontWeight: '900', fontSize: 15 },
  overallText: { color: colors.muted, flex: 1, minWidth: 150 },
  sectionGrid: { gap: 9 },
  sectionCard: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 13 },
  sectionCardIcon: { fontSize: 22 },
  sectionCardTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  sectionCardSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3, lineHeight: 15 },
  completionActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9, marginTop: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  sectionIcon: { fontSize: 30 },
  sectionTitle: { color: colors.text, fontWeight: '900', fontSize: 20 },
  sectionSubtitle: { color: colors.muted, marginTop: 4, lineHeight: 17 },
  protocolBox: { backgroundColor: '#F6F8FB', borderRadius: 13, padding: 13, gap: 10, marginBottom: 13 },
  protocolTitle: { color: colors.text, fontWeight: '900', fontSize: 14 },
  safetyToggle: { flexDirection: 'row', gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 12, backgroundColor: '#FFFFFF' },
  safetyToggleActive: { borderColor: colors.success, backgroundColor: colors.successLight },
  safetyMark: { color: colors.success, fontWeight: '900', fontSize: 17 },
  safetyText: { color: colors.text, flex: 1, fontWeight: '700', lineHeight: 18 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  measureField: { flex: 1, minWidth: 140 },
  checkItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, marginBottom: 10, gap: 10 },
  checkItemComplete: { borderColor: '#B5DFC0', backgroundColor: '#F8FFF9' },
  checkHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  checkMark: { color: colors.success, fontSize: 18, fontWeight: '900' },
  checkTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  checkHelp: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  lockedText: { color: colors.warning, fontSize: 10, fontWeight: '800', marginTop: 4 },
  skippedText: { color: colors.muted, fontSize: 9, fontStyle: 'italic', marginTop: 4 },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  photoStrip: { flexDirection: 'row', gap: 9 },
  photoItem: { width: 130, gap: 5 },
  photo: { width: 130, height: 98, borderRadius: 9, backgroundColor: '#E8EDF3' },
  findingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  findingTitle: { color: colors.text, fontWeight: '900' },
  findingDescription: { color: colors.muted, marginTop: 3, lineHeight: 16 },
});
