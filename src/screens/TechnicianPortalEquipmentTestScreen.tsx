import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';
import { generateEquipmentQrCode, normalizeEquipmentQrCode } from '../features/technicianPortal/equipmentQr';
import { EquipmentComponent } from '../features/technicianPortal/contracts';
import { useAppState } from '../state/AppState';
import { RegisteredEquipmentSystem, useTechnicianPortalState } from '../state/TechnicianPortalState';
import { colors } from '../theme';

const SYSTEM_TYPES = ['Split wall mounted', 'Cassette', 'Floor ceiling', 'Central', 'VRF indoor', 'Otro'];

function clean(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}

function numeric(value: string) {
  const parsed = Number(value.replace(/\D/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function TechnicianPortalEquipmentTestScreen() {
  const { clients, properties, workOrders, currentUser } = useAppState();
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
  const [lookupQr, setLookupQr] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Selecciona una visita preparada para registrar o asociar un aire acondicionado.');

  const [qrCode, setQrCode] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [systemType, setSystemType] = useState('Split wall mounted');
  const [brand, setBrand] = useState('');
  const [btu, setBtu] = useState('');
  const [refrigerant, setRefrigerant] = useState('');
  const [voltage, setVoltage] = useState('220');
  const [indoorModel, setIndoorModel] = useState('');
  const [indoorSerial, setIndoorSerial] = useState('');
  const [outdoorModel, setOutdoorModel] = useState('');
  const [outdoorSerial, setOutdoorSerial] = useState('');

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
  const clientEquipment = equipmentSystems.filter((equipment) => equipment.clientId === selectedVisit?.clientId && (!selectedVisit?.propertyId || equipment.propertyId === selectedVisit.propertyId));
  const selectedEquipment = equipmentSystems.find((equipment) => equipment.id === selectedEquipmentId);

  useEffect(() => {
    if (selectedUnitId && !selectedUnits.some((unit) => unit.id === selectedUnitId)) setSelectedUnitId('');
  }, [selectedUnitId, selectedUnits]);

  function newQr() {
    const generated = generateEquipmentQrCode(equipmentSystems.map((equipment) => equipment.qrCode));
    setQrCode(generated);
    setMessage(`QR ${generated} generado. Registra el equipo antes de imprimir o colocar la etiqueta.`);
  }

  function components(): EquipmentComponent[] {
    const capacity = numeric(btu);
    const common = {
      brand: clean(brand),
      btu: capacity,
      refrigerant: clean(refrigerant),
      voltage: clean(voltage),
    };
    return [
      {
        id: `indoor-${Date.now().toString(36)}`,
        componentType: 'indoor',
        ...common,
        model: clean(indoorModel),
        serial: clean(indoorSerial),
      },
      {
        id: `outdoor-${Date.now().toString(36)}`,
        componentType: 'outdoor',
        ...common,
        model: clean(outdoorModel),
        serial: clean(outdoorSerial),
      },
    ];
  }

  function resetForm() {
    setQrCode('');
    setLocationLabel('');
    setBrand('');
    setBtu('');
    setRefrigerant('');
    setVoltage('220');
    setIndoorModel('');
    setIndoorSerial('');
    setOutdoorModel('');
    setOutdoorSerial('');
  }

  async function registerEquipment() {
    if (!selectedVisit || !selectedOrder) {
      setMessage('Primero selecciona una visita preparada.');
      return;
    }
    if (!locationLabel.trim()) {
      setMessage('Escribe el nombre o ubicación del aire, por ejemplo Sala o Cuarto principal.');
      return;
    }
    if (!qrCode.trim()) {
      setMessage('Genera o introduce un código QR antes de registrar el equipo.');
      return;
    }

    setWorking(true);
    const { result, equipment } = await registerEquipmentSystem({
      qrCode,
      clientId: selectedVisit.clientId,
      propertyId: selectedVisit.propertyId,
      locationLabel,
      systemType,
      components: components(),
      sourceWorkOrderId: selectedOrder.id,
      sourceVisitId: selectedVisit.id,
      condition: 'registered',
    });

    if (!result.ok || !equipment) {
      setWorking(false);
      setMessage(result.message ?? 'No se pudo registrar el aire acondicionado.');
      return;
    }

    let unit = selectedUnit;
    if (!unit) {
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
    } else {
      await attachEquipmentToVisitUnit(unit, equipment);
    }

    setSelectedEquipmentId(equipment.id);
    if (unit) setSelectedUnitId(unit.id);
    setWorking(false);
    setMessage(`${equipment.locationLabel} registrado con QR ${equipment.qrCode} y asociado a la visita.`);
    resetForm();
  }

  function findQr() {
    const normalized = normalizeEquipmentQrCode(lookupQr);
    const found = equipmentSystems.find((equipment) => normalizeEquipmentQrCode(equipment.qrCode) === normalized);
    if (!found) {
      setSelectedEquipmentId('');
      setMessage(`No se encontró un aire registrado con el QR ${normalized || lookupQr}.`);
      return;
    }
    setSelectedEquipmentId(found.id);
    setMessage(`${found.locationLabel} encontrado. Selecciona un aire de la visita y presiona Asociar.`);
  }

  async function attachSelectedEquipment() {
    if (!selectedVisit || !selectedOrder || !selectedEquipment) {
      setMessage('Selecciona una visita y un equipo registrado.');
      return;
    }
    if (selectedEquipment.clientId !== selectedVisit.clientId) {
      setMessage('Este QR pertenece a otro cliente y no puede asociarse a esta visita.');
      return;
    }

    setWorking(true);
    if (selectedUnit) {
      const result = await attachEquipmentToVisitUnit(selectedUnit, selectedEquipment);
      setWorking(false);
      setMessage(result.ok
        ? `${selectedEquipment.locationLabel} asociado a ${selectedUnit.locationLabel}.`
        : result.message ?? 'No se pudo asociar el equipo.');
      return;
    }

    const { result, unit } = await addVisitUnit({
      visitId: selectedVisit.id,
      workOrderId: selectedOrder.id,
      locationLabel: selectedEquipment.locationLabel,
      source: 'qr_scan',
      equipmentSystemId: selectedEquipment.id,
      addedOnSite: true,
      addedReason: 'Equipo localizado mediante QR durante la visita.',
    });
    setWorking(false);
    if (unit) setSelectedUnitId(unit.id);
    setMessage(result.ok
      ? `${selectedEquipment.locationLabel} agregado a la visita mediante QR.`
      : result.message ?? 'No se pudo agregar el equipo.');
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
          <Text style={styles.title}>Registro de equipos y QR</Text>
          <Text style={styles.copy}>Un QR representa el sistema completo. Indoor y outdoor quedan vinculados al mismo aire y al historial permanente del cliente.</Text>
        </View>
        <Pill label={currentUser?.authProvider === 'firebase' ? 'Firebase real' : 'Modo demo'} tone={currentUser?.authProvider === 'firebase' ? 'success' : 'warning'} />
      </View>

      {dataError ? <View style={styles.errorBox}><Text style={styles.errorText}>{dataError}</Text></View> : null}

      <Card>
        <SectionTitle title="1. Seleccionar visita preparada" subtitle="Usa una visita creada en la prueba de persistencia" />
        {eligibleVisits.length ? eligibleVisits.map((visit) => {
          const client = clients.find((item) => item.id === visit.clientId);
          const property = properties.find((item) => item.id === visit.propertyId);
          const active = visit.id === selectedVisitId;
          return (
            <Pressable key={visit.id} onPress={() => { setSelectedVisitId(visit.id); setSelectedUnitId(''); setSelectedEquipmentId(''); }} style={[styles.row, active && styles.rowActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.code}>{visit.id}</Text>
                <Text style={styles.rowTitle}>{client?.name ?? 'Cliente'}</Text>
                <Text style={styles.rowMeta}>{property?.name ?? property?.address ?? 'Propiedad'} · {visit.scheduledScopeSnapshot.serviceName ?? 'Trabajo programado'}</Text>
              </View>
              <Pill label={visit.status.replace(/_/g, ' ')} tone={active ? 'info' : 'neutral'} />
            </Pressable>
          );
        }) : <EmptyState icon="📋" title="Sin visitas preparadas" message="Abre primero la prueba de persistencia y prepara una visita." />}
      </Card>

      {selectedVisit ? (
        <Card>
          <SectionTitle title="2. Aire de esta visita" subtitle={`${selectedClient?.name ?? 'Cliente'} · ${selectedProperty?.name ?? selectedProperty?.address ?? selectedOrder?.address ?? 'Propiedad'}`} />
          <View style={styles.optionRow}>
            <Button compact label="Crear aire nuevo al registrar" variant={!selectedUnitId ? 'primary' : 'secondary'} onPress={() => setSelectedUnitId('')} />
          </View>
          {selectedUnits.map((unit) => (
            <Pressable key={unit.id} onPress={() => setSelectedUnitId(unit.id)} style={[styles.row, unit.id === selectedUnitId && styles.rowActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{unit.locationLabel}</Text>
                <Text style={styles.rowMeta}>{unit.equipmentSystemId ? 'Equipo vinculado' : 'Pendiente de QR'} · {unit.source.replace(/_/g, ' ')}</Text>
              </View>
              <Pill label={unit.equipmentSystemId ? 'Vinculado' : 'Seleccionar'} tone={unit.equipmentSystemId ? 'success' : 'neutral'} />
            </Pressable>
          ))}
        </Card>
      ) : null}

      {selectedVisit ? (
        <Card>
          <SectionTitle title="3. Registrar aire nuevo" subtitle="Datos mínimos para crear el historial permanente" />
          <View style={styles.qrBox}>
            <View style={{ flex: 1 }}>
              <Text style={styles.qrLabel}>CÓDIGO QR</Text>
              <Text style={styles.qrValue}>{qrCode || 'Aún no generado'}</Text>
            </View>
            <Button compact variant="secondary" label="Generar QR" onPress={newQr} />
          </View>
          <Input label="Código QR" value={qrCode} onChangeText={(value) => setQrCode(normalizeEquipmentQrCode(value))} placeholder="DEMAC-AC-XXXXXXXX" />
          <Input label="Nombre o ubicación" value={locationLabel} onChangeText={setLocationLabel} placeholder="Sala, Cocina, Cuarto principal..." />
          <Text style={styles.fieldLabel}>TIPO DE SISTEMA</Text>
          <View style={styles.optionRow}>
            {SYSTEM_TYPES.map((type) => <Button key={type} compact label={type} variant={systemType === type ? 'primary' : 'secondary'} onPress={() => setSystemType(type)} />)}
          </View>
          <View style={styles.formGrid}>
            <Input style={styles.field} label="Marca" value={brand} onChangeText={setBrand} placeholder="Adina, Gree, Carrier..." />
            <Input style={styles.field} keyboardType="number-pad" label="BTU" value={btu} onChangeText={(value) => setBtu(value.replace(/\D/g, ''))} placeholder="12000" />
            <Input style={styles.field} label="Refrigerante" value={refrigerant} onChangeText={setRefrigerant} placeholder="R32 / R410A" />
            <Input style={styles.field} label="Voltaje" value={voltage} onChangeText={setVoltage} placeholder="220" />
          </View>
          <Text style={styles.subheading}>Unidad interior</Text>
          <View style={styles.formGrid}>
            <Input style={styles.field} label="Modelo indoor" value={indoorModel} onChangeText={setIndoorModel} />
            <Input style={styles.field} label="Serial indoor" value={indoorSerial} onChangeText={setIndoorSerial} />
          </View>
          <Text style={styles.subheading}>Unidad exterior</Text>
          <View style={styles.formGrid}>
            <Input style={styles.field} label="Modelo outdoor" value={outdoorModel} onChangeText={setOutdoorModel} />
            <Input style={styles.field} label="Serial outdoor" value={outdoorSerial} onChangeText={setOutdoorSerial} />
          </View>
          <Button variant="success" label={working ? 'Guardando…' : selectedUnit ? `Registrar y asociar a ${selectedUnit.locationLabel}` : 'Registrar y agregar a la visita'} disabled={working} onPress={() => void registerEquipment()} />
        </Card>
      ) : null}

      {selectedVisit ? (
        <Card>
          <SectionTitle title="4. Buscar o leer un QR existente" subtitle="Durante esta prueba puedes escribir o pegar el código de la etiqueta" />
          <View style={styles.lookupRow}>
            <Input style={{ flex: 1 }} label="Código QR" value={lookupQr} onChangeText={(value) => setLookupQr(normalizeEquipmentQrCode(value))} placeholder="DEMAC-AC-XXXXXXXX" />
            <Button label="Buscar QR" variant="secondary" onPress={findQr} />
          </View>
          {selectedEquipment ? (
            <View style={styles.selectedEquipmentBox}>
              <Text style={styles.selectedEquipmentTitle}>{selectedEquipment.locationLabel}</Text>
              <Text style={styles.selectedEquipmentMeta}>{selectedEquipment.qrCode} · {selectedEquipment.systemType}</Text>
              <Text style={styles.selectedEquipmentMeta}>{selectedEquipment.components[0]?.brand ?? 'Marca pendiente'} · {selectedEquipment.components[0]?.btu ? `${selectedEquipment.components[0].btu} BTU` : 'BTU pendiente'}</Text>
              <Button variant="success" label={selectedUnit ? `Asociar a ${selectedUnit.locationLabel}` : 'Agregar este aire a la visita'} disabled={working} onPress={() => void attachSelectedEquipment()} />
            </View>
          ) : null}
          <Text style={styles.fieldLabel}>EQUIPOS REGISTRADOS PARA ESTE CLIENTE</Text>
          {clientEquipment.length ? clientEquipment.map((equipment) => (
            <Pressable key={equipment.id} onPress={() => setSelectedEquipmentId(equipment.id)} style={[styles.row, equipment.id === selectedEquipmentId && styles.rowActive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{equipment.locationLabel}</Text>
                <Text style={styles.rowMeta}>{equipment.qrCode} · {equipment.systemType}</Text>
              </View>
              <Pill label={equipment.active ? 'Activo' : 'Inactivo'} tone={equipment.active ? 'success' : 'neutral'} />
            </Pressable>
          )) : <EmptyState icon="❄" title="Sin equipos registrados" message="Registra el primer aire de este cliente usando el formulario anterior." />}
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
  rowTitle: { color: colors.text, fontWeight: '900', marginTop: 2 },
  rowMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  qrBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 13, backgroundColor: colors.primaryLight, marginBottom: 12 },
  qrLabel: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  qrValue: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  fieldLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7, marginTop: 8, marginBottom: 7 },
  subheading: { color: colors.text, fontWeight: '900', marginTop: 10 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flex: 1, minWidth: 210 },
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
