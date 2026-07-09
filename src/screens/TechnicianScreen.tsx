import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { AppointmentStatus } from '../types';

export function TechnicianScreen() {
  const { currentUser, users, workOrders, clients, services, equipment, updateWorkOrder } = useAppState();
  const technicianId = currentUser?.role === 'technician' ? currentUser.id : 'u5';
  const technician = users.find((user) => user.id === technicianId);
  const jobs = useMemo(() => workOrders.filter((order) => order.technicianIds.includes(technicianId) && ['2026-07-08', '2026-07-09'].includes(order.date)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), [workOrders, technicianId]);
  const [selectedId, setSelectedId] = useState(jobs[0]?.id ?? '');
  const selected = workOrders.find((order) => order.id === selectedId);
  const client = clients.find((item) => item.id === selected?.clientId);
  const service = services.find((item) => item.id === selected?.serviceId);
  const unit = equipment.find((item) => item.id === selected?.equipmentId);
  const [diagnosis, setDiagnosis] = useState(selected?.diagnosis ?? '');
  const [workPerformed, setWorkPerformed] = useState(selected?.workPerformed ?? '');
  const [recommendation, setRecommendation] = useState(selected?.recommendation ?? '');
  const [signature, setSignature] = useState(selected?.customerSignature ?? '');
  const [voltage, setVoltage] = useState(selected?.measurements?.voltage ?? '');
  const [amperage, setAmperage] = useState(selected?.measurements?.amperage ?? '');
  const [lowPressure, setLowPressure] = useState(selected?.measurements?.lowPressure ?? '');
  const [highPressure, setHighPressure] = useState(selected?.measurements?.highPressure ?? '');

  const selectJob = (id: string) => {
    const job = workOrders.find((order) => order.id === id);
    setSelectedId(id);
    setDiagnosis(job?.diagnosis ?? '');
    setWorkPerformed(job?.workPerformed ?? '');
    setRecommendation(job?.recommendation ?? '');
    setSignature(job?.customerSignature ?? '');
    setVoltage(job?.measurements?.voltage ?? '');
    setAmperage(job?.measurements?.amperage ?? '');
    setLowPressure(job?.measurements?.lowPressure ?? '');
    setHighPressure(job?.measurements?.highPressure ?? '');
  };

  const progress = (status: AppointmentStatus) => selected && updateWorkOrder(selected.id, { status });

  const addPhoto = async () => {
    if (!selected) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.7 });
    if (!result.canceled) updateWorkOrder(selected.id, { photos: [...(selected.photos ?? []), ...result.assets.map((asset) => asset.uri)] });
  };

  const saveReport = () => {
    if (!selected) return;
    updateWorkOrder(selected.id, {
      diagnosis,
      workPerformed,
      recommendation,
      customerSignature: signature,
      measurements: { ...selected.measurements, voltage, amperage, lowPressure, highPressure },
    });
  };

  const complete = () => {
    if (!selected || !diagnosis.trim() || !workPerformed.trim() || !signature.trim()) return;
    saveReport();
    updateWorkOrder(selected.id, { status: 'Completada', diagnosis, workPerformed, recommendation, customerSignature: signature, measurements: { ...selected.measurements, voltage, amperage, lowPressure, highPressure } });
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.mobileHero}>
        <Text style={styles.eyebrow}>APLICACIÓN DEL TÉCNICO</Text>
        <Text style={styles.heroTitle}>Hola, {technician?.name.split(' ')[0]}</Text>
        <Text style={styles.heroCopy}>Tienes {jobs.length} trabajos asignados entre hoy y mañana.</Text>
      </View>

      <View style={styles.columns}>
        <Card style={styles.jobsCard}>
          <SectionTitle title="Mis trabajos" subtitle="Selecciona una orden para actualizarla." />
          {jobs.length ? jobs.map((job) => {
            const jobClient = clients.find((item) => item.id === job.clientId);
            const jobService = services.find((item) => item.id === job.serviceId);
            return (
              <Pressable key={job.id} onPress={() => selectJob(job.id)} style={[styles.jobRow, selectedId === job.id && styles.jobRowActive]}>
                <View style={styles.jobTime}><Text style={styles.jobTimeText}>{job.time}</Text><Text style={styles.jobDate}>{job.date.slice(5)}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.jobClient}>{jobClient?.name}</Text><Text style={styles.jobService}>{jobService?.name}</Text><Text style={styles.jobAddress} numberOfLines={1}>{job.address}</Text></View>
                <Pill label={job.status} tone={statusTone(job.status)} />
              </Pressable>
            );
          }) : <EmptyState icon="✅" title="Sin trabajos pendientes" message="No tienes órdenes asignadas." />}
        </Card>

        {selected ? (
          <View style={styles.formColumn}>
            <Card>
              <View style={styles.detailTop}><View style={{ flex: 1 }}><Text style={styles.orderId}>{selected.id}</Text><Text style={styles.clientName}>{client?.name}</Text><Text style={styles.serviceName}>{service?.name}</Text></View><Pill label={selected.status} tone={statusTone(selected.status)} /></View>
              <Text style={styles.address}>{selected.address}</Text>
              <View style={styles.problemBox}><Text style={styles.problemLabel}>PROBLEMA REPORTADO</Text><Text style={styles.problemText}>{selected.problem}</Text></View>
              {unit ? <View style={styles.unitBox}><Text style={styles.unitTitle}>Equipo: {unit.brand} {unit.model}</Text><Text style={styles.unitMeta}>{unit.location} · {unit.btu.toLocaleString()} BTU · {unit.refrigerant} · S/N {unit.serial}</Text></View> : null}
              <View style={styles.progressRow}>
                <Button compact variant="secondary" label="En camino" onPress={() => progress('En camino')} />
                <Button compact variant="secondary" label="Llegué" onPress={() => progress('En el sitio')} />
                <Button compact label="Iniciar trabajo" onPress={() => progress('En proceso')} />
              </View>
            </Card>

            <Card>
              <SectionTitle title="Mediciones" subtitle="Registra los valores relevantes para esta visita." />
              <View style={styles.inputGrid}>
                <Input style={styles.gridInput} label="Voltaje" value={voltage} onChangeText={setVoltage} placeholder="221 V" />
                <Input style={styles.gridInput} label="Amperaje" value={amperage} onChangeText={setAmperage} placeholder="12.4 A" />
                <Input style={styles.gridInput} label="Presión baja" value={lowPressure} onChangeText={setLowPressure} placeholder="125 PSI" />
                <Input style={styles.gridInput} label="Presión alta" value={highPressure} onChangeText={setHighPressure} placeholder="410 PSI" />
              </View>
            </Card>

            <Card>
              <SectionTitle title="Reporte del trabajo" />
              <Input label="Diagnóstico" multiline value={diagnosis} onChangeText={setDiagnosis} placeholder="Describe la causa encontrada…" />
              <Input label="Trabajo realizado" multiline value={workPerformed} onChangeText={setWorkPerformed} placeholder="Describe las acciones realizadas…" />
              <Input label="Recomendaciones" multiline value={recommendation} onChangeText={setRecommendation} placeholder="Recomendaciones para el cliente o para una segunda visita…" />
              <Text style={styles.photoLabel}>Fotografías ({selected.photos?.length ?? 0})</Text>
              <View style={styles.photoRow}>
                {(selected.photos ?? []).map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={styles.photo} />)}
                <Pressable onPress={addPhoto} style={styles.addPhoto}><Text style={styles.addPhotoIcon}>＋</Text><Text style={styles.addPhotoText}>Añadir fotos</Text></Pressable>
              </View>
              <Input label="Nombre y firma de conformidad del cliente" value={signature} onChangeText={setSignature} placeholder="Nombre completo del cliente" />
              <Text style={styles.consent}>Al completar este campo, el cliente confirma la recepción del trabajo descrito en este reporte DEMO.</Text>
              <View style={styles.formActions}><Button variant="secondary" label="Guardar borrador" onPress={saveReport} /><Button variant="success" label="Completar trabajo" onPress={complete} /></View>
            </Card>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, paddingBottom: 100 },
  mobileHero: { backgroundColor: colors.primary, padding: 22, borderRadius: 18 },
  eyebrow: { color: '#A9D1FF', fontSize: 10, letterSpacing: 1.4, fontWeight: '900' },
  heroTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5 },
  heroCopy: { color: '#D8E9FF', marginTop: 6 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 },
  jobsCard: { flex: 1, minWidth: 320, maxWidth: 470 },
  formColumn: { flex: 1.7, minWidth: 350, gap: 16 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, marginBottom: 5 },
  jobRowActive: { backgroundColor: colors.primaryLight },
  jobTime: { width: 53, height: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF3F8' },
  jobTimeText: { color: colors.text, fontWeight: '900', fontSize: 13 },
  jobDate: { color: colors.muted, fontSize: 9, marginTop: 2 },
  jobClient: { color: colors.text, fontWeight: '900', fontSize: 13 },
  jobService: { color: colors.primary, fontWeight: '700', fontSize: 10, marginTop: 3 },
  jobAddress: { color: colors.muted, fontSize: 9, marginTop: 3 },
  detailTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  orderId: { color: colors.primary, fontWeight: '900', fontSize: 10, letterSpacing: 1 },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 21, marginTop: 4 },
  serviceName: { color: colors.muted, marginTop: 4, fontWeight: '700' },
  address: { color: colors.text, marginTop: 14, fontWeight: '700' },
  problemBox: { backgroundColor: colors.warningLight, borderRadius: 12, padding: 13, marginTop: 14 },
  problemLabel: { color: colors.warning, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  problemText: { color: colors.text, marginTop: 6, lineHeight: 19 },
  unitBox: { backgroundColor: '#F6F8FB', borderRadius: 12, padding: 13, marginTop: 12 },
  unitTitle: { color: colors.text, fontWeight: '900', fontSize: 12 },
  unitMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 15 },
  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridInput: { minWidth: 150, flex: 1 },
  photoLabel: { color: colors.text, fontWeight: '800', marginBottom: 8 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 16 },
  photo: { width: 86, height: 86, borderRadius: 11 },
  addPhoto: { width: 96, height: 86, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  addPhotoIcon: { color: colors.primary, fontSize: 24, fontWeight: '500' },
  addPhotoText: { color: colors.primary, fontSize: 9, fontWeight: '900', marginTop: 2 },
  consent: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: -5, marginBottom: 14 },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
});
