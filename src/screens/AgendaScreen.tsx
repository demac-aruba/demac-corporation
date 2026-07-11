import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { colors } from '../theme';
import { AppointmentStatus, Client, DailyVanAssignment, Property, PropertyType, ServiceType, StaffAbsence, StaffProfile, Van, WorkOrder } from '../types';

const morningSlots = ['08:30', '09:30', '10:30'];
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const SLOT_HEIGHT = 118;
const SLOT_GAP = 8;
const GROUP_HEADER_HEIGHT = 30;
const LUNCH_GAP = 44;
const AFTERNOON_START_GAP = 12;
const AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) + LUNCH_GAP;
const SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP + AFTERNOON_START_GAP;

type QuickClientForm = {
  name: string;
  company: string;
  phone: string;
  whatsapp: string;
  propertyName: string;
  propertyType: PropertyType;
  address: string;
  zone: string;
};

const emptyQuickClientForm: QuickClientForm = {
  name: '',
  company: '',
  phone: '',
  whatsapp: '',
  propertyName: 'Propiedad principal',
  propertyType: 'Casa',
  address: '',
  zone: '',
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(date: string, long = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(
    'es-ES',
    long
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' },
  );
}

function addDays(date: string, amount: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + amount);
  return localDateKey(next);
}

function serviceSlots(service?: ServiceType) {
  return Math.max(1, Math.ceil((service?.durationMinutes ?? 60) / 60));
}

function orderSlotCount(order: WorkOrder, services: ServiceType[]) {
  const stored = Number(order.scheduledSlots ?? 0);
  if (stored > 0) return Math.max(1, Math.min(allSlots.length, stored));
  return Math.max(1, Math.min(allSlots.length, serviceSlots(services.find((item) => item.id === order.serviceId))));
}

function normalizeTime(time: string) {
  if (time < '09:00') return '08:30';
  if (time >= '09:00' && time < '10:30') return '09:30';
  if (time >= '10:30' && time < '12:00') return '10:30';
  if (time >= '12:00' && time < '14:30') return '13:30';
  if (time >= '14:30' && time < '15:30') return '14:30';
  return '15:30';
}

function slotIndex(time: string) {
  return allSlots.indexOf(normalizeTime(time));
}

function slotEnd(slot: string) {
  const [hour, minute] = slot.split(':').map(Number);
  return `${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function slotLabel(slot: string) {
  return `${slot} - ${slotEnd(slot)}`;
}

function scheduleRange(startTime: string, slots: number) {
  const start = Math.max(0, slotIndex(startTime));
  const last = Math.min(allSlots.length - 1, start + Math.max(1, slots) - 1);
  return `${allSlots[start]} - ${slotEnd(allSlots[last])}`;
}

function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[]) {
  const start = slotIndex(order.time);
  const target = slotIndex(slot);
  if (start < 0 || target < 0) return false;
  return target >= start && target < start + orderSlotCount(order, services);
}

function toneForStatus(status: AppointmentStatus) {
  return statusTone(status);
}

function scheduleSlotTop(index: number) {
  const afternoonOffset = index >= morningSlots.length ? GROUP_HEADER_HEIGHT + LUNCH_GAP + AFTERNOON_START_GAP : 0;
  return GROUP_HEADER_HEIGHT + index * (SLOT_HEIGHT + SLOT_GAP) + afternoonOffset;
}

function scheduleBlockHeight(start: number, requestedSlots: number) {
  const slots = Math.max(1, Math.min(requestedSlots, allSlots.length - start));
  const crossesLunch = start < morningSlots.length && start + slots > morningSlots.length;
  return slots * SLOT_HEIGHT + (slots - 1) * SLOT_GAP + (crossesLunch ? GROUP_HEADER_HEIGHT + LUNCH_GAP + AFTERNOON_START_GAP : 0);
}

function orderDescription(order: WorkOrder, service?: ServiceType) {
  const text = order.problem?.trim();
  if (text && text !== 'Cita programada desde agenda.') return text;
  return service?.name ?? 'Trabajo programado';
}

type AgendaVan = Van & {
  dispatchStatus: DailyVanAssignment['status'];
  driverStaffId?: string;
  helperStaffId?: string;
};

function staffUnavailable(profile: StaffProfile | undefined, date: string, absences: StaffAbsence[]) {
  if (!profile || !profile.active || profile.availability === 'Inactivo') return true;
  const generallyUnavailable = profile.availability !== 'Disponible'
    && (!profile.unavailableFrom || date >= profile.unavailableFrom)
    && (!profile.unavailableUntil || date <= profile.unavailableUntil);
  return generallyUnavailable || absences.some((absence) =>
    absence.active
    && absence.staffId === profile.id
    && date >= absence.fromDate
    && date <= absence.toDate,
  );
}

function resolveAgendaAssignment(van: Van, date: string, profiles: StaffProfile[], assignments: DailyVanAssignment[], absences: StaffAbsence[]): DailyVanAssignment {
  const saved = assignments.find((item) => item.vanId === van.id && item.date === date);
  const driver = profiles.find((item) => item.id === (saved?.driverStaffId ?? van.responsibleStaffId));
  const helper = profiles.find((item) => item.id === (saved?.helperStaffId ?? van.regularHelperId));
  const driverStaffId = driver?.canDriveVan && !staffUnavailable(driver, date, absences) ? driver.id : undefined;
  const helperStaffId = !staffUnavailable(helper, date, absences) ? helper?.id : undefined;

  let status: DailyVanAssignment['status'];
  if (van.active === false || van.status === 'Fuera de servicio' || saved?.status === 'Fuera de servicio') status = 'Fuera de servicio';
  else if (van.status === 'Mantenimiento' || saved?.status === 'Mantenimiento') status = 'Mantenimiento';
  else if (!driverStaffId || saved?.status === 'Sin personal') status = 'Sin personal';
  else if (!helperStaffId || saved?.status === 'Trabajo liviano') status = 'Trabajo liviano';
  else status = 'Disponible';

  return {
    id: saved?.id ?? `${date}-${van.id}`,
    date,
    vanId: van.id,
    driverStaffId,
    helperStaffId,
    status,
    notes: saved?.notes,
    updatedAt: saved?.updatedAt,
  };
}

function vanCanReceiveAppointments(van: AgendaVan) {
  return van.active !== false
    && !!van.driverStaffId
    && !['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(van.status);
}

function normalizeVanName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function resolveStoredVanId(storedVanId: string, agendaVans: AgendaVan[], legacyVans: Van[]) {
  if (agendaVans.some((van) => van.id === storedVanId)) return storedVanId;

  const legacyIndex = legacyVans.findIndex((van) => van.id === storedVanId);
  const legacyVan = legacyIndex >= 0 ? legacyVans[legacyIndex] : undefined;
  if (legacyVan) {
    const matchingName = agendaVans.find((van) => normalizeVanName(van.name) === normalizeVanName(legacyVan.name));
    if (matchingName) return matchingName.id;
    if (agendaVans[legacyIndex]) return agendaVans[legacyIndex].id;
  }

  const number = storedVanId.match(/(\d+)$/)?.[1];
  if (number) {
    const matchingNumber = agendaVans.find((van) => normalizeVanName(van.name) === `van${number}`);
    if (matchingNumber) return matchingNumber.id;
  }

  return storedVanId;
}

export function AgendaScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1260;
  const {
    workOrders,
    clients,
    properties,
    services,
    vans: legacyVans,
    users: legacyUsers,
    addClient,
    addProperty,
    addWorkOrder,
    updateWorkOrder,
    dataError,
    dataLoading,
    refreshOperationalData,
    clearDataError,
  } = useAppState();
  const { vans: teamVans, staffProfiles, dailyVanAssignments, staffAbsences, teamLoading, teamDataError, refreshTeamData } = useTeamState();

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickClient, setShowQuickClient] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [quickClient, setQuickClient] = useState<QuickClientForm>(emptyQuickClientForm);
  const [quickClientSaving, setQuickClientSaving] = useState(false);
  const [quickClientMessage, setQuickClientMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [workHours, setWorkHours] = useState(1);
  const [workDescriptionText, setWorkDescriptionText] = useState('');
  const [vanId, setVanId] = useState(teamVans[0]?.id ?? legacyVans[0]?.id ?? '');
  const [time, setTime] = useState('08:30');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');

  const staffDirectory = useMemo(() => {
    const directory = new Map(legacyUsers.map((user) => [user.id, { id: user.id, name: user.name }]));
    staffProfiles.forEach((profile) => directory.set(profile.id, { id: profile.id, name: profile.name }));
    return Array.from(directory.values());
  }, [staffProfiles, legacyUsers]);

  const agendaVans = useMemo<AgendaVan[]>(() => {
    const sourceVans = teamVans.length ? teamVans : legacyVans;
    return sourceVans
      .filter((van) => van.active !== false)
      .slice(0, 4)
      .map((van) => {
        const assignment = resolveAgendaAssignment(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences);
        const technicianIds = [assignment.driverStaffId, assignment.helperStaffId].filter(Boolean) as string[];
        const status: Van['status'] = assignment.status === 'Mantenimiento'
          ? 'Mantenimiento'
          : assignment.status === 'Fuera de servicio'
            ? 'Fuera de servicio'
            : assignment.status === 'Sin personal' || !assignment.driverStaffId
              ? 'Sin personal'
              : van.status === 'En ruta' ? 'En ruta' : 'Disponible';
        return { ...van, technicianIds, status, dispatchStatus: assignment.status, driverStaffId: assignment.driverStaffId, helperStaffId: assignment.helperStaffId };
      });
  }, [teamVans, legacyVans, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences]);

  useEffect(() => {
    if (!agendaVans.length) {
      if (vanId) setVanId('');
      return;
    }
    if (!agendaVans.some((van) => van.id === vanId)) {
      setVanId(agendaVans.find(vanCanReceiveAppointments)?.id ?? agendaVans[0].id);
    }
  }, [agendaVans, vanId]);

  useEffect(() => {
    if (!clients.length) {
      setClientId('');
      setPropertyId('');
      return;
    }
    if (!clients.some((client) => client.id === clientId)) setClientId(clients[0].id);
  }, [clients, clientId]);

  useEffect(() => {
    const availableProperties = properties.filter((property) => property.clientId === clientId && property.active !== false);
    if (!availableProperties.some((property) => property.id === propertyId)) {
      setPropertyId(availableProperties[0]?.id ?? '');
    }
  }, [properties, clientId, propertyId]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, index) => addDays(selectedDate, index)), [selectedDate]);
  const orders = useMemo(
    () => workOrders
      .filter((order) => order.date === selectedDate)
      .map((order) => {
        const resolvedVanId = resolveStoredVanId(order.vanId, agendaVans, legacyVans);
        return resolvedVanId === order.vanId ? order : { ...order, vanId: resolvedVanId };
      })
      .sort((a, b) => a.time.localeCompare(b.time)),
    [workOrders, selectedDate, agendaVans, legacyVans],
  );
  const selectedClient = clients.find((item) => item.id === clientId);
  const clientProperties = properties.filter((item) => item.clientId === clientId && item.active !== false);
  const selectedProperty = clientProperties.find((item) => item.id === propertyId);
  const selectedVan = agendaVans.find((item) => item.id === vanId);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const monthTitle = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const combinedDataError = teamDataError ?? dataError;

  const filteredClients = useMemo(() => {
    const needle = clientQuery.trim().toLowerCase();
    const matches = clients.filter((client) => {
      const haystack = `${client.name} ${client.company ?? ''} ${client.phone} ${client.whatsapp} ${client.address} ${client.zone}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });
    if (needle) return matches.slice(0, 12);
    const selected = matches.find((client) => client.id === clientId);
    return selected ? [selected, ...matches.filter((client) => client.id !== selected.id).slice(0, 5)] : matches.slice(0, 6);
  }, [clients, clientQuery, clientId]);

  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {
    if (!vanCanReceiveAppointments(candidateVan)) return false;
    const start = slotIndex(candidateTime);
    if (start < 0 || start + workHours > allSlots.length) return false;
    const candidateSlots = allSlots.slice(start, start + workHours);
    return !workOrders.some(
      (order) =>
        order.date === date &&
        resolveStoredVanId(order.vanId, agendaVans, legacyVans) === candidateVan.id &&
        candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services)),
    );
  };

  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const firstAvailable = allSlots.find((slot) => isAvailable(selectedVan, slot));
    if (firstAvailable) setTime(firstAvailable);
  }, [workHours, vanId, selectedDate, workOrders, agendaVans]);

  const openCreate = (candidateVanId?: string, candidateTime?: string) => {
    clearDataError();
    setFormMessage('');
    setSuccessMessage('');
    setClientQuery('');
    setShowQuickClient(false);
    if (candidateVanId) setVanId(candidateVanId);
    if (candidateTime) setTime(candidateTime);
    setShowCreate(true);
  };

  const openQuickClient = () => {
    setQuickClient({ ...emptyQuickClientForm, name: clientQuery.trim() });
    setQuickClientMessage('');
    setFormMessage('');
    setSuccessMessage('');
    setShowQuickClient(true);
  };

  const saveQuickClient = async () => {
    const name = quickClient.name.trim();
    const company = quickClient.company.trim();
    const phone = quickClient.phone.trim();
    const whatsapp = quickClient.whatsapp.trim() || phone;
    const address = quickClient.address.trim();
    const zone = quickClient.zone.trim();
    const propertyName = quickClient.propertyName.trim() || 'Propiedad principal';

    if (!name) return setQuickClientMessage('Escribe el nombre completo del cliente o empresa.');
    if (!phone) return setQuickClientMessage('Escribe un número de teléfono.');
    if (!address) return setQuickClientMessage('Escribe la dirección de la propiedad.');
    if (!zone) return setQuickClientMessage('Escribe la zona de la propiedad.');

    const timestamp = Date.now();
    const now = new Date().toISOString();
    const newClient: Client = {
      id: `client-${timestamp}`,
      name,
      company: company || undefined,
      phone,
      whatsapp,
      address,
      zone,
      balance: 0,
      equipmentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const newProperty: Property = {
      id: `property-${timestamp}`,
      clientId: newClient.id,
      name: propertyName,
      type: quickClient.propertyType,
      address,
      zone,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    setQuickClientSaving(true);
    setQuickClientMessage('');
    const clientResult = await addClient(newClient);
    if (!clientResult.ok) {
      setQuickClientSaving(false);
      setQuickClientMessage(clientResult.message ?? 'No se pudo guardar el cliente.');
      return;
    }

    const propertyResult = await addProperty(newProperty);
    setQuickClientSaving(false);
    setClientId(newClient.id);
    setClientQuery('');

    if (!propertyResult.ok) {
      setPropertyId('');
      setShowQuickClient(false);
      setFormMessage(propertyResult.message ?? 'El cliente se creó, pero no se pudo guardar la propiedad. Se usará la dirección principal.');
      return;
    }

    setPropertyId(newProperty.id);
    setQuickClient(emptyQuickClientForm);
    setShowQuickClient(false);
    setSuccessMessage(`${newClient.name} y ${newProperty.name} fueron agregados y seleccionados.`);
  };

  const createOrder = async () => {
    const client = clients.find((item) => item.id === clientId);
    const van = agendaVans.find((item) => item.id === vanId);
    const description = workDescriptionText.trim();
    if (!client) return setFormMessage('Primero selecciona o registra un cliente.');
    if (!description) return setFormMessage('Escribe la descripción del trabajo antes de confirmar la cita.');
    if (!van) return setFormMessage('Selecciona una van.');
    if (!isAvailable(van, time)) return setFormMessage('Ese horario no tiene suficientes horas consecutivas para este trabajo.');

    const zone = selectedProperty?.zone ?? client.zone;
    const order: WorkOrder = {
      id: `WO-${selectedDate.replaceAll('-', '').slice(2)}-${Date.now().toString().slice(-6)}`,
      clientId,
      propertyId: selectedProperty?.id,
      serviceId: '',
      date: selectedDate,
      time,
      status: van.technicianIds.length ? 'Asignada' : 'Confirmada',
      technicianIds: van.technicianIds,
      vanId,
      address: selectedProperty?.address ?? client.address,
      zone,
      problem: description,
      amount: 0,
      paid: 0,
      schedulingMode: 'fixed',
      scheduledSlots: workHours,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setSaving(true);
    setFormMessage('');
    const result = await addWorkOrder(order);
    setSaving(false);
    if (!result.ok) {
      setFormMessage(result.message ?? 'No se pudo guardar la cita.');
      return;
    }

    setSelectedOrderId(order.id);
    setWorkDescriptionText('');
    setWorkHours(1);
    setShowCreate(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {combinedDataError ? (
        <View style={styles.errorBanner}>
          <View style={{ flex: 1 }}><Text style={styles.errorTitle}>No se pudieron guardar o cargar los datos</Text><Text style={styles.errorText}>{combinedDataError}</Text></View>
          <Button compact variant="secondary" label="Reintentar" onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData()])} />
        </View>
      ) : null}

      <SectionTitle
        title="Agendar nueva cita"
        subtitle="Selecciona cliente, propiedad, duración, van y horario. Cada van tiene 3 horas en la mañana y 3 horas en la tarde."
        action={<Button label="Nueva cita" icon="＋" onPress={() => openCreate()} />}
      />

      <Card>
        <View style={styles.topPlanner}>
          <View style={styles.topPlannerBlock}>
            <Text style={styles.fieldCaption}>Fecha seleccionada</Text>
            <Text style={styles.topPlannerTitle}>{formatDate(selectedDate, true)}</Text>
          </View>
          <View style={styles.serviceSelect}>
            <Text style={styles.serviceIcon}>◷</Text>
            <View style={{ flex: 1 }}><Text style={styles.fieldCaption}>Planificación flexible</Text><Text style={styles.serviceName}>Trabajo definido por horas</Text></View>
          </View>
          <View style={styles.durationBox}><Text style={styles.fieldCaption}>Duración seleccionada</Text><Text style={styles.durationValue}>{workHours} hora{workHours !== 1 ? 's' : ''}</Text></View>
        </View>
      </Card>

      <View style={[styles.layout, compact && styles.layoutCompact]}>
        <View style={styles.leftPanel}>
          <Card>
            <View style={styles.monthHeader}><Text style={styles.monthTitle}>{monthTitle}</Text><Text style={styles.monthNav}>‹  ›</Text></View>
            <View style={styles.calendarGrid}>{days.map((date) => {
              const active = date === selectedDate;
              const dateObj = new Date(`${date}T12:00:00`);
              return <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.calendarDay, active && styles.calendarDayActive]}><Text style={[styles.calendarWeekday, active && styles.calendarDayTextActive]}>{dateObj.toLocaleDateString('es', { weekday: 'short' }).slice(0, 2)}</Text><Text style={[styles.calendarNumber, active && styles.calendarDayTextActive]}>{dateObj.getDate()}</Text></Pressable>;
            })}</View>
          </Card>
          <Card><Text style={styles.sideTitle}>Filtros rápidos</Text><FilterRow label="Todas las citas" count={orders.length} active /><FilterRow label="Confirmadas" count={orders.filter((order) => order.status === 'Confirmada').length} /><FilterRow label="En proceso" count={orders.filter((order) => order.status === 'En proceso').length} /><FilterRow label="Pendientes" count={orders.filter((order) => ['Asignada', 'Pendiente'].includes(order.status)).length} /></Card>
          <Card><Text style={styles.sideTitle}>Equipo del día</Text>{agendaVans.map((van) => <TechnicianFilter key={van.id} van={van} users={staffDirectory} />)}</Card>
        </View>

        <Card style={styles.boardCard}>
          <View style={styles.boardHeader}>
            <Pressable onPress={() => setSelectedDate(addDays(selectedDate, -1))} style={styles.dateButton}><Text style={styles.dateButtonText}>← Día anterior</Text></Pressable>
            <View style={styles.boardDateCenter}><Text style={styles.boardDate}>{formatDate(selectedDate, true)}</Text><Text style={styles.workday}>Horario laboral: 8:00 AM - 5:00 PM | Pausa: 12:00 PM - 1:00 PM</Text></View>
            <Pressable onPress={() => setSelectedDate(addDays(selectedDate, 1))} style={styles.dateButton}><Text style={styles.dateButtonText}>Día siguiente →</Text></Pressable>
          </View>
          {dataLoading || teamLoading ? <Text style={styles.syncText}>Sincronizando agenda y equipo…</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} />)}</View>
          </ScrollView>
          <View style={styles.legendBar}><Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text><Legend color="#EAF7E7" label="Disponible" /><Legend color="#EAF3FF" label="Ocupado" /><Legend color="#FDECEC" label="No disponible" /></View>
        </Card>

        <Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>
      </View>

      <AppModal
        visible={showCreate}
        title={showQuickClient ? 'Agregar cliente rápido' : 'Confirmar nueva cita'}
        onClose={() => {
          if (showQuickClient) {
            if (!quickClientSaving) setShowQuickClient(false);
            return;
          }
          if (!saving) setShowCreate(false);
        }}
      >
        {showQuickClient ? (
          <ScrollView>
            <Text style={styles.modalIntro}>Registra el cliente y su primera propiedad sin salir de la agenda. Al guardar, quedarán seleccionados automáticamente en la cita.</Text>
            {quickClientMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{quickClientMessage}</Text></View> : null}
            <Input label="Nombre completo o empresa" value={quickClient.name} onChangeText={(name) => setQuickClient({ ...quickClient, name })} placeholder="Ej. María Pérez o Empresa ABC" />
            <Input label="Empresa (opcional)" value={quickClient.company} onChangeText={(company) => setQuickClient({ ...quickClient, company })} placeholder="Déjalo vacío si es cliente residencial" />
            <View style={styles.twoColumnFields}>
              <View style={styles.halfField}><Input label="Teléfono" value={quickClient.phone} onChangeText={(phone) => setQuickClient({ ...quickClient, phone })} keyboardType="phone-pad" /></View>
              <View style={styles.halfField}><Input label="WhatsApp" value={quickClient.whatsapp} onChangeText={(whatsapp) => setQuickClient({ ...quickClient, whatsapp })} keyboardType="phone-pad" placeholder="Si es igual, puede quedar vacío" /></View>
            </View>
            <Text style={styles.quickSectionTitle}>Primera propiedad / lugar de servicio</Text>
            <Input label="Nombre de la propiedad" value={quickClient.propertyName} onChangeText={(propertyName) => setQuickClient({ ...quickClient, propertyName })} placeholder="Ej. Casa principal, Apartamento 3B u Oficina" />
            <Text style={styles.quickFieldLabel}>Tipo de propiedad</Text>
            <View style={styles.optionWrap}>{propertyTypes.map((type) => <Option key={type} label={type} active={quickClient.propertyType === type} onPress={() => setQuickClient({ ...quickClient, propertyType: type })} />)}</View>
            <Input label="Dirección" value={quickClient.address} onChangeText={(address) => setQuickClient({ ...quickClient, address })} placeholder="Calle, número y referencia" />
            <Input label="Zona" value={quickClient.zone} onChangeText={(zone) => setQuickClient({ ...quickClient, zone })} placeholder="Ej. Oranjestad, Noord, Santa Cruz…" />
            <View style={styles.modalActions}>
              <Button variant="secondary" label="Volver a la cita" disabled={quickClientSaving} onPress={() => setShowQuickClient(false)} />
              <Button label={quickClientSaving ? 'Guardando…' : 'Guardar y seleccionar'} disabled={quickClientSaving} onPress={() => void saveQuickClient()} />
            </View>
          </ScrollView>
        ) : (
          <ScrollView>
            <Text style={styles.modalIntro}>Selecciona el cliente y la propiedad, define cuántas horas ocupará el trabajo y escribe toda la descripción necesaria.</Text>
            {!clients.length ? <View style={styles.infoBanner}><Text style={styles.infoBannerText}>Todavía no hay clientes. Usa “Añadir cliente nuevo” para registrar el primero sin salir de esta cita.</Text></View> : null}
            {formMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{formMessage}</Text></View> : null}
            {successMessage ? <View style={styles.successBanner}><Text style={styles.successBannerText}>{successMessage}</Text></View> : null}

            <Text style={styles.stepLabel}>1</Text><Text style={styles.fieldLabel}>Cliente</Text>
            <Input placeholder="Buscar por nombre, empresa, teléfono, dirección o zona…" value={clientQuery} onChangeText={setClientQuery} />
            <View style={styles.searchResults}>
              {filteredClients.map((client) => <SearchRow key={client.id} title={client.name} subtitle={`${client.company ? `${client.company} · ` : ''}${client.phone} · ${client.zone}`} active={clientId === client.id} onPress={() => { setClientId(client.id); setClientQuery(''); setSuccessMessage(''); }} />)}
              {clientQuery.trim() && !filteredClients.length ? <Text style={styles.noResults}>No encontramos clientes con esa búsqueda.</Text> : null}
              <Pressable onPress={openQuickClient} style={styles.addClientRow}>
                <View style={styles.addClientIcon}><Text style={styles.addClientIconText}>＋</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.addClientTitle}>Añadir cliente nuevo</Text><Text style={styles.addClientSubtitle}>{clientQuery.trim() ? `Crear “${clientQuery.trim()}” y registrar su propiedad` : 'Registrar cliente y propiedad rápidamente'}</Text></View>
                <Text style={styles.addClientArrow}>›</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Propiedad / lugar de servicio</Text>
            {clientProperties.length ? <View style={styles.optionWrap}>{clientProperties.map((property) => <Option key={property.id} label={`${property.name} · ${property.address} · ${property.zone}`} active={propertyId === property.id} onPress={() => setPropertyId(property.id)} />)}</View> : selectedClient ? <Text style={styles.fallbackText}>Se usará la dirección principal del cliente.</Text> : <Text style={styles.fallbackText}>Selecciona o registra un cliente para escoger la propiedad.</Text>}

            <Text style={styles.stepLabel}>2</Text><Text style={styles.fieldLabel}>Cómo calcular la duración</Text>
            <View style={styles.modeTabs}><View style={[styles.modeTab, styles.modeTabActive]}><Text style={[styles.modeTabText, styles.modeTabTextActive]}>Horas de trabajo</Text></View></View>

            <Text style={styles.stepLabel}>3</Text><Text style={styles.fieldLabel}>Cantidad de horas de trabajo</Text>
            <View style={styles.quantityPanel}>
              <View style={{ flex: 1 }}><Text style={styles.quantityTitle}>Tiempo total reservado</Text><Text style={styles.quantityHelp}>Selecciona de 1 a 6 horas. La agenda bloqueará automáticamente todo ese tiempo.</Text></View>
              <View style={styles.stepper}><Pressable disabled={workHours <= 1} onPress={() => setWorkHours((value) => Math.max(1, value - 1))} style={[styles.stepperButton, workHours <= 1 && styles.stepperDisabled]}><Text style={styles.stepperButtonText}>−</Text></Pressable><Text style={styles.stepperValue}>{workHours}</Text><Pressable disabled={workHours >= 6} onPress={() => setWorkHours((value) => Math.min(6, value + 1))} style={[styles.stepperButton, workHours >= 6 && styles.stepperDisabled]}><Text style={styles.stepperButtonText}>＋</Text></Pressable></View>
            </View>
            <View style={styles.durationPreview}><View><Text style={styles.previewLabel}>Duración</Text><Text style={styles.previewValue}>{workHours} hora{workHours !== 1 ? 's' : ''}</Text></View><View><Text style={styles.previewLabel}>Total a reservar</Text><Text style={styles.previewValue}>{workHours} cupo{workHours !== 1 ? 's' : ''}</Text></View><View><Text style={styles.previewLabel}>Modalidad</Text><Text style={styles.previewValue}>Trabajo flexible</Text></View></View>

            <Text style={styles.stepLabel}>4</Text><Text style={styles.fieldLabel}>Asignar a</Text>
            <View style={styles.optionWrap}>{agendaVans.map((van) => { const names = van.technicianIds.map((id) => staffDirectory.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); const disabled = !vanCanReceiveAppointments(van); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'} · ${van.dispatchStatus}`} active={vanId === van.id} disabled={disabled} onPress={() => setVanId(van.id)} />; })}</View>

            <Text style={styles.stepLabel}>5</Text><Text style={styles.fieldLabel}>Horario sugerido</Text>
            <View style={styles.optionWrap}>{allSlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>

            <Text style={styles.stepLabel}>6</Text>
            <Input label="Descripción del trabajo" value={workDescriptionText} onChangeText={setWorkDescriptionText} multiline placeholder="Ej. Dos servicios estándar, diagnóstico de una unidad e instalación de otra. Agrega instrucciones de acceso, contacto, síntomas y cualquier detalle necesario…" />

            <View style={styles.summaryBox}><Text style={styles.summaryTitle}>Resumen de la cita</Text><Text style={styles.summaryLine}>{selectedClient?.name ?? 'Sin cliente'} · {selectedProperty?.name ?? selectedClient?.address ?? 'Sin dirección'}</Text><Text style={styles.summaryLine}>{workHours} hora{workHours !== 1 ? 's' : ''} · {selectedVan?.name} · {formatDate(selectedDate)} · {time}</Text><Text style={styles.summaryLine} numberOfLines={2}>{workDescriptionText.trim() || 'Falta agregar la descripción del trabajo.'}</Text></View>
            <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowCreate(false)} /><Button label={saving ? 'Guardando…' : 'Confirmar cita'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void createOrder()} /></View>
          </ScrollView>
        )}
      </AppModal>
    </ScrollView>
  );
}

function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate }: { van: AgendaVan; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {
  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';
  const unavailableReason = van.status === 'Mantenimiento' ? 'Mantenimiento' : van.status === 'Fuera de servicio' ? 'Fuera de servicio' : 'Sin personal';
  const usedMorning = morningSlots.filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services))).length;
  const usedAfternoon = afternoonSlots.filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services))).length;

  return (
    <View style={styles.vanColumn}>
      <View style={styles.vanColumnHeader}><Text style={styles.vanIcon}>🚐</Text><Text style={styles.vanTitle}>{van.name}</Text><Text style={styles.vanTechs}>{techNames} · {van.dispatchStatus}</Text></View>
      <View style={[styles.scheduleCanvas, { height: SCHEDULE_HEIGHT }]}>
        <ScheduleHeader title="MAÑANA" used={usedMorning} top={0} />
        <View style={[styles.lunchDivider, { top: GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) }]}><Text style={styles.lunchText}>PAUSA 12:00 - 13:00</Text></View>
        <ScheduleHeader title="TARDE" used={usedAfternoon} top={AFTERNOON_HEADER_TOP} />
        {allSlots.map((slot, index) => {
          const order = orders.find((item) => item.vanId === van.id && orderOccupiesSlot(item, slot, services));
          const top = scheduleSlotTop(index);
          if (order) {
            const start = slotIndex(order.time);
            if (start !== index) return null;
            const slots = orderSlotCount(order, services);
            const service = services.find((item) => item.id === order.serviceId);
            const client = clients.find((item) => item.id === order.clientId);
            const property = properties.find((item) => item.id === order.propertyId);
            const zone = order.zone ?? property?.zone ?? client?.zone ?? 'Zona no registrada';
            return (
              <Pressable key={order.id} onPress={() => onSelectOrder(order.id)} style={[styles.mergedAppointment, selectedOrderId === order.id && styles.slotSelected, { top, height: scheduleBlockHeight(index, slots) }]}>
                <View style={styles.slotTop}><Text style={styles.slotTime}>{scheduleRange(order.time, slots)}</Text><Pill label={order.status} tone={toneForStatus(order.status)} /></View>
                <Text style={styles.clientName} numberOfLines={1}>{client?.name ?? 'Cliente'}</Text>
                <Text style={styles.addressLine} numberOfLines={2}>{order.address}</Text>
                <Text style={styles.zoneLine} numberOfLines={1}>{zone}</Text>
                <Text style={styles.serviceLine} numberOfLines={3}>{orderDescription(order, service)}</Text>
                <Text style={styles.cupoLine}>{slots} hora{slots !== 1 ? 's' : ''} · {slots} cupo{slots !== 1 ? 's' : ''}</Text>
                {index < morningSlots.length && index + slots > morningSlots.length ? <Text style={styles.breakIncluded}>Incluye la pausa de almuerzo</Text> : null}
              </Pressable>
            );
          }
          if (!vanCanReceiveAppointments(van)) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{unavailableReason}</Text></View>;
          return <Pressable key={`${van.id}-${slot}`} onPress={() => onCreate(slot)} style={[styles.absoluteSlot, styles.slotAvailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.availableText}>Disponible</Text><Text style={styles.addSlot}>＋</Text></Pressable>;
        })}
      </View>
    </View>
  );
}

function ScheduleHeader({ title, used, top }: { title: string; used: number; top: number }) {
  return <View style={[styles.scheduleHeader, { top }]}><Text style={styles.groupTitle}>{title}</Text><Text style={[styles.cupos, used >= 3 && styles.cuposFull]}>{used}/3 horas</Text></View>;
}

function AppointmentDetails({ order, clients, properties, services, vans, users, onUpdate }: { order?: WorkOrder; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }> }) {
  if (!order) return <View style={styles.emptyDetails}><Text style={styles.detailTitle}>Detalles de la cita</Text><Text style={styles.detailMuted}>Selecciona una cita para ver la información completa.</Text></View>;
  const client = clients.find((item) => item.id === order.clientId);
  const property = properties.find((item) => item.id === order.propertyId);
  const service = services.find((item) => item.id === order.serviceId);
  const van = vans.find((item) => item.id === order.vanId);
  const slots = orderSlotCount(order, services);
  const techNames = order.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';
  return <View><View style={styles.detailHeader}><Pill label={order.status} tone={toneForStatus(order.status)} /><Text style={styles.detailId}>ID: {order.id}</Text></View><Text style={styles.detailTitle}>{client?.name}</Text><Text style={styles.detailSubtitle}>{service?.name ?? 'Trabajo programado'}</Text><View style={styles.detailTabs}><Text style={styles.detailTabActive}>Detalles</Text><Text style={styles.detailTab}>Cliente</Text><Text style={styles.detailTab}>Notas</Text></View><DetailRow label="Fecha y hora" value={`${formatDate(order.date, true)} · ${scheduleRange(order.time, slots)}`} /><DetailRow label="Duración" value={`${slots} hora${slots !== 1 ? 's' : ''}`} /><DetailRow label="Propiedad" value={property?.name} /><DetailRow label="Dirección" value={order.address} /><DetailRow label="Zona" value={order.zone ?? property?.zone ?? client?.zone} /><DetailRow label="Técnico asignado" value={techNames} /><DetailRow label="Van asignada" value={van?.name ?? 'Sin van'} /><DetailRow label="Descripción del trabajo" value={orderDescription(order, service)} />{order.airConditionerCount ? <DetailRow label="Cantidad de aires (cita anterior)" value={String(order.airConditionerCount)} /> : null}<View style={styles.detailActions}><Button variant="secondary" label="Editar cita" onPress={() => {}} /><Button label="Marcar completada" onPress={() => void onUpdate(order.id, { status: 'Completada', updatedAt: new Date().toISOString() })} /></View></View>;
}

function SearchRow({ title, subtitle, active, onPress }: { title: string; subtitle: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.searchRow, active && styles.searchRowActive]}><View style={{ flex: 1 }}><Text style={[styles.searchRowTitle, active && styles.searchRowTitleActive]}>{title}</Text><Text style={styles.searchRowSubtitle} numberOfLines={1}>{subtitle}</Text></View>{active ? <Text style={styles.selectedMark}>✓</Text> : null}</Pressable>;
}

function DetailRow({ label, value }: { label: string; value?: string }) { return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || '—'}</Text></View>; }
function FilterRow({ label, count, active }: { label: string; count: number; active?: boolean }) { return <View style={[styles.filterRow, active && styles.filterRowActive]}><Text style={styles.filterDot}>●</Text><Text style={styles.filterLabel}>{label}</Text><Text style={styles.filterCount}>{count}</Text></View>; }
function TechnicianFilter({ van, users }: { van: AgendaVan; users: { id: string; name: string }[] }) { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo'; return <View style={styles.techFilter}><Text style={styles.checkBox}>{vanCanReceiveAppointments(van) ? '✓' : '!'}</Text><View><Text style={styles.techFilterVan}>{van.name}</Text><Text style={styles.techFilterName}>{names} · {van.dispatchStatus}</Text></View></View>; }
function Legend({ color, label }: { color: string; label: string }) { return <View style={styles.legendItem}><View style={[styles.legendColor, { backgroundColor: color }]} /><Text style={styles.legendLabel}>{label}</Text></View>; }
function Option({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.option, active && styles.optionActive, disabled && styles.optionDisabled]}><Text style={[styles.optionText, active && styles.optionTextActive, disabled && styles.optionTextDisabled]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  page: { padding: 26, gap: 18, paddingBottom: 96 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#F2B8B5', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 14 },
  errorTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  errorText: { color: colors.text, fontSize: 11, marginTop: 3 },
  topPlanner: { flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' },
  topPlannerBlock: { flex: 1, minWidth: 260 },
  fieldCaption: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  topPlannerTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 4, textTransform: 'capitalize' },
  serviceSelect: { minWidth: 270, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  serviceIcon: { color: colors.brandBlue, fontSize: 20 },
  serviceName: { color: colors.text, fontWeight: '800', marginTop: 2 },
  durationBox: { minWidth: 160, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 20 },
  durationValue: { color: colors.primary, fontWeight: '900', fontSize: 18, marginTop: 3 },
  layout: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  layoutCompact: { flexDirection: 'column' },
  leftPanel: { width: 250, gap: 14 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  monthTitle: { color: colors.text, fontWeight: '900', fontSize: 15, textTransform: 'capitalize' },
  monthNav: { color: colors.muted, fontSize: 17, fontWeight: '900' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  calendarDay: { width: 42, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  calendarDayActive: { backgroundColor: colors.primary },
  calendarWeekday: { color: colors.muted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  calendarNumber: { color: colors.text, fontWeight: '900', marginTop: 2 },
  calendarDayTextActive: { color: '#FFFFFF' },
  sideTitle: { color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 10 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 9, borderRadius: 8 },
  filterRowActive: { backgroundColor: '#F0F2F4' },
  filterDot: { color: colors.primary, fontSize: 10 },
  filterLabel: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '700' },
  filterCount: { color: colors.muted, backgroundColor: '#EEF0F2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontWeight: '800', fontSize: 10 },
  techFilter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkBox: { width: 18, height: 18, borderRadius: 5, overflow: 'hidden', textAlign: 'center', backgroundColor: colors.primary, color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  techFilterVan: { color: colors.text, fontWeight: '900', fontSize: 12 },
  techFilterName: { color: colors.muted, fontSize: 10, marginTop: 2 },
  boardCard: { flex: 1, minWidth: 0, padding: 0, overflow: 'hidden' },
  boardHeader: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderBottomWidth: 1, borderBottomColor: colors.border, flexWrap: 'wrap' },
  dateButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF' },
  dateButtonText: { color: colors.text, fontWeight: '800', fontSize: 12 },
  boardDateCenter: { flex: 1, minWidth: 290, alignItems: 'center' },
  boardDate: { color: colors.text, fontWeight: '900', fontSize: 15, textTransform: 'capitalize' },
  workday: { color: colors.muted, fontSize: 11, marginTop: 6, textAlign: 'center' },
  syncText: { color: colors.muted, fontSize: 11, paddingHorizontal: 16, paddingTop: 10 },
  boardGrid: { flexDirection: 'row', alignItems: 'stretch' },
  vanColumn: { width: 230, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: '#FFFFFF' },
  vanColumnHeader: { minHeight: 74, alignItems: 'center', justifyContent: 'center', gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: '#FBFCFD' },
  vanIcon: { fontSize: 20 },
  vanTitle: { color: colors.text, fontWeight: '900', fontSize: 15 },
  vanTechs: { color: colors.muted, fontSize: 10 },
  scheduleCanvas: { position: 'relative', backgroundColor: '#FFFFFF' },
  scheduleHeader: { position: 'absolute', left: 12, right: 12, height: GROUP_HEADER_HEIGHT, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 },
  groupTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  cupos: { color: colors.warning, backgroundColor: colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, fontSize: 9, fontWeight: '900' },
  cuposFull: { color: colors.danger, backgroundColor: colors.dangerLight },
  lunchDivider: { position: 'absolute', left: 12, right: 12, height: LUNCH_GAP, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#EEF0F2', zIndex: 1 },
  lunchText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  absoluteSlot: { position: 'absolute', left: 12, right: 12, height: SLOT_HEIGHT, borderRadius: 8, borderWidth: 1, padding: 10, justifyContent: 'center', zIndex: 1 },
  mergedAppointment: { position: 'absolute', left: 12, right: 12, borderRadius: 8, borderWidth: 1, borderColor: '#B9D7FF', backgroundColor: colors.infoLight, padding: 10, paddingTop: 12, justifyContent: 'flex-start', zIndex: 3, overflow: 'hidden' },
  slotAvailable: { borderColor: '#B9E4B3', backgroundColor: '#F4FBF2' },
  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
  slotTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, alignItems: 'center', minHeight: 18, marginBottom: 2 },
  slotTime: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  availableText: { color: colors.primary, fontWeight: '900', fontSize: 12, marginTop: 5 },
  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 12, marginTop: 5 },
  addSlot: { position: 'absolute', right: 10, bottom: 8, color: colors.primary, fontSize: 16, fontWeight: '900' },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 12, lineHeight: 16, minHeight: 16, marginTop: 5 },
  addressLine: { color: colors.text, fontSize: 9, marginTop: 3, lineHeight: 12 },
  zoneLine: { color: colors.primaryDark, fontSize: 9, fontWeight: '800', marginTop: 3 },
  serviceLine: { color: colors.text, fontSize: 9, marginTop: 4, lineHeight: 12 },
  cupoLine: { color: colors.muted, fontSize: 8, marginTop: 5 },
  breakIncluded: { color: colors.warning, fontSize: 8, fontWeight: '800', marginTop: 8 },
  legendBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 14, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' },
  legendTitle: { color: colors.text, fontWeight: '900', fontSize: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendColor: { width: 13, height: 13, borderRadius: 3, borderWidth: 1, borderColor: '#D1D5DB' },
  legendLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  detailPanel: { width: 330, minHeight: 560 },
  emptyDetails: { paddingVertical: 32 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  detailId: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  detailTitle: { color: colors.text, fontWeight: '900', fontSize: 20, marginBottom: 5 },
  detailSubtitle: { color: colors.text, fontSize: 13, marginBottom: 14 },
  detailMuted: { color: colors.muted, marginTop: 8, lineHeight: 19 },
  detailTabs: { flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 16 },
  detailTabActive: { color: colors.primary, fontWeight: '900', paddingBottom: 9, borderBottomWidth: 2, borderBottomColor: colors.primary },
  detailTab: { color: colors.muted, fontWeight: '700', paddingBottom: 9 },
  detailRow: { marginBottom: 16 },
  detailLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 5 },
  detailValue: { color: colors.text, fontSize: 13, lineHeight: 18 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  modalIntro: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 14 },
  stepLabel: { position: 'absolute', left: 0, marginTop: 1, width: 18, height: 18, borderRadius: 9, overflow: 'hidden', textAlign: 'center', backgroundColor: colors.primary, color: '#FFFFFF', fontSize: 10, fontWeight: '900', lineHeight: 18 },
  fieldLabel: { color: colors.text, fontWeight: '900', marginTop: 4, marginBottom: 8, paddingLeft: 24 },
  searchResults: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', marginTop: -6, marginBottom: 15 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#EEF0F2', backgroundColor: '#FFFFFF' },
  searchRowActive: { backgroundColor: colors.primaryLight },
  searchRowTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  searchRowTitleActive: { color: colors.primaryDark },
  searchRowSubtitle: { color: colors.muted, fontSize: 9, marginTop: 3 },
  selectedMark: { color: colors.primary, fontWeight: '900' },
  noResults: { color: colors.muted, fontSize: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: '#EEF0F2' },
  addClientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, paddingVertical: 11, backgroundColor: '#F5FBF3' },
  addClientIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  addClientIconText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', lineHeight: 20 },
  addClientTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 11 },
  addClientSubtitle: { color: colors.muted, fontSize: 9, marginTop: 2 },
  addClientArrow: { color: colors.primaryDark, fontSize: 22, fontWeight: '700' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 15 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#FFFFFF' },
  optionActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionDisabled: { backgroundColor: '#F4F5F7', borderColor: '#E2E5E9' },
  optionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  optionTextActive: { color: colors.primaryDark },
  optionTextDisabled: { color: '#A6ADB5' },
  fallbackText: { color: colors.muted, fontSize: 11, marginBottom: 15 },
  modeTabs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', marginBottom: 10 },
  modeTab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#FFFFFF' },
  modeTabActive: { backgroundColor: colors.primaryLight },
  modeTabText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  modeTabTextActive: { color: colors.primaryDark },
  quantityPanel: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 10 },
  quantityTitle: { color: colors.text, fontSize: 11, fontWeight: '900' },
  quantityHelp: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  stepperButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  stepperDisabled: { backgroundColor: '#F1F3F5' },
  stepperButtonText: { color: colors.primaryDark, fontSize: 17, fontWeight: '900' },
  stepperValue: { width: 36, textAlign: 'center', color: colors.text, fontWeight: '900' },
  durationPreview: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, backgroundColor: '#F4F5F7', borderRadius: 8, padding: 12, marginBottom: 15 },
  previewLabel: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  previewValue: { color: colors.text, fontSize: 11, fontWeight: '900', marginTop: 4 },
  formError: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  formErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  infoBanner: { backgroundColor: colors.infoLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  infoBannerText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  successBanner: { backgroundColor: colors.successLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  successBannerText: { color: colors.success, fontSize: 11, fontWeight: '800' },
  quickSectionTitle: { color: colors.text, fontWeight: '900', fontSize: 13, marginTop: 8, marginBottom: 10 },
  quickFieldLabel: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 8 },
  twoColumnFields: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  halfField: { flex: 1, minWidth: 210 },
  summaryBox: { backgroundColor: '#F4F5F7', borderRadius: 10, padding: 13, marginTop: 8 },
  summaryTitle: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 6 },
  summaryLine: { color: colors.muted, fontSize: 10, marginTop: 3 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15, flexWrap: 'wrap' },
});