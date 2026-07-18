import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TechnicianEvidenceReport } from '../components/TechnicianEvidenceReport';
import { Button, Card, EmptyState, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { usePwaStatus } from '../hooks/usePwaStatus';
import { useAppState } from '../state/TeamState';
import { colors } from '../theme';
import { AppointmentStatus, WorkOrder, WorkOrderEvidence } from '../types';
import { deleteWorkOrderEvidenceImage, uploadWorkOrderEvidenceImage } from '../services/firebaseStorage';
import { locationCoordinates, mapsMeUrl } from '../utils/location';

const DRAFT_PREFIX = '@demac-technician-draft-v1:';
const CLOSED_STATUSES: AppointmentStatus[] = ['Cancelada', 'Reprogramada'];

type StatusEvent = {
  id: string;
  fromStatus: AppointmentStatus;
  toStatus: AppointmentStatus;
  at: string;
  byUserId?: string;
  byStaffId?: string;
  byName: string;
  note?: string;
};

type OperationalWorkOrder = WorkOrder & {
  departedAt?: string;
  arrivedAt?: string;
  workStartedAt?: string;
  pendingAt?: string;
  completedAt?: string;
  pendingReason?: string;
  pendingAction?: string;
  requiresSecondVisit?: boolean;
  technicianDraftUpdatedAt?: string;
  statusHistory?: StatusEvent[];
};

type TechnicianDraft = {
  diagnosis: string;
  workPerformed: string;
  recommendation: string;
  receiverName: string;
  voltage: string;
  amperage: string;
  lowPressure: string;
  highPressure: string;
  returnTemp: string;
  supplyTemp: string;
  pendingReason: string;
  pendingAction: string;
  requiresSecondVisit: boolean;
};

const emptyDraft: TechnicianDraft = {
  diagnosis: '',
  workPerformed: '',
  recommendation: '',
  receiverName: '',
  voltage: '',
  amperage: '',
  lowPressure: '',
  highPressure: '',
  returnTemp: '',
  supplyTemp: '',
  pendingReason: '',
  pendingAction: '',
  requiresSecondVisit: false,
};

function arubaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Aruba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

function normalizeIdentity(value?: string) {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function digits(value?: string) {
  return (value ?? '').replace(/\D/g, '');
}

function draftFromOrder(order?: OperationalWorkOrder): TechnicianDraft {
  if (!order) return emptyDraft;
  return {
    diagnosis: order.diagnosis ?? '',
    workPerformed: order.workPerformed ?? '',
    recommendation: order.recommendation ?? '',
    receiverName: order.customerSignature ?? '',
    voltage: order.measurements?.voltage ?? '',
    amperage: order.measurements?.amperage ?? '',
    lowPressure: order.measurements?.lowPressure ?? '',
    highPressure: order.measurements?.highPressure ?? '',
    returnTemp: order.measurements?.returnTemp ?? '',
    supplyTemp: order.measurements?.supplyTemp ?? '',
    pendingReason: order.pendingReason ?? '',
    pendingAction: order.pendingAction ?? '',
    requiresSecondVisit: order.requiresSecondVisit ?? false,
  };
}

function timestampLabel(value?: string) {
  if (!value) return 'Pendiente';
  return new Intl.DateTimeFormat('es-AW', {
    timeZone: 'America/Aruba',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function TechnicianScreen() {
  const {
    currentUser,
    workOrders,
    clients,
    properties,
    services,
    equipment,
    staffProfiles,
    workOrderEvidence,
    updateWorkOrder,
    addWorkOrderEvidence,
    removeWorkOrderEvidence,
  } = useAppState();
  const pwa = usePwaStatus();
  const today = arubaDate();
  const tomorrow = arubaDate(1);

  const currentStaff = useMemo(() => {
    if (!currentUser) return undefined;
    const userName = normalizeIdentity(currentUser.name);
    const userPhone = digits(currentUser.phone);
    return staffProfiles.find((staff) =>
      staff.id === currentUser.id
      || (userName && normalizeIdentity(staff.name) === userName)
      || (userPhone && digits(staff.phone) === userPhone),
    );
  }, [currentUser, staffProfiles]);

  const technicianIds = useMemo(() => [currentUser?.id, currentStaff?.id].filter(Boolean) as string[], [currentUser?.id, currentStaff?.id]);
  const technicianView = currentUser?.role === 'technician';

  const jobs = useMemo(() => workOrders
    .filter((order) => [today, tomorrow].includes(order.date))
    .filter((order) => !CLOSED_STATUSES.includes(order.status))
    .filter((order) => !technicianView || order.technicianIds.some((id) => technicianIds.includes(id)))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
  [workOrders, today, tomorrow, technicianView, technicianIds]);

  const [selectedId, setSelectedId] = useState('');
  const selected = workOrders.find((order) => order.id === selectedId) as OperationalWorkOrder | undefined;
  const client = clients.find((item) => item.id === selected?.clientId);
  const property = properties.find((item) => item.id === selected?.propertyId);
  const service = services.find((item) => item.id === selected?.serviceId);
  const unit = equipment.find((item) => item.id === selected?.equipmentId);
  const location = selected?.locationSnapshot ?? property?.location;
  const arrivalContact = property?.contacts?.find((contact) => contact.active && contact.arrivalContact)
    ?? property?.contacts?.find((contact) => contact.active);

  const [draft, setDraft] = useState<TechnicianDraft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [formMessage, setFormMessage] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!jobs.length) {
      setSelectedId('');
      return;
    }
    if (!selectedId || !jobs.some((job) => job.id === selectedId)) setSelectedId(jobs[0].id);
  }, [jobs, selectedId]);

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    setFormMessage('');
    if (!selected) {
      setDraft(emptyDraft);
      return undefined;
    }
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(`${DRAFT_PREFIX}${selected.id}`);
        const localDraft = stored ? JSON.parse(stored) as Partial<TechnicianDraft> : undefined;
        if (active) setDraft({ ...draftFromOrder(selected), ...localDraft });
      } catch {
        if (active) setDraft(draftFromOrder(selected));
      } finally {
        if (active) {
          setDraftReady(true);
          setDraftState('idle');
        }
      }
    })();
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!selected || !draftReady) return undefined;
    setDraftState('saving');
    const timer = setTimeout(() => {
      AsyncStorage.setItem(`${DRAFT_PREFIX}${selected.id}`, JSON.stringify(draft))
        .then(() => setDraftState('saved'))
        .catch(() => setDraftState('error'));
    }, 550);
    return () => clearTimeout(timer);
  }, [draft, draftReady, selected?.id]);

  const setField = <K extends keyof TechnicianDraft>(field: K, value: TechnicianDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const reportChanges = () => ({
    diagnosis: draft.diagnosis.trim(),
    workPerformed: draft.workPerformed.trim(),
    recommendation: draft.recommendation.trim(),
    customerSignature: draft.receiverName.trim(),
    measurements: {
      ...selected?.measurements,
      voltage: draft.voltage.trim(),
      amperage: draft.amperage.trim(),
      lowPressure: draft.lowPressure.trim(),
      highPressure: draft.highPressure.trim(),
      returnTemp: draft.returnTemp.trim(),
      supplyTemp: draft.supplyTemp.trim(),
    },
    technicianDraftUpdatedAt: new Date().toISOString(),
  });

  const statusChange = async (toStatus: AppointmentStatus, note?: string, extraChanges: Record<string, unknown> = {}) => {
    if (!selected || !currentUser) return false;
    if (!pwa.online && currentUser.authProvider === 'firebase') {
      setFormMessage('Sin conexión: el borrador está guardado en este teléfono, pero el cambio de estado se enviará cuando vuelvas a tener internet.');
      return false;
    }

    setWorking(true);
    setFormMessage('');
    const now = new Date().toISOString();
    const event: StatusEvent = {
      id: `status-${Date.now()}`,
      fromStatus: selected.status,
      toStatus,
      at: now,
      byUserId: currentUser.id,
      byStaffId: currentStaff?.id,
      byName: currentStaff?.name ?? currentUser.name,
      note,
    };
    const timestampFields: Record<string, unknown> = {};
    if (toStatus === 'En camino') timestampFields.departedAt = now;
    if (toStatus === 'En el sitio') timestampFields.arrivedAt = now;
    if (toStatus === 'En proceso') timestampFields.workStartedAt = now;
    if (toStatus === 'Pendiente') timestampFields.pendingAt = now;
    if (toStatus === 'Completada') timestampFields.completedAt = now;

    const result = await updateWorkOrder(selected.id, {
      ...extraChanges,
      status: toStatus,
      statusHistory: [...(selected.statusHistory ?? []), event],
      ...timestampFields,
    } as unknown as Partial<WorkOrder>);
    setWorking(false);
    if (!result.ok) {
      setFormMessage(result.message ?? 'No se pudo actualizar el trabajo.');
      return false;
    }
    setFormMessage(`Estado actualizado: ${toStatus}.`);
    return true;
  };

  const saveReport = async () => {
    if (!selected) return false;
    if (!pwa.online && currentUser?.authProvider === 'firebase') {
      setFormMessage('El borrador está guardado en este teléfono. Conéctate a internet para enviarlo a la oficina.');
      return false;
    }
    setWorking(true);
    const result = await updateWorkOrder(selected.id, reportChanges() as unknown as Partial<WorkOrder>);
    setWorking(false);
    setFormMessage(result.ok ? 'Borrador enviado y guardado para la oficina.' : result.message ?? 'No se pudo guardar el reporte.');
    return result.ok;
  };

  const complete = async () => {
    if (!selected) return;
    if (!draft.diagnosis.trim() || !draft.workPerformed.trim() || !draft.receiverName.trim()) {
      setFormMessage('Para completar debes registrar diagnóstico, trabajo realizado y nombre de quien recibió el trabajo.');
      return;
    }
    const changed = await statusChange('Completada', 'Reporte básico completado por el técnico.', reportChanges());
    if (changed) await AsyncStorage.removeItem(`${DRAFT_PREFIX}${selected.id}`);
  };

  const markPending = async () => {
    if (!selected) return;
    if (!draft.pendingReason.trim()) {
      setFormMessage('Escribe el motivo por el cual el trabajo queda pendiente.');
      return;
    }
    await statusChange('Pendiente', draft.pendingReason.trim(), {
      ...reportChanges(),
      pendingReason: draft.pendingReason.trim(),
      pendingAction: draft.pendingAction.trim(),
      requiresSecondVisit: draft.requiresSecondVisit,
    });
  };

  const addPhoto = async (camera: boolean) => {
    if (!selected || !currentUser) return;
    setPhotoMessage('');
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPhotoMessage('Debes autorizar el acceso para adjuntar evidencia.');
        return;
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.72 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.72 });
      if (result.canceled) return;

      setPhotoUploading(true);
      let uploaded = 0;
      for (const asset of result.assets) {
        const evidenceId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const stored = await uploadWorkOrderEvidenceImage({
          uri: asset.uri,
          workOrderId: selected.id,
          unitId: selected.equipmentId || 'general',
          evidenceId,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
        });
        const now = new Date().toISOString();
        const evidence: WorkOrderEvidence = {
          id: evidenceId,
          workOrderId: selected.id,
          equipmentId: selected.equipmentId,
          unitId: selected.equipmentId || 'general',
          section: 'general',
          itemKey: 'general-work-evidence',
          label: 'Evidencia general del trabajo',
          moment: 'during',
          ...stored,
          capturedAt: now,
          uploadedAt: now,
          uploadedByUserId: currentUser.id,
          uploadedByStaffId: currentStaff?.id,
          uploadedByName: currentStaff?.name ?? currentUser.name,
        };
        const saved = await addWorkOrderEvidence(evidence);
        if (!saved.ok) {
          await deleteWorkOrderEvidenceImage(stored.storagePath).catch(() => undefined);
          throw new Error(saved.message ?? 'No se pudo registrar la fotografía para la oficina.');
        }
        uploaded += 1;
      }
      setPhotoMessage(`${uploaded} foto${uploaded === 1 ? '' : 's'} subida${uploaded === 1 ? '' : 's'} correctamente. Ya está${uploaded === 1 ? '' : 'n'} disponible${uploaded === 1 ? '' : 's'} para la oficina.`);
    } catch (error) {
      setPhotoMessage(`No se pudo subir la evidencia: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPhotoUploading(false);
    }
  };

  const contactName = arrivalContact?.name ?? client?.name ?? 'Cliente';
  const contactPhone = arrivalContact?.phone || arrivalContact?.whatsapp || client?.phone || client?.whatsapp;
  const contactWhatsapp = arrivalContact?.whatsapp || arrivalContact?.phone || client?.whatsapp || client?.phone;
  const assignedNames = selected?.technicianIds
    .map((id) => staffProfiles.find((staff) => staff.id === id)?.name ?? id)
    .join(', ');
  const selectedEvidence = workOrderEvidence.filter((item) => item.workOrderId === selected?.id);
  const displayedPhotos = [
    ...(selected?.photos ?? []).map((downloadUrl, index) => ({ id: `legacy-${index}`, downloadUrl, label: 'Evidencia anterior' })),
    ...selectedEvidence,
  ];

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.mobileHero}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{technicianView ? 'APLICACIÓN DEL TÉCNICO' : 'VISTA OPERATIVA / SUPERVISIÓN'}</Text>
            <Text style={styles.heroTitle}>Hola, {(currentStaff?.name ?? currentUser?.name ?? 'Técnico').split(' ')[0]}</Text>
            <Text style={styles.heroCopy}>{jobs.length} trabajo{jobs.length === 1 ? '' : 's'} entre hoy y mañana.</Text>
          </View>
          <View style={[styles.connectionBadge, pwa.online ? styles.connectionOnline : styles.connectionOffline]}>
            <Text style={styles.connectionText}>{pwa.online ? '● En línea' : '● Sin conexión'}</Text>
          </View>
        </View>
        {pwa.canInstall ? <Button compact variant="secondary" label={pwa.installing ? 'Instalando…' : 'Instalar DEMAC en este teléfono'} disabled={pwa.installing} onPress={() => void pwa.install()} /> : null}
        {pwa.standalone ? <Text style={styles.installedText}>✓ DEMAC está abierta como aplicación instalada.</Text> : null}
        {!pwa.online ? <Text style={styles.offlineText}>Los formularios se guardan localmente. Los cambios de estado y envíos a oficina requieren conexión.</Text> : null}
      </View>

      {technicianView && !currentStaff ? (
        <View style={styles.warningBanner}><Text style={styles.warningTitle}>Perfil técnico no vinculado</Text><Text style={styles.warningText}>El sistema intentó relacionar tu usuario por ID, nombre y teléfono. Un supervisor debe confirmar que tu perfil de personal utiliza los mismos datos.</Text></View>
      ) : null}

      <View style={styles.columns}>
        <Card style={styles.jobsCard}>
          <SectionTitle title="Mis trabajos" subtitle={`${today} y ${tomorrow}`} />
          {jobs.length ? jobs.map((job) => {
            const jobClient = clients.find((item) => item.id === job.clientId);
            const jobService = services.find((item) => item.id === job.serviceId);
            return (
              <Pressable key={job.id} onPress={() => setSelectedId(job.id)} style={[styles.jobRow, selectedId === job.id && styles.jobRowActive]}>
                <View style={styles.jobTime}><Text style={styles.jobTimeText}>{job.time}</Text><Text style={styles.jobDate}>{job.date === today ? 'HOY' : 'MAÑANA'}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.jobClient}>{jobClient?.name ?? 'Cliente'}</Text><Text style={styles.jobService}>{jobService?.name ?? job.problem}</Text><Text style={styles.jobAddress} numberOfLines={1}>{job.address}</Text></View>
                <Pill label={job.status} tone={statusTone(job.status)} />
              </Pressable>
            );
          }) : <EmptyState icon="✅" title="Sin trabajos asignados" message="No hay órdenes para hoy o mañana asociadas a este usuario." />}
        </Card>

        {selected ? (
          <View style={styles.formColumn}>
            <Card>
              <View style={styles.detailTop}><View style={{ flex: 1 }}><Text style={styles.orderId}>{selected.id}</Text><Text style={styles.clientName}>{client?.name}</Text><Text style={styles.serviceName}>{service?.name}</Text></View><Pill label={selected.status} tone={statusTone(selected.status)} /></View>
              <Text style={styles.address}>{property?.name ? `${property.name} · ` : ''}{selected.address}</Text>
              {assignedNames ? <Text style={styles.assigned}>Equipo asignado: {assignedNames}</Text> : null}

              <View style={styles.contactBox}>
                <Text style={styles.contactTitle}>CONTACTO AL LLEGAR</Text>
                <Text style={styles.contactName}>{contactName}{arrivalContact?.role ? ` · ${arrivalContact.role}` : ''}</Text>
                <View style={styles.contactActions}>
                  <Button compact variant="secondary" label="Llamar" disabled={!digits(contactPhone)} onPress={() => void Linking.openURL(`tel:${digits(contactPhone)}`)} />
                  <Button compact variant="secondary" label="WhatsApp" disabled={!digits(contactWhatsapp)} onPress={() => void Linking.openURL(`https://wa.me/${digits(contactWhatsapp)}`)} />
                </View>
              </View>

              {location ? <View style={styles.locationBox}><Text style={styles.locationTitle}>UBICACIÓN DEL CLIENTE</Text><Text style={styles.locationText}>{location.address || location.name || locationCoordinates(location) || 'Enlace guardado'}</Text><View style={styles.locationActions}><Button compact label="Abrir en MAPS.ME" onPress={() => { const url = mapsMeUrl(location, client?.name ?? 'Cliente DEMAC'); if (url) void Linking.openURL(url); }} /><Button compact variant="secondary" label="Copiar coordenadas" disabled={!locationCoordinates(location)} onPress={() => void (globalThis as any).navigator?.clipboard?.writeText(locationCoordinates(location))} /></View></View> : null}
              {property?.landmark || property?.accessInstructions || property?.notes ? <View style={styles.accessBox}><Text style={styles.accessTitle}>ACCESO / REFERENCIA</Text><Text style={styles.accessText}>{[property.landmark, property.accessInstructions, property.notes].filter(Boolean).join(' · ')}</Text></View> : null}
              <View style={styles.problemBox}><Text style={styles.problemLabel}>TRABAJO REPORTADO</Text><Text style={styles.problemText}>{selected.problem}</Text></View>
              {unit ? <View style={styles.unitBox}><Text style={styles.unitTitle}>Equipo: {unit.brand} {unit.model}</Text><Text style={styles.unitMeta}>{unit.location} · {unit.btu.toLocaleString()} BTU · {unit.refrigerant} · S/N {unit.serial}</Text></View> : null}

              <View style={styles.progressRow}>
                <Button compact variant="secondary" label="En camino" disabled={working || ['En camino', 'En el sitio', 'En proceso', 'Completada'].includes(selected.status)} onPress={() => void statusChange('En camino')} />
                <Button compact variant="secondary" label="Llegué" disabled={working || ['En el sitio', 'En proceso', 'Completada'].includes(selected.status)} onPress={() => void statusChange('En el sitio')} />
                <Button compact label="Iniciar trabajo" disabled={working || ['En proceso', 'Completada'].includes(selected.status)} onPress={() => void statusChange('En proceso')} />
              </View>

              <View style={styles.timeline}>
                <TimelineItem label="En camino" value={timestampLabel(selected.departedAt)} />
                <TimelineItem label="Llegada" value={timestampLabel(selected.arrivedAt)} />
                <TimelineItem label="Inicio" value={timestampLabel(selected.workStartedAt)} />
                <TimelineItem label="Completado" value={timestampLabel(selected.completedAt)} />
              </View>
            </Card>

            <TechnicianEvidenceReport order={selected} currentStaff={currentStaff} />

            <Card>
              <SectionTitle title="Mediciones básicas" subtitle="Los protocolos específicos por servicio se añadirán en el próximo módulo." />
              <View style={styles.inputGrid}>
                <Input style={styles.gridInput} label="Voltaje" value={draft.voltage} onChangeText={(value) => setField('voltage', value)} placeholder="221 V" />
                <Input style={styles.gridInput} label="Amperaje" value={draft.amperage} onChangeText={(value) => setField('amperage', value)} placeholder="12.4 A" />
                <Input style={styles.gridInput} label="Presión baja" value={draft.lowPressure} onChangeText={(value) => setField('lowPressure', value)} placeholder="125 PSI" />
                <Input style={styles.gridInput} label="Presión alta" value={draft.highPressure} onChangeText={(value) => setField('highPressure', value)} placeholder="410 PSI" />
                <Input style={styles.gridInput} label="Temperatura retorno" value={draft.returnTemp} onChangeText={(value) => setField('returnTemp', value)} placeholder="27 °C" />
                <Input style={styles.gridInput} label="Temperatura suministro" value={draft.supplyTemp} onChangeText={(value) => setField('supplyTemp', value)} placeholder="14 °C" />
              </View>
            </Card>

            <Card>
              <SectionTitle title="Reporte básico del trabajo" subtitle="Se guarda automáticamente como borrador en este teléfono." />
              <DraftStatus state={draftState} />
              <Input label="Diagnóstico" multiline value={draft.diagnosis} onChangeText={(value) => setField('diagnosis', value)} placeholder="Describe la condición encontrada…" />
              <Input label="Trabajo realizado" multiline value={draft.workPerformed} onChangeText={(value) => setField('workPerformed', value)} placeholder="Describe las acciones realizadas…" />
              <Input label="Recomendaciones" multiline value={draft.recommendation} onChangeText={(value) => setField('recommendation', value)} placeholder="Recomendaciones para cliente u oficina…" />

              <Text style={styles.photoLabel}>Evidencia fotográfica estructurada</Text>
              <Text style={styles.helperText}>Las fotografías se toman desde el menú guiado por unidad y quedan clasificadas como Antes, Presiones, Switch, Durante, Después o Hallazgo.</Text>

              <Input label="Nombre de quien recibe el trabajo" value={draft.receiverName} onChangeText={(value) => setField('receiverName', value)} placeholder="Nombre completo" />
              <View style={styles.formActions}><Button variant="secondary" label={working ? 'Guardando…' : 'Guardar y enviar borrador'} disabled={working} onPress={() => void saveReport()} /><Button variant="success" label="Completar trabajo" disabled={working} onPress={() => void complete()} /></View>
            </Card>

            <Card>
              <SectionTitle title="Trabajo pendiente / segunda visita" subtitle="El motivo es obligatorio para evitar trabajos olvidados." />
              <Input label="Motivo pendiente" multiline value={draft.pendingReason} onChangeText={(value) => setField('pendingReason', value)} placeholder="Ej. Hace falta una tarjeta electrónica…" />
              <Input label="Acción que debe tomar la oficina" multiline value={draft.pendingAction} onChangeText={(value) => setField('pendingAction', value)} placeholder="Ej. Cotizar pieza, llamar al cliente, reservar segunda visita…" />
              <Pressable onPress={() => setField('requiresSecondVisit', !draft.requiresSecondVisit)} style={[styles.toggleRow, draft.requiresSecondVisit && styles.toggleRowActive]}><Text style={styles.toggleMark}>{draft.requiresSecondVisit ? '✓' : '○'}</Text><Text style={styles.toggleText}>Requiere una segunda visita</Text></Pressable>
              <Button variant="secondary" label="Dejar trabajo pendiente" disabled={working} onPress={() => void markPending()} />
            </Card>

            {formMessage ? <View style={styles.messageBox}><Text style={styles.messageText}>{formMessage}</Text></View> : null}

            {selected.statusHistory?.length ? <Card><SectionTitle title="Historial operativo" />{[...selected.statusHistory].reverse().map((event) => <View key={event.id} style={styles.historyRow}><View style={{ flex: 1 }}><Text style={styles.historyTitle}>{event.fromStatus} → {event.toStatus}</Text><Text style={styles.historyMeta}>{event.byName} · {timestampLabel(event.at)}</Text>{event.note ? <Text style={styles.historyNote}>{event.note}</Text> : null}</View></View>)}</Card> : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function TimelineItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.timelineItem}><Text style={styles.timelineLabel}>{label}</Text><Text style={styles.timelineValue}>{value}</Text></View>;
}

function DraftStatus({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  const text = state === 'saving' ? 'Guardando borrador…' : state === 'saved' ? '✓ Borrador guardado en este teléfono' : state === 'error' ? 'No se pudo guardar el borrador local' : 'Borrador local listo';
  return <Text style={[styles.draftStatus, state === 'error' && styles.draftError]}>{text}</Text>;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 110 },
  mobileHero: { backgroundColor: colors.primary, padding: 20, borderRadius: 18, gap: 12 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eyebrow: { color: '#A9D1FF', fontSize: 10, letterSpacing: 1.4, fontWeight: '900' },
  heroTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5 },
  heroCopy: { color: '#D8E9FF', marginTop: 6 },
  connectionBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  connectionOnline: { backgroundColor: '#DDF8E6' },
  connectionOffline: { backgroundColor: '#FFE2E2' },
  connectionText: { color: colors.text, fontWeight: '900', fontSize: 9 },
  installedText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  offlineText: { color: '#FFF3BF', fontSize: 10, lineHeight: 15 },
  warningBanner: { backgroundColor: '#FFF4D8', borderRadius: 12, padding: 14 },
  warningTitle: { color: colors.warning, fontWeight: '900' },
  warningText: { color: colors.text, marginTop: 4, fontSize: 11, lineHeight: 17 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 },
  jobsCard: { flex: 1, minWidth: 300, maxWidth: 470 },
  formColumn: { flex: 1.7, minWidth: 300, gap: 16 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, marginBottom: 5 },
  jobRowActive: { backgroundColor: colors.primaryLight },
  jobTime: { width: 58, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF3F8' },
  jobTimeText: { color: colors.text, fontWeight: '900', fontSize: 13 },
  jobDate: { color: colors.muted, fontSize: 8, marginTop: 2, fontWeight: '800' },
  jobClient: { color: colors.text, fontWeight: '900', fontSize: 13 },
  jobService: { color: colors.primary, fontWeight: '700', fontSize: 10, marginTop: 3 },
  jobAddress: { color: colors.muted, fontSize: 9, marginTop: 3 },
  detailTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  orderId: { color: colors.primary, fontWeight: '900', fontSize: 10, letterSpacing: 1 },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 21, marginTop: 4 },
  serviceName: { color: colors.muted, marginTop: 4, fontWeight: '700' },
  address: { color: colors.text, marginTop: 14, fontWeight: '700' },
  assigned: { color: colors.muted, marginTop: 5, fontSize: 10 },
  contactBox: { backgroundColor: '#F6F8FB', borderRadius: 12, padding: 13, marginTop: 12 },
  contactTitle: { color: colors.muted, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  contactName: { color: colors.text, fontWeight: '900', marginTop: 5 },
  contactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  locationBox: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 13, marginTop: 12 },
  locationTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  locationText: { color: colors.text, marginTop: 6, fontWeight: '700' },
  locationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  accessBox: { backgroundColor: '#F3F7F3', borderRadius: 12, padding: 13, marginTop: 12 },
  accessTitle: { color: '#3B6B45', fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  accessText: { color: colors.text, marginTop: 6, lineHeight: 18 },
  problemBox: { backgroundColor: colors.warningLight, borderRadius: 12, padding: 13, marginTop: 14 },
  problemLabel: { color: colors.warning, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  problemText: { color: colors.text, marginTop: 6, lineHeight: 19 },
  unitBox: { backgroundColor: '#F6F8FB', borderRadius: 12, padding: 13, marginTop: 12 },
  unitTitle: { color: colors.text, fontWeight: '900', fontSize: 12 },
  unitMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 15 },
  timeline: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  timelineItem: { flex: 1, minWidth: 105, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 9 },
  timelineLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  timelineValue: { color: colors.text, fontWeight: '800', marginTop: 4, fontSize: 10 },
  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridInput: { minWidth: 135, flex: 1 },
  draftStatus: { color: '#2D6A3D', fontSize: 10, fontWeight: '800', marginBottom: 10 },
  draftError: { color: colors.danger },
  photoLabel: { color: colors.text, fontWeight: '800', marginBottom: 8 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 9 },
  photo: { width: 86, height: 86, borderRadius: 11 },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  helperText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginBottom: 10 },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 12 },
  toggleRowActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  toggleMark: { color: colors.primary, fontWeight: '900', fontSize: 17 },
  toggleText: { color: colors.text, fontWeight: '800' },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 13 },
  messageText: { color: colors.primaryDark, fontWeight: '700', lineHeight: 18 },
  historyRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyTitle: { color: colors.text, fontWeight: '900' },
  historyMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  historyNote: { color: colors.text, fontSize: 10, marginTop: 5, lineHeight: 15 },
});
