import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';
import {
  equipmentDocumentIdFromQr,
  equipmentQrCodesMatch,
  normalizeEquipmentQrCode,
  shortEquipmentQrCode,
} from '../features/technicianPortal/equipmentQr';
import { EquipmentComponent } from '../features/technicianPortal/contracts';
import { deleteWorkOrderEvidenceImage, uploadWorkOrderEvidenceImage } from '../services/firebaseStorage';
import { useAppState } from '../state/AppState';
import { RegisteredEquipmentSystem, useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';
import { WorkOrderEvidence } from '../types';

const SYSTEM_TYPES = ['Split wall mounted', 'Cassette', 'Floor ceiling', 'Central', 'VRF', 'Otro'];
const REFRIGERANTS = ['R22', 'R32', 'R410A'];
const VOLTAGES = ['110', '220', '380'];
const LOCATION_SUGGESTIONS = [
  'Cuarto principal',
  'Sala',
  'Cocina',
  'Comedor',
  'Segundo cuarto',
  'Tercer cuarto',
  'Cuarto de huéspedes',
  'Oficina',
  'Laundry',
  'Garage',
  'Pasillo',
  'Apartamento',
];

type PanelMode = 'list' | 'add' | 'search';
type PlateKind = 'indoor' | 'outdoor';
type CapturedAsset = ImagePicker.ImagePickerAsset;

type UploadedPlateEvidence = {
  evidence: WorkOrderEvidence;
  storagePath: string;
};

function clean(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}

function numeric(value: string) {
  const parsed = Number(value.replace(/\D/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatBtu(value?: number) {
  return value ? `${value.toLocaleString('en-US')} BTU` : 'BTU pendiente';
}

function equipmentMainComponent(equipment?: RegisteredEquipmentSystem) {
  return equipment?.components.find((component) => component.componentType === 'indoor') ?? equipment?.components[0];
}

function equipmentSummary(equipment?: RegisteredEquipmentSystem) {
  if (!equipment) return 'Pendiente de registro o QR';
  const component = equipmentMainComponent(equipment);
  return `${component?.brand ?? 'Marca pendiente'} · ${formatBtu(component?.btu)}`;
}

async function detectQrFromImage(asset: CapturedAsset) {
  const detectorConstructor = (globalThis as unknown as {
    BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: unknown) => Promise<Array<{ rawValue?: string }>> };
  }).BarcodeDetector;
  const createBitmap = (globalThis as unknown as { createImageBitmap?: (source: Blob) => Promise<{ close?: () => void }> }).createImageBitmap;
  if (!detectorConstructor || !createBitmap) return undefined;

  const response = await fetch(asset.uri);
  if (!response.ok) return undefined;
  const bitmap = await createBitmap(await response.blob());
  try {
    const detector = new detectorConstructor({ formats: ['qr_code'] });
    const results = await detector.detect(bitmap);
    return results.find((result) => result.rawValue?.trim())?.rawValue?.trim();
  } finally {
    bitmap.close?.();
  }
}

export function TechnicianPortalEquipmentTestScreen() {
  const {
    clients,
    properties,
    workOrders,
    currentUser,
    addWorkOrderEvidence,
    removeWorkOrderEvidence,
  } = useAppState();
  const {
    workVisits,
    visitUnits,
    equipmentSystems,
    loading,
    dataError,
    lastSyncedAt,
    refreshTechnicianPortalData,
    registerEquipmentSystem,
    attachEquipmentToVisitUnit,
    addVisitUnit,
  } = useTechnicianPortalState();

  const [selectedVisitId, setSelectedVisitId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  const [mode, setMode] = useState<PanelMode>('list');
  const [lookupQr, setLookupQr] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Selecciona una visita preparada para registrar, buscar o escanear un aire acondicionado.');

  const [qrCode, setQrCode] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [systemType, setSystemType] = useState('Split wall mounted');
  const [brand, setBrand] = useState('');
  const [btu, setBtu] = useState('');
  const [refrigerant, setRefrigerant] = useState('R32');
  const [voltage, setVoltage] = useState('220');
  const [indoorPlate, setIndoorPlate] = useState<CapturedAsset | undefined>();
  const [outdoorPlate, setOutdoorPlate] = useState<CapturedAsset | undefined>();

  const eligibleVisits = useMemo(() => workVisits
    .filter((visit) => visit.status !== 'cancelled')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12), [workVisits]);

  useEffect(() => {
    if (!selectedVisitId && eligibleVisits.length) setSelectedVisitId(eligibleVisits[0].id);
  }, [eligibleVisits, selectedVisitId]);

  const selectedVisit = eligibleVisits.find((visit) => visit.id === selectedVisitId);
  const selectedOrder = workOrders.find((order) => order.id === selectedVisit?.workOrderId);
  const selectedClient = clients.find((client) => client.id === selectedVisit?.clientId);
  const selectedProperty = properties.find((property) => property.id === selectedVisit?.propertyId);
  const selectedUnits = visitUnits.filter((unit) => unit.visitId === selectedVisitId);
  const selectedUnit = selectedUnits.find((unit) => unit.id === selectedUnitId);
  const targetPendingUnit = selectedUnit && !selectedUnit.equipmentSystemId
    ? selectedUnit
    : selectedUnits.find((unit) => !unit.equipmentSystemId);
  const clientEquipment = equipmentSystems.filter((equipment) => equipment.clientId === selectedVisit?.clientId
    && (!selectedVisit?.propertyId || equipment.propertyId === selectedVisit.propertyId));
  const selectedEquipment = equipmentSystems.find((equipment) => equipment.id === selectedEquipmentId);

  const locationSuggestions = useMemo(() => {
    const search = locationLabel.trim().toLowerCase();
    return LOCATION_SUGGESTIONS
      .filter((suggestion) => !search || suggestion.toLowerCase().includes(search))
      .slice(0, 8);
  }, [locationLabel]);

  useEffect(() => {
    if (selectedUnitId && !selectedUnits.some((unit) => unit.id === selectedUnitId)) setSelectedUnitId('');
  }, [selectedUnitId, selectedUnits]);

  function resetForm() {
    setQrCode('');
    setLocationLabel('');
    setSystemType('Split wall mounted');
    setBrand('');
    setBtu('');
    setRefrigerant('R32');
    setVoltage('220');
    setIndoorPlate(undefined);
    setOutdoorPlate(undefined);
  }

  function openAdd(unitId = '') {
    resetForm();
    setSelectedUnitId(unitId);
    setSelectedEquipmentId('');
    setMode('add');
    setMessage(unitId ? 'Registra el equipo y vincúlalo con el aire seleccionado.' : 'Registra un aire adicional para esta visita.');
  }

  function openSearch(unitId = '') {
    setSelectedUnitId(unitId);
    setSelectedEquipmentId('');
    setLookupQr('');
    setMode('search');
    setMessage('Escanea el sticker QR o busca el aire en la lista del cliente.');
  }

  async function capturePhoto(kind: PlateKind) {
    setMessage('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('Debes autorizar la cámara para tomar la fotografía de la placa.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.78 });
    if (result.canceled || !result.assets[0]) return;
    if (kind === 'indoor') setIndoorPlate(result.assets[0]);
    else setOutdoorPlate(result.assets[0]);
    setMessage(`Foto de placa ${kind === 'indoor' ? 'indoor' : 'outdoor'} lista para registrar.`);
  }

  async function scanQr(target: 'register' | 'lookup') {
    setMessage('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('Debes autorizar la cámara para escanear el QR. También puedes escribir el código manualmente.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;

    setWorking(true);
    try {
      const detected = await detectQrFromImage(result.assets[0]);
      if (!detected) {
        setMessage('No se pudo leer el QR automáticamente. Acerca la cámara, evita reflejos e intenta otra vez, o escribe el código del sticker manualmente.');
        return;
      }
      if (target === 'register') {
        setQrCode(detected);
        setMessage(`QR vinculado: ${shortEquipmentQrCode(detected)}.`);
      } else {
        setLookupQr(detected);
        await findAndUseQr(detected, true);
      }
    } catch (error) {
      setMessage(`No se pudo leer el QR: ${error instanceof Error ? error.message : String(error)}. Puedes escribir el código manualmente.`);
    } finally {
      setWorking(false);
    }
  }

  async function uploadPlateEvidence(asset: CapturedAsset, kind: PlateKind, equipmentId: string, unitId: string): Promise<UploadedPlateEvidence> {
    if (!selectedOrder || !currentUser) throw new Error('No hay una orden o usuario activo.');
    const evidenceId = `equipment-nameplate-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored = await uploadWorkOrderEvidenceImage({
      uri: asset.uri,
      workOrderId: selectedOrder.id,
      unitId,
      evidenceId,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });
    const now = new Date().toISOString();
    const evidence: WorkOrderEvidence = {
      id: evidenceId,
      workOrderId: selectedOrder.id,
      equipmentId,
      unitId,
      section: 'identification',
      itemKey: `${kind}-nameplate`,
      label: kind === 'indoor' ? 'Placa de información indoor' : 'Placa de información outdoor',
      moment: 'before',
      ...stored,
      note: kind === 'outdoor' ? 'La placa puede estar desgastada o no ser completamente legible por exposición a la intemperie.' : undefined,
      capturedAt: now,
      uploadedAt: now,
      uploadedByUserId: currentUser.id,
      uploadedByName: currentUser.name,
    };
    const saved = await addWorkOrderEvidence(evidence);
    if (!saved.ok) {
      await deleteWorkOrderEvidenceImage(stored.storagePath).catch(() => undefined);
      throw new Error(saved.message ?? 'No se pudo guardar la fotografía de la placa.');
    }
    return { evidence, storagePath: stored.storagePath };
  }

  async function rollbackUploadedEvidence(uploaded: UploadedPlateEvidence[]) {
    for (const item of uploaded) {
      await removeWorkOrderEvidence(item.evidence.id).catch(() => undefined);
      await deleteWorkOrderEvidenceImage(item.storagePath).catch(() => undefined);
    }
  }

  function components(indoorEvidenceId: string, outdoorEvidenceId: string): EquipmentComponent[] {
    const capacity = numeric(btu);
    const common = {
      brand: clean(brand),
      btu: capacity,
      refrigerant,
      voltage,
    };
    return [
      {
        id: `indoor-${Date.now().toString(36)}`,
        componentType: 'indoor',
        ...common,
        nameplateEvidenceId: indoorEvidenceId,
        notes: 'Modelo y serial se documentan mediante fotografía de placa.',
      },
      {
        id: `outdoor-${Date.now().toString(36)}`,
        componentType: 'outdoor',
        ...common,
        nameplateEvidenceId: outdoorEvidenceId,
        notes: 'Fotografía requerida aunque la placa esté desgastada o no sea completamente legible.',
      },
    ];
  }

  async function registerEquipment() {
    if (!selectedVisit || !selectedOrder || !currentUser) {
      setMessage('Primero selecciona una visita preparada.');
      return;
    }
    if (!qrCode.trim()) {
      setMessage('Escanea el sticker QR preimpreso o escribe su código para vincularlo.');
      return;
    }
    if (equipmentSystems.some((equipment) => equipmentQrCodesMatch(equipment.qrCode, qrCode))) {
      setMessage('Este QR ya está vinculado con otro aire. Usa Escanear QR o Buscar aire para agregarlo a la visita.');
      return;
    }
    if (!locationLabel.trim()) {
      setMessage('Selecciona o escribe el nombre o ubicación del aire.');
      return;
    }
    if (!brand.trim() || !numeric(btu)) {
      setMessage('Registra la marca y la capacidad en BTU.');
      return;
    }
    if (!refrigerant || !voltage) {
      setMessage('Selecciona el refrigerante y el voltaje.');
      return;
    }
    if (!indoorPlate || !outdoorPlate) {
      setMessage('Debes tomar la foto de la placa indoor y la foto de la placa outdoor.');
      return;
    }

    setWorking(true);
    const normalizedQr = normalizeEquipmentQrCode(qrCode);
    const equipmentId = equipmentDocumentIdFromQr(normalizedQr);
    const evidenceUnitId = targetPendingUnit?.id ?? equipmentId;
    const uploaded: UploadedPlateEvidence[] = [];

    try {
      const indoorEvidence = await uploadPlateEvidence(indoorPlate, 'indoor', equipmentId, evidenceUnitId);
      uploaded.push(indoorEvidence);
      const outdoorEvidence = await uploadPlateEvidence(outdoorPlate, 'outdoor', equipmentId, evidenceUnitId);
      uploaded.push(outdoorEvidence);

      const { result, equipment } = await registerEquipmentSystem({
        qrCode: normalizedQr,
        clientId: selectedVisit.clientId,
        propertyId: selectedVisit.propertyId,
        locationLabel,
        systemType,
        components: components(indoorEvidence.evidence.id, outdoorEvidence.evidence.id),
        sourceWorkOrderId: selectedOrder.id,
        sourceVisitId: selectedVisit.id,
        condition: 'registered',
      });

      if (!result.ok || !equipment) {
        await rollbackUploadedEvidence(uploaded);
        setMessage(result.message ?? 'No se pudo registrar el aire acondicionado.');
        return;
      }

      let unit = targetPendingUnit;
      if (unit) {
        const attached = await attachEquipmentToVisitUnit(unit, equipment);
        if (!attached.ok) setMessage(attached.message ?? 'El equipo se registró, pero no se pudo asociar al aire pendiente.');
      } else {
        const created = await addVisitUnit({
          visitId: selectedVisit.id,
          workOrderId: selectedOrder.id,
          locationLabel: equipment.locationLabel,
          source: 'registered_on_site',
          equipmentSystemId: equipment.id,
          addedOnSite: true,
          addedReason: 'Equipo registrado y agregado durante la visita.',
        });
        unit = created.unit;
      }

      setSelectedEquipmentId(equipment.id);
      if (unit) setSelectedUnitId(unit.id);
      setMode('list');
      resetForm();
      setMessage(`${equipment.locationLabel} registrado y vinculado con el sticker QR ${shortEquipmentQrCode(equipment.qrCode)}.`);
    } catch (error) {
      await rollbackUploadedEvidence(uploaded);
      setMessage(`No se pudo registrar el aire: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWorking(false);
    }
  }

  async function attachExistingEquipment(equipment: RegisteredEquipmentSystem) {
    if (!selectedVisit || !selectedOrder) {
      setMessage('Selecciona una visita preparada.');
      return;
    }
    if (equipment.clientId !== selectedVisit.clientId) {
      setMessage('Este QR pertenece a otro cliente y no puede agregarse a esta visita.');
      return;
    }

    const alreadyIncluded = selectedUnits.some((unit) => unit.equipmentSystemId === equipment.id);
    if (alreadyIncluded) {
      setSelectedEquipmentId(equipment.id);
      setMode('list');
      setMessage(`${equipment.locationLabel} ya está incluido en esta visita.`);
      return;
    }

    const target = targetPendingUnit;
    if (target) {
      const result = await attachEquipmentToVisitUnit(target, equipment);
      if (!result.ok) {
        setMessage(result.message ?? 'No se pudo asociar el aire registrado.');
        return;
      }
      setSelectedUnitId(target.id);
    } else {
      const { result, unit } = await addVisitUnit({
        visitId: selectedVisit.id,
        workOrderId: selectedOrder.id,
        locationLabel: equipment.locationLabel,
        source: 'qr_scan',
        equipmentSystemId: equipment.id,
        addedOnSite: true,
        addedReason: 'Equipo localizado mediante QR o búsqueda durante la visita.',
      });
      if (!result.ok) {
        setMessage(result.message ?? 'No se pudo agregar el aire registrado.');
        return;
      }
      if (unit) setSelectedUnitId(unit.id);
    }

    setSelectedEquipmentId(equipment.id);
    setMode('list');
    setMessage(`${equipment.locationLabel} agregado a la visita: ${equipmentSummary(equipment)}.`);
  }

  async function findAndUseQr(value = lookupQr, autoAttach = false) {
    const normalized = normalizeEquipmentQrCode(value);
    const found = equipmentSystems.find((equipment) => equipmentQrCodesMatch(equipment.qrCode, normalized));
    if (!found) {
      setSelectedEquipmentId('');
      setMode('search');
      setMessage(`No se encontró un aire registrado con ese QR. Puedes presionar Añadir para registrarlo como equipo nuevo.`);
      return;
    }
    setSelectedEquipmentId(found.id);
    if (autoAttach) await attachExistingEquipment(found);
    else setMessage(`${found.locationLabel} encontrado: ${equipmentSummary(found)}.`);
  }

  function returnToPersistence() {
    if (typeof window === 'undefined') return;
    window.location.assign(`${window.location.pathname}?technicianPortalPersistence=1`);
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>PORTAL DEL TÉCNICO V2</Text>
          <Text style={styles.title}>Equipos del cliente</Text>
          <Text style={styles.copy}>Escanea un sticker QR existente, busca un aire registrado o añade un equipo nuevo sin modificar el booking original.</Text>
        </View>
        <Pill label={currentUser?.authProvider === 'firebase' ? 'Firebase real' : 'Modo demo'} tone={currentUser?.authProvider === 'firebase' ? 'success' : 'warning'} />
      </View>

      {dataError ? <View style={styles.errorBox}><Text style={styles.errorText}>{dataError}</Text></View> : null}

      <Card>
        <SectionTitle title="1. Seleccionar visita preparada" subtitle="Selecciona el cliente que el equipo está atendiendo" />
        {eligibleVisits.length ? eligibleVisits.map((visit) => {
          const client = clients.find((item) => item.id === visit.clientId);
          const property = properties.find((item) => item.id === visit.propertyId);
          const active = visit.id === selectedVisitId;
          return (
            <Pressable
              key={visit.id}
              onPress={() => {
                setSelectedVisitId(visit.id);
                setSelectedUnitId('');
                setSelectedEquipmentId('');
                setMode('list');
              }}
              style={[styles.row, active && styles.rowActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.code}>{visit.id}</Text>
                <Text style={styles.rowTitle}>{client?.name ?? 'Cliente'}</Text>
                <Text style={styles.rowMeta}>{property?.name ?? property?.address ?? 'Propiedad'} · {visit.scheduledScopeSnapshot.serviceName ?? 'Trabajo programado'}</Text>
              </View>
              <Pill label={visit.status.replace(/_/g, ' ')} tone={active ? 'info' : 'neutral'} />
            </Pressable>
          );
        }) : <EmptyState icon="📋" title="Sin visitas preparadas" message="Prepara primero una visita desde la prueba de persistencia." />}
      </Card>

      {selectedVisit ? (
        <Card>
          <SectionTitle
            title="2. Aires acondicionados registrados"
            subtitle={`${selectedClient?.name ?? 'Cliente'} · ${selectedProperty?.name ?? selectedProperty?.address ?? selectedOrder?.address ?? 'Propiedad'}`}
          />
          <View style={styles.mainActions}>
            <Button compact icon="▣" label={working ? 'Escaneando…' : 'Escanear QR'} disabled={working} onPress={() => void scanQr('lookup')} />
            <Button compact icon="⌕" label="Buscar aire" variant="secondary" onPress={() => openSearch(selectedUnitId)} />
            <Button compact icon="＋" label="Añadir" variant="success" onPress={() => openAdd()} />
          </View>

          {selectedUnits.length ? selectedUnits.map((unit) => {
            const linkedEquipment = equipmentSystems.find((equipment) => equipment.id === unit.equipmentSystemId);
            const selected = unit.id === selectedUnitId;
            return (
              <Pressable
                key={unit.id}
                onPress={() => setSelectedUnitId(unit.id)}
                style={[styles.row, selected && styles.rowActive]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{unit.locationLabel}</Text>
                  <Text style={styles.equipmentSummary}>{equipmentSummary(linkedEquipment)}</Text>
                  <Text style={styles.rowMeta}>{linkedEquipment ? `${linkedEquipment.systemType} · QR ${shortEquipmentQrCode(linkedEquipment.qrCode, 24)}` : 'Aire programado pendiente de identificar'}</Text>
                </View>
                {linkedEquipment
                  ? <Pill label="Registrado" tone="success" />
                  : <Button compact label="Registrar" variant="secondary" onPress={() => openAdd(unit.id)} />}
              </Pressable>
            );
          }) : <EmptyState icon="❄" title="Sin aires en esta visita" message="Presiona Añadir, escanea un QR o busca un aire registrado." />}
        </Card>
      ) : null}

      {selectedVisit && mode === 'add' ? (
        <Card>
          <SectionTitle
            title="Registrar aire nuevo"
            subtitle={selectedUnit ? `Se vinculará con ${selectedUnit.locationLabel}` : 'Se añadirá como un aire nuevo a esta visita'}
            action={<Button compact label="Cerrar" variant="ghost" onPress={() => setMode('list')} />}
          />

          <View style={styles.qrBox}>
            <View style={{ flex: 1 }}>
              <Text style={styles.qrLabel}>STICKER QR PREIMPRESO</Text>
              <Text style={styles.qrValue}>{qrCode ? shortEquipmentQrCode(qrCode) : 'Aún no vinculado'}</Text>
              <Text style={styles.qrHelp}>Pega el sticker al equipo y escanéalo. DEMAC no genera el código.</Text>
            </View>
            <Button compact label={working ? 'Leyendo…' : 'Vincular QR'} variant="secondary" disabled={working} onPress={() => void scanQr('register')} />
          </View>
          <Input label="Código del QR" value={qrCode} onChangeText={setQrCode} placeholder="Escanea el sticker o escribe su código" autoCapitalize="none" />

          <Input label="Nombre o ubicación del aire" value={locationLabel} onChangeText={setLocationLabel} placeholder="Sala, Cocina, Cuarto principal..." />
          <View style={styles.suggestionRow}>
            {locationSuggestions.map((suggestion) => (
              <Button key={suggestion} compact label={suggestion} variant={locationLabel === suggestion ? 'primary' : 'secondary'} onPress={() => setLocationLabel(suggestion)} />
            ))}
          </View>

          <ChoiceGroup label="TIPO DE SISTEMA" options={SYSTEM_TYPES} value={systemType} onChange={setSystemType} />

          <View style={styles.formGrid}>
            <Input style={styles.field} label="Marca" value={brand} onChangeText={setBrand} placeholder="Adina, Gree, Carrier..." />
            <Input style={styles.field} keyboardType="number-pad" label="BTU" value={btu} onChangeText={(value) => setBtu(value.replace(/\D/g, ''))} placeholder="12000" />
          </View>

          <ChoiceGroup label="REFRIGERANTE" options={REFRIGERANTS} value={refrigerant} onChange={setRefrigerant} />
          <ChoiceGroup label="VOLTAJE" options={VOLTAGES} value={voltage} onChange={setVoltage} suffix=" V" />

          <Text style={styles.plateSectionTitle}>Fotografías de las placas</Text>
          <Text style={styles.plateSectionHelp}>No es necesario escribir modelo ni serial. La placa indoor es obligatoria. También toma la placa outdoor aunque esté desgastada o no sea completamente legible.</Text>
          <View style={styles.photoGrid}>
            <PlatePhotoCard
              title="Placa indoor"
              requiredText="Obligatoria"
              asset={indoorPlate}
              onCapture={() => void capturePhoto('indoor')}
            />
            <PlatePhotoCard
              title="Placa outdoor"
              requiredText="Obligatoria aunque no esté legible"
              asset={outdoorPlate}
              onCapture={() => void capturePhoto('outdoor')}
            />
          </View>

          <Button variant="success" label={working ? 'Registrando aire…' : 'Registrar aire'} disabled={working} onPress={() => void registerEquipment()} />
        </Card>
      ) : null}

      {selectedVisit && mode === 'search' ? (
        <Card>
          <SectionTitle
            title="Buscar aire registrado"
            subtitle={targetPendingUnit ? `Se asociará con ${targetPendingUnit.locationLabel}` : 'El aire seleccionado se agregará a la visita'}
            action={<Button compact label="Cerrar" variant="ghost" onPress={() => setMode('list')} />}
          />
          <View style={styles.mainActions}>
            <Button compact icon="▣" label={working ? 'Escaneando…' : 'Escanear QR'} disabled={working} onPress={() => void scanQr('lookup')} />
          </View>
          <View style={styles.lookupRow}>
            <Input style={{ flex: 1 }} label="Código del QR" value={lookupQr} onChangeText={setLookupQr} placeholder="Escanea o escribe el código" autoCapitalize="none" />
            <Button label="Buscar" variant="secondary" onPress={() => void findAndUseQr()} />
          </View>

          {selectedEquipment ? (
            <View style={styles.selectedEquipmentBox}>
              <Text style={styles.selectedEquipmentTitle}>{selectedEquipment.locationLabel}</Text>
              <Text style={styles.equipmentSummary}>{equipmentSummary(selectedEquipment)}</Text>
              <Text style={styles.selectedEquipmentMeta}>{selectedEquipment.systemType} · QR {shortEquipmentQrCode(selectedEquipment.qrCode)}</Text>
              <Button variant="success" label={targetPendingUnit ? `Asociar a ${targetPendingUnit.locationLabel}` : 'Agregar a esta visita'} disabled={working} onPress={() => void attachExistingEquipment(selectedEquipment)} />
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>AIRES REGISTRADOS PARA ESTE CLIENTE</Text>
          {clientEquipment.length ? clientEquipment.map((equipment) => (
            <Pressable key={equipment.id} onPress={() => setSelectedEquipmentId(equipment.id)} style={[styles.row, equipment.id === selectedEquipmentId && styles.rowActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{equipment.locationLabel}</Text>
                <Text style={styles.equipmentSummary}>{equipmentSummary(equipment)}</Text>
                <Text style={styles.rowMeta}>{equipment.systemType} · QR {shortEquipmentQrCode(equipment.qrCode, 24)}</Text>
              </View>
              <Pill label={equipment.active ? 'Activo' : 'Inactivo'} tone={equipment.active ? 'success' : 'neutral'} />
            </Pressable>
          )) : <EmptyState icon="❄" title="Sin equipos registrados" message="Presiona Añadir para registrar el primer aire de este cliente." />}
        </Card>
      ) : null}

      <View style={styles.messageBox}>
        <Text style={styles.messageTitle}>Resultado de la prueba</Text>
        <Text style={styles.messageText}>{message}</Text>
        <Text style={styles.syncText}>Última sincronización: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('es-AW') : loading ? 'Sincronizando…' : 'Pendiente'}</Text>
      </View>

      <View style={styles.footerActions}>
        <Button variant="secondary" label="Actualizar datos" disabled={loading} onPress={() => void refreshTechnicianPortalData()} />
        <Button variant="secondary" label="Volver a persistencia" onPress={returnToPersistence} />
      </View>
    </ScrollView>
  );
}

function ChoiceGroup({ label, options, value, onChange, suffix = '' }: { label: string; options: string[]; value: string; onChange: (value: string) => void; suffix?: string }) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.suggestionRow}>
        {options.map((option) => <Button key={option} compact label={`${option}${suffix}`} variant={value === option ? 'primary' : 'secondary'} onPress={() => onChange(option)} />)}
      </View>
    </View>
  );
}

function PlatePhotoCard({ title, requiredText, asset, onCapture }: { title: string; requiredText: string; asset?: CapturedAsset; onCapture: () => void }) {
  return (
    <View style={styles.photoCard}>
      <Text style={styles.photoTitle}>{title}</Text>
      <Text style={styles.photoRequired}>{requiredText}</Text>
      {asset ? <Image source={{ uri: asset.uri }} style={styles.photoPreview} resizeMode="cover" /> : <View style={styles.photoPlaceholder}><Text style={styles.photoPlaceholderIcon}>▧</Text><Text style={styles.photoPlaceholderText}>Sin fotografía</Text></View>}
      <Button compact label={asset ? 'Repetir foto' : 'Tomar foto'} variant="secondary" onPress={onCapture} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 90, backgroundColor: '#F7F9FC' },
  hero: { backgroundColor: colors.primary, borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#A9D1FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5 },
  copy: { color: '#D8E9FF', marginTop: 7, lineHeight: 19 },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 12, padding: 13 },
  errorText: { color: colors.danger, fontWeight: '800', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 7, backgroundColor: '#FFFFFF' },
  rowActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  code: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  rowTitle: { color: colors.text, fontWeight: '900', marginTop: 2, fontSize: 15 },
  equipmentSummary: { color: colors.text, fontSize: 11, fontWeight: '800', marginTop: 4 },
  rowMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 13 },
  qrBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 13, backgroundColor: colors.primaryLight, marginBottom: 12 },
  qrLabel: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  qrValue: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 4 },
  qrHelp: { color: colors.muted, fontSize: 9, marginTop: 5, lineHeight: 14 },
  fieldLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7, marginTop: 8, marginBottom: 7 },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  choiceGroup: { marginTop: 2 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flex: 1, minWidth: 210 },
  plateSectionTitle: { color: colors.text, fontWeight: '900', fontSize: 15, marginTop: 12 },
  plateSectionHelp: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 5, marginBottom: 10 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  photoCard: { flex: 1, minWidth: 230, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, gap: 8, backgroundColor: '#FAFBFD' },
  photoTitle: { color: colors.text, fontWeight: '900' },
  photoRequired: { color: colors.muted, fontSize: 9 },
  photoPreview: { width: '100%', height: 150, borderRadius: 10, backgroundColor: '#E8EBEF' },
  photoPlaceholder: { height: 120, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  photoPlaceholderIcon: { color: colors.primary, fontSize: 26 },
  photoPlaceholderText: { color: colors.muted, fontSize: 10, marginTop: 5 },
  lookupRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 },
  selectedEquipmentBox: { borderWidth: 1, borderColor: colors.primary, backgroundColor: '#F7FAFF', borderRadius: 13, padding: 14, gap: 7, marginVertical: 12 },
  selectedEquipmentTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  selectedEquipmentMeta: { color: colors.muted, fontSize: 10 },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14 },
  messageTitle: { color: colors.primaryDark, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  messageText: { color: colors.text, marginTop: 5, lineHeight: 18 },
  syncText: { color: colors.muted, fontSize: 9, marginTop: 8 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end' },
});
