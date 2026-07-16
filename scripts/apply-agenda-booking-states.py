from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"Missing marker: {label}")
    return source.replace(old, new, 1)


def replace_between(source: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = source.find(start)
    if start_index < 0:
        raise RuntimeError(f"Missing start marker: {label}")
    end_index = source.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"Missing end marker: {label}")
    return source[:start_index] + replacement + source[end_index:]


# ---- Types -----------------------------------------------------------------
types_path = Path('src/types.ts')
types = types_path.read_text()
types = replace_once(
    types,
    "  | 'Solicitud recibida'\n  | 'Confirmada'",
    "  | 'Solicitud recibida'\n  | 'Reserva temporal'\n  | 'Confirmada'",
    'temporary appointment status',
)
types = replace_once(
    types,
    "export type SchedulingMode = 'fixed' | 'perUnit';\n\nexport interface WorkOrder {",
    """export type SchedulingMode = 'fixed' | 'perUnit';

export interface WorkOrderScheduleHistoryEntry {
  id: string;
  date: string;
  time: string;
  vanId: string;
  technicianIds: string[];
  scheduledSlots: number;
  status: 'Cancelada' | 'Reprogramada';
  clientId: string;
  propertyId?: string;
  address: string;
  zone?: string;
  problem: string;
  recordedAt: string;
}

export interface WorkOrder {""",
    'schedule history type',
)
types = replace_once(
    types,
    "  scheduledSlots?: number;\n  equipmentId?: string;",
    """  scheduledSlots?: number;
  whatsappNotificationsEnabled?: boolean;
  confirmedAt?: string;
  temporaryReservedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  scheduleHistory?: WorkOrderScheduleHistoryEntry[];
  equipmentId?: string;""",
    'work order booking fields',
)
types_path.write_text(types)


# ---- Shared status colors ---------------------------------------------------
ui_path = Path('src/components/UI.tsx')
ui = ui_path.read_text()
ui = replace_once(
    ui,
    "  if (['Cancelada', 'Vencida'].includes(status)) return 'danger';\n  if (['En proceso', 'En camino', 'En el sitio', 'Parcial'].includes(status)) return 'warning';",
    "  if (['Cancelada', 'Reprogramada', 'Vencida'].includes(status)) return 'danger';\n  if (['Reserva temporal', 'En proceso', 'En camino', 'En el sitio', 'Parcial'].includes(status)) return 'warning';",
    'booking status tones',
)
ui = replace_once(
    ui,
    "  if (['Pendiente', 'Reprogramada', 'Solicitud recibida'].includes(status)) return 'purple';",
    "  if (['Pendiente', 'Solicitud recibida'].includes(status)) return 'purple';",
    'remove reprogrammed purple tone',
)
ui_path.write_text(ui)


# ---- Work order filters -----------------------------------------------------
work_orders_path = Path('src/screens/WorkOrdersScreen.tsx')
work_orders = work_orders_path.read_text()
work_orders = replace_once(
    work_orders,
    "  const statuses = ['Todos', 'Solicitud recibida', 'Confirmada', 'Asignada', 'En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada'];",
    "  const statuses = ['Todos', 'Solicitud recibida', 'Reserva temporal', 'Confirmada', 'Asignada', 'En proceso', 'Pendiente', 'Completada', 'Reprogramada', 'Cancelada', 'Facturada', 'Pagada'];",
    'work order status filters',
)
work_orders_path.write_text(work_orders)


# ---- WhatsApp notification gating ------------------------------------------
notifications_path = Path('functions/appointmentNotifications.js')
notifications = notifications_path.read_text()
notifications = replace_once(
    notifications,
    'const NON_ACTIVE_STATUSES = new Set(["Cancelada", "Completada", "Facturada", "Pagada"]);',
    'const CONFIRMATION_INELIGIBLE_STATUSES = new Set(["Solicitud recibida", "Reserva temporal", "Cancelada", "Reprogramada", "Completada", "Facturada", "Pagada"]);',
    'confirmation ineligible statuses',
)
notifications = replace_once(
    notifications,
    "function activeAppointment(order) {\n  return order && !NON_ACTIVE_STATUSES.has(order.status);\n}",
    """function confirmedAppointment(order) {
  return order
    && !CONFIRMATION_INELIGIBLE_STATUSES.has(order.status)
    && order.whatsappNotificationsEnabled !== false;
}""",
    'confirmed appointment helper',
)
notifications = replace_once(
    notifications,
    """    const created = !beforeSnapshot?.exists;
    const changedFields = created ? CUSTOMER_VISIBLE_FIELDS : customerVisibleChanges(before, order);

    if (!created && changedFields.length === 0) return;
    if (!activeAppointment(order)) return;
""",
    """    const created = !beforeSnapshot?.exists;
    const changedFields = created ? CUSTOMER_VISIBLE_FIELDS : customerVisibleChanges(before, order);
    const becameConfirmed = !confirmedAppointment(before) && confirmedAppointment(order);

    if (!confirmedAppointment(order)) return;
    if (!created && !becameConfirmed && changedFields.length === 0) return;
""",
    'confirmation trigger eligibility',
)
notifications = replace_once(
    notifications,
    '      reason: created ? "appointment-created" : "appointment-updated",',
    '      reason: created ? "appointment-created" : becameConfirmed ? "appointment-confirmed" : "appointment-updated",',
    'confirmation queue reason',
)
notifications = replace_once(
    notifications,
    '        reason: created ? "appointment-created" : "appointment-updated",',
    '        reason: created ? "appointment-created" : becameConfirmed ? "appointment-confirmed" : "appointment-updated",',
    'confirmation metadata reason',
)
notifications = notifications.replace('if (!activeAppointment(order)) continue;', 'if (!confirmedAppointment(order)) continue;')
notifications_path.write_text(notifications)


# ---- Agenda ----------------------------------------------------------------
agenda_path = Path('src/screens/AgendaScreen.tsx')
agenda = agenda_path.read_text()
agenda = replace_once(
    agenda,
    "import { AppointmentStatus, Client, DailyVanAssignment, Property, PropertyType, ServiceType, StaffAbsence, StaffProfile, Van, WorkOrder } from '../types';",
    "import { AppointmentStatus, Client, DailyVanAssignment, Property, PropertyType, ServiceType, StaffAbsence, StaffProfile, Van, WorkOrder, WorkOrderScheduleHistoryEntry } from '../types';",
    'agenda history import',
)
agenda = replace_once(
    agenda,
    """function orderOccupiedSlots(order: WorkOrder, services: ServiceType[], halfDay: boolean) {
  const normalized = normalizeTime(order.time);
  const source = afternoonSlots.includes(normalized) ? afternoonSlots : bookingSlots(halfDay);
  const start = source.indexOf(normalized);
  if (start < 0) return [];
  return source.slice(start, start + orderSlotCount(order, services));
}
""",
    """function occupiedSlotsFor(time: string, slotCount: number, halfDay: boolean) {
  const normalized = normalizeTime(time);
  const source = afternoonSlots.includes(normalized) ? afternoonSlots : bookingSlots(halfDay);
  const start = source.indexOf(normalized);
  if (start < 0) return [];
  return source.slice(start, start + slotCount);
}

function orderOccupiedSlots(order: WorkOrder, services: ServiceType[], halfDay: boolean) {
  return occupiedSlotsFor(order.time, orderSlotCount(order, services), halfDay);
}
""",
    'generic occupied slots',
)
agenda = replace_once(
    agenda,
    """function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[], halfDay: boolean) {
  return orderOccupiedSlots(order, services, halfDay).includes(slot);
}

function toneForStatus(status: AppointmentStatus) {
""",
    """function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[], halfDay: boolean) {
  return orderOccupiedSlots(order, services, halfDay).includes(slot);
}

function orderBlocksCapacity(order: WorkOrder) {
  return !['Cancelada', 'Reprogramada'].includes(order.status);
}

type CancelledSlotRecord = {
  id: string;
  workOrderId: string;
  slot: string;
  status: 'Cancelada' | 'Reprogramada';
  clientId: string;
  propertyId?: string;
  address: string;
  zone?: string;
  problem: string;
  vanId: string;
  recordedAt?: string;
};

function scheduleHistoryEntry(order: WorkOrder, services: ServiceType[]): WorkOrderScheduleHistoryEntry {
  return {
    id: `history-${order.id}-${Date.now()}`,
    date: order.date,
    time: order.time,
    vanId: order.vanId,
    technicianIds: order.technicianIds,
    scheduledSlots: orderSlotCount(order, services),
    status: 'Reprogramada',
    clientId: order.clientId,
    propertyId: order.propertyId,
    address: order.address,
    zone: order.zone,
    problem: order.problem,
    recordedAt: new Date().toISOString(),
  };
}

function toneForStatus(status: AppointmentStatus) {
""",
    'agenda booking helpers',
)
agenda = replace_once(
    agenda,
    """  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');
""",
    """  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [reschedulingOrderId, setReschedulingOrderId] = useState<string | null>(null);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');
""",
    'agenda booking state',
)
agenda = replace_once(
    agenda,
    """  const selectedProperty = clientProperties.find((item) => item.id === propertyId);
  const selectedVan = agendaVans.find((item) => item.id === vanId);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const monthTitle = new Date(`${calendarMonth}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
""",
    """  const selectedProperty = clientProperties.find((item) => item.id === propertyId);
  const selectedVan = agendaVans.find((item) => item.id === vanId);
  const activeOrders = orders.filter(orderBlocksCapacity);
  const selectedOrder = activeOrders.find((order) => order.id === selectedOrderId) ?? activeOrders[0];
  const reschedulingOrder = workOrders.find((order) => order.id === reschedulingOrderId);
  const monthTitle = new Date(`${calendarMonth}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
""",
    'active selected order',
)
agenda = replace_once(
    agenda,
    """  const isHalfDay = (candidateVanId: string, date = selectedDate) => vanHasHalfDayOnDate(candidateVanId, date, vanHalfDaySchedules);
  const extendedDayLayout = agendaVans.some((van) => isHalfDay(van.id));

  const filteredClients = useMemo(() => {
""",
    """  const isHalfDay = (candidateVanId: string, date = selectedDate) => vanHasHalfDayOnDate(candidateVanId, date, vanHalfDaySchedules);
  const extendedDayLayout = agendaVans.some((van) => isHalfDay(van.id));
  const cancelledSlots = useMemo<CancelledSlotRecord[]>(() => {
    const records: CancelledSlotRecord[] = [];
    const pushRecord = (order: WorkOrder, data: WorkOrderScheduleHistoryEntry | WorkOrder) => {
      const resolvedVanId = resolveStoredVanId(data.vanId, agendaVans, legacyVans);
      const halfDay = isHalfDay(resolvedVanId, data.date);
      const slotCount = 'scheduledSlots' in data && Number(data.scheduledSlots) > 0
        ? Number(data.scheduledSlots)
        : orderSlotCount(order, services);
      occupiedSlotsFor(data.time, slotCount, halfDay).forEach((slot) => records.push({
        id: `${order.id}-${'recordedAt' in data ? data.recordedAt : order.updatedAt ?? order.createdAt ?? ''}-${slot}`,
        workOrderId: order.id,
        slot,
        status: data.status === 'Reprogramada' ? 'Reprogramada' : 'Cancelada',
        clientId: data.clientId,
        propertyId: data.propertyId,
        address: data.address,
        zone: data.zone,
        problem: data.problem,
        vanId: resolvedVanId,
        recordedAt: 'recordedAt' in data ? data.recordedAt : order.cancelledAt ?? order.updatedAt,
      }));
    };

    workOrders.forEach((order) => {
      if (order.date === selectedDate && !orderBlocksCapacity(order)) pushRecord(order, order);
      (order.scheduleHistory ?? []).filter((entry) => entry.date === selectedDate).forEach((entry) => pushRecord(order, entry));
    });
    return records.sort((a, b) => String(b.recordedAt ?? '').localeCompare(String(a.recordedAt ?? '')));
  }, [workOrders, selectedDate, agendaVans, legacyVans, services, vanHalfDaySchedules]);

  const filteredClients = useMemo(() => {
""",
    'cancelled slot history',
)
agenda = replace_between(
    agenda,
    "  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {",
    "  useEffect(() => {\n    if (!selectedVan) return;",
    """  const isAvailableFor = (candidateVan: AgendaVan, candidateTime: string, date: string, duration: number, ignoreOrderId?: string) => {
    if (calendarDateStatus(date, businessCalendarSettings, calendarClosures).closed) return false;
    if (!vanCanReceiveAppointments(candidateVan)) return false;
    const halfDay = isHalfDay(candidateVan.id, date);
    if (halfDay && afternoonSlots.includes(candidateTime)) return false;
    if (!halfDay && candidateTime === extraMorningSlot) return false;
    const candidateSchedule = bookingSlots(halfDay);
    const start = candidateSchedule.indexOf(candidateTime);
    if (start < 0 || start + duration > candidateSchedule.length) return false;
    const candidateSlots = candidateSchedule.slice(start, start + duration);
    return !workOrders.some(
      (order) =>
        order.id !== ignoreOrderId &&
        orderBlocksCapacity(order) &&
        order.date === date &&
        resolveStoredVanId(order.vanId, agendaVans, legacyVans) === candidateVan.id &&
        candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services, halfDay)),
    );
  };

  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) =>
    isAvailableFor(candidateVan, candidateTime, date, workHours, reschedulingOrderId ?? undefined);

""",
    'capacity validation',
)
agenda = replace_once(
    agenda,
    "  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules]);",
    "  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules, reschedulingOrderId]);",
    'availability effect dependencies',
)
agenda = replace_between(
    agenda,
    "  const openCreate = (candidateVanId?: string, candidateTime?: string) => {",
    "  const openQuickClient = () => {",
    """  const openCreate = (candidateVanId?: string, candidateTime?: string, cancelled?: CancelledSlotRecord) => {
    if (selectedDateClosed) return;
    clearDataError();
    setFormMessage('');
    setSuccessMessage('');
    setClientQuery('');
    setShowQuickClient(false);

    if (reschedulingOrder) {
      setClientId(reschedulingOrder.clientId);
      setPropertyId(reschedulingOrder.propertyId ?? '');
      setWorkDescriptionText(reschedulingOrder.problem);
      setWorkHours(orderSlotCount(reschedulingOrder, services));
      setSendWhatsApp(reschedulingOrder.whatsappNotificationsEnabled !== false);
    } else if (cancelled) {
      setClientId(cancelled.clientId);
      setPropertyId(cancelled.propertyId ?? '');
      setWorkDescriptionText(cancelled.problem);
      setWorkHours(1);
      setSendWhatsApp(true);
    }

    if (candidateVanId) setVanId(candidateVanId);
    if (candidateTime) setTime(candidateTime);
    setShowCreate(true);
  };

  const openQuickClient = () => {""",
    'open create flow',
)
agenda = replace_between(
    agenda,
    "  const createOrder = async () => {",
    "  return (\n",
    """  const saveAppointment = async (status: 'Reserva temporal' | 'Confirmada') => {
    const client = clients.find((item) => item.id === clientId);
    const van = agendaVans.find((item) => item.id === vanId);
    const description = workDescriptionText.trim();
    if (selectedDateClosed) return setFormMessage(`No se pueden crear citas: ${selectedCalendarStatus.reason}.`);
    if (!client) return setFormMessage('Primero selecciona o registra un cliente.');
    if (!description) return setFormMessage('Escribe la descripción del trabajo antes de guardar la cita.');
    if (!van) return setFormMessage('Selecciona una van.');
    if (!isAvailableFor(van, time, selectedDate, workHours, reschedulingOrderId ?? undefined)) return setFormMessage('Ese horario no tiene suficientes horas consecutivas para este trabajo.');

    const now = new Date().toISOString();
    const zone = selectedProperty?.zone ?? client.zone;
    setSaving(true);
    setFormMessage('');

    if (reschedulingOrder) {
      const history = scheduleHistoryEntry(reschedulingOrder, services);
      const result = await updateWorkOrder(reschedulingOrder.id, {
        clientId,
        propertyId: selectedProperty?.id,
        date: selectedDate,
        time,
        status,
        technicianIds: van.technicianIds,
        vanId,
        address: selectedProperty?.address ?? client.address,
        zone,
        problem: description,
        scheduledSlots: workHours,
        whatsappNotificationsEnabled: status === 'Confirmada' ? sendWhatsApp : false,
        confirmedAt: status === 'Confirmada' ? now : reschedulingOrder.confirmedAt,
        temporaryReservedAt: status === 'Reserva temporal' ? now : reschedulingOrder.temporaryReservedAt,
        scheduleHistory: [...(reschedulingOrder.scheduleHistory ?? []), history],
        updatedAt: now,
      });
      setSaving(false);
      if (!result.ok) return setFormMessage(result.message ?? 'No se pudo reprogramar la cita.');
      setSelectedOrderId(reschedulingOrder.id);
      setReschedulingOrderId(null);
    } else {
      const order: WorkOrder = {
        id: `WO-${selectedDate.replaceAll('-', '').slice(2)}-${Date.now().toString().slice(-6)}`,
        clientId,
        propertyId: selectedProperty?.id,
        serviceId: '',
        date: selectedDate,
        time,
        status,
        technicianIds: van.technicianIds,
        vanId,
        address: selectedProperty?.address ?? client.address,
        zone,
        problem: description,
        amount: 0,
        paid: 0,
        schedulingMode: 'fixed',
        scheduledSlots: workHours,
        whatsappNotificationsEnabled: status === 'Confirmada' ? sendWhatsApp : false,
        confirmedAt: status === 'Confirmada' ? now : undefined,
        temporaryReservedAt: status === 'Reserva temporal' ? now : undefined,
        createdAt: now,
        updatedAt: now,
      };
      const result = await addWorkOrder(order);
      setSaving(false);
      if (!result.ok) return setFormMessage(result.message ?? 'No se pudo guardar la cita.');
      setSelectedOrderId(order.id);
    }

    setWorkDescriptionText('');
    setWorkHours(1);
    setSendWhatsApp(true);
    setShowCreate(false);
  };

  const confirmTemporaryAppointment = async (order: WorkOrder, enableWhatsApp: boolean) => {
    const now = new Date().toISOString();
    await updateWorkOrder(order.id, {
      status: 'Confirmada',
      whatsappNotificationsEnabled: enableWhatsApp,
      confirmedAt: now,
      updatedAt: now,
    });
  };

  const cancelAppointment = async (order: WorkOrder) => {
    const now = new Date().toISOString();
    await updateWorkOrder(order.id, {
      status: 'Cancelada',
      whatsappNotificationsEnabled: false,
      cancelledAt: now,
      updatedAt: now,
    });
    if (selectedOrderId === order.id) setSelectedOrderId(null);
  };

  const startReschedule = (order: WorkOrder) => {
    setReschedulingOrderId(order.id);
    setSelectedDate(order.date);
    setCalendarMonth(monthStart(order.date));
    setShowCreate(false);
  };

  return (
""",
    'appointment save and state actions',
)
agenda = replace_once(
    agenda,
    """      <SectionTitle
        title="Agendar nueva cita"
        subtitle="Selecciona cliente, propiedad, duración, van y horario. Cada van tiene 3 horas en la mañana y 3 horas en la tarde."
        action={<Button label={selectedDateClosed ? 'Día cerrado' : 'Nueva cita'} icon={selectedDateClosed ? '🔒' : '＋'} disabled={selectedDateClosed} onPress={() => openCreate()} />}
      />

      {selectedDateClosed ?""",
    """      <SectionTitle
        title="Agendar nueva cita"
        subtitle="Selecciona cliente, propiedad, duración, van y horario. Cada van tiene 3 horas en la mañana y 3 horas en la tarde."
        action={<Button label={selectedDateClosed ? 'Día cerrado' : 'Nueva cita'} icon={selectedDateClosed ? '🔒' : '＋'} disabled={selectedDateClosed} onPress={() => openCreate()} />}
      />

      {reschedulingOrder ? <View style={styles.rescheduleBanner}><View style={{ flex: 1 }}><Text style={styles.rescheduleTitle}>Modo reprogramación activo</Text><Text style={styles.rescheduleText}>Selecciona el nuevo día y después haz clic en un cupo disponible. El horario anterior quedará registrado en rojo como cancelado y reprogramado.</Text></View><Button compact variant="secondary" label="Cancelar reprogramación" onPress={() => setReschedulingOrderId(null)} /></View> : null}

      {selectedDateClosed ?""",
    'rescheduling banner',
)
agenda = replace_once(
    agenda,
    "<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} halfDay={isHalfDay(van.id)} extendedLayout={extendedDayLayout} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>",
    "<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} halfDay={isHalfDay(van.id)} extendedLayout={extendedDayLayout} users={staffDirectory} orders={activeOrders} cancelledSlots={cancelledSlots} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} onCreateFromCancelled={(record) => openCreate(van.id, record.slot, record)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>",
    'agenda van columns',
)
agenda = replace_once(
    agenda,
    '<View style={styles.legendBar}><Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text><Legend color="#EAF7E7" label="Disponible" /><Legend color="#EAF3FF" label="Ocupado" /><Legend color="#FDECEC" label="No disponible" /></View>',
    '<View style={styles.legendBar}><Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text><Legend color="#EAF7E7" label="Disponible" /><Legend color="#EAF3FF" label="Cita confirmada" /><Legend color="#FFF4D8" label="Reserva temporal" /><Legend color="#FDECEC" label="Cancelado y disponible" /><Legend color="#FDECEC" label="No disponible" /></View>',
    'agenda legend',
)
agenda = replace_once(
    agenda,
    '<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>',
    '<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} onConfirm={confirmTemporaryAppointment} onCancel={cancelAppointment} onReschedule={startReschedule} /></Card>',
    'appointment detail actions',
)
agenda = replace_once(
    agenda,
    "        title={showQuickClient ? 'Agregar cliente rápido' : 'Confirmar nueva cita'}",
    "        title={showQuickClient ? 'Agregar cliente rápido' : reschedulingOrder ? 'Reprogramar cita' : 'Confirmar nueva cita'}",
    'appointment modal title',
)
agenda = replace_once(
    agenda,
    """            <Text style={styles.stepLabel}>6</Text>
            <Input label="Descripción del trabajo" value={workDescriptionText} onChangeText={setWorkDescriptionText} multiline placeholder="Ej. Dos servicios estándar, diagnóstico de una unidad e instalación de otra. Agrega instrucciones de acceso, contacto, síntomas y cualquier detalle necesario…" />

            <View style={styles.summaryBox}>""",
    """            <Text style={styles.stepLabel}>6</Text>
            <Input label="Descripción del trabajo" value={workDescriptionText} onChangeText={setWorkDescriptionText} multiline placeholder="Ej. Dos servicios estándar, diagnóstico de una unidad e instalación de otra. Agrega instrucciones de acceso, contacto, síntomas y cualquier detalle necesario…" />

            <Text style={styles.fieldLabel}>Notificaciones al confirmar</Text>
            <View style={styles.optionWrap}><Option label="Enviar confirmación y recordatorio por WhatsApp" active={sendWhatsApp} onPress={() => setSendWhatsApp((value) => !value)} /></View>

            <View style={styles.summaryBox}>""",
    'WhatsApp option',
)
agenda = replace_once(
    agenda,
    '<View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowCreate(false)} /><Button label={saving ? \'Guardando…\' : \'Confirmar cita\'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void createOrder()} /></View>',
    '<View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowCreate(false)} /><Button variant="secondary" label={saving ? \'Guardando…\' : \'Reservar temporalmente\'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment(\'Reserva temporal\')} /><Button label={saving ? \'Guardando…\' : reschedulingOrder ? \'Guardar reprogramación\' : \'Confirmar cita\'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment(\'Confirmada\')} /></View>',
    'appointment action buttons',
)

new_components = """function VanColumn({ van, halfDay, extendedLayout, users, orders, cancelledSlots, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, onCreateFromCancelled, closedReason }: { van: AgendaVan; halfDay: boolean; extendedLayout: boolean; users: { id: string; name: string }[]; orders: WorkOrder[]; cancelledSlots: CancelledSlotRecord[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void; onCreateFromCancelled: (record: CancelledSlotRecord) => void; closedReason?: string }) {
  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';
  const unavailableReason = van.status === 'Mantenimiento' ? 'Mantenimiento' : van.status === 'Fuera de servicio' ? 'Fuera de servicio' : 'Sin personal';
  const displaySlots = extendedLayout ? extendedSlots : allSlots;
  const morningCapacity = halfDay ? 4 : 3;
  const usedMorning = (halfDay ? [...morningSlots, extraMorningSlot] : morningSlots).filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services, halfDay))).length;
  const usedAfternoon = afternoonSlots.filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services, halfDay))).length;
  const afternoonHeaderTop = extendedLayout ? EXTENDED_AFTERNOON_HEADER_TOP : REGULAR_AFTERNOON_HEADER_TOP;
  const scheduleHeight = extendedLayout ? EXTENDED_SCHEDULE_HEIGHT : REGULAR_SCHEDULE_HEIGHT;

  return (
    <View style={styles.vanColumn}>
      <View style={styles.vanColumnHeader}><Text style={styles.vanIcon}>🚐</Text><Text style={styles.vanTitle}>{van.name}</Text><Text style={styles.vanTechs}>{techNames} · {van.dispatchStatus}</Text></View>
      <View style={[styles.scheduleCanvas, { height: scheduleHeight }]}>
        <ScheduleHeader title="MAÑANA" used={usedMorning} capacity={morningCapacity} top={0} />
        {!extendedLayout ? <View style={[styles.lunchDivider, { top: GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) }]}><Text style={styles.lunchText}>PAUSA 12:00 - 13:00</Text></View> : null}
        <ScheduleHeader title="TARDE" used={usedAfternoon} capacity={3} top={afternoonHeaderTop} />
        {displaySlots.map((slot, index) => {
          const order = orders.find((item) => item.vanId === van.id && orderOccupiesSlot(item, slot, services, halfDay));
          const cancelled = cancelledSlots.find((item) => item.vanId === van.id && item.slot === slot);
          const top = scheduleSlotTop(index, extendedLayout);
          if (order) {
            const occupied = orderOccupiedSlots(order, services, halfDay);
            const start = displaySlots.indexOf(normalizeTime(order.time));
            const end = occupied.length ? displaySlots.indexOf(occupied[occupied.length - 1]) : start;
            if (start !== index) return null;
            const slots = orderSlotCount(order, services);
            const service = services.find((item) => item.id === order.serviceId);
            const client = clients.find((item) => item.id === order.clientId);
            const property = properties.find((item) => item.id === order.propertyId);
            const zone = order.zone ?? property?.zone ?? client?.zone ?? 'Zona no registrada';
            const crossesBreak = occupied.some((item) => morningSlots.includes(item)) && occupied.some((item) => afternoonSlots.includes(item));
            return (
              <Pressable key={order.id} onPress={() => onSelectOrder(order.id)} style={[styles.mergedAppointment, order.status === 'Reserva temporal' && styles.slotTemporary, selectedOrderId === order.id && styles.slotSelected, { top, height: scheduleBlockHeight(start, Math.max(start, end), extendedLayout) }]}>
                <View style={styles.slotTop}><Text style={styles.slotTime}>{scheduleRangeForOrder(order, services, halfDay)}</Text><Pill label={order.status} tone={toneForStatus(order.status)} /></View>
                <Text style={styles.clientName} numberOfLines={1}>{client?.name ?? 'Cliente'}</Text>
                <Text style={styles.addressLine} numberOfLines={2}>{order.address}</Text>
                <Text style={styles.zoneLine} numberOfLines={1}>{zone}</Text>
                <Text style={styles.serviceLine} numberOfLines={3}>{orderDescription(order, service)}</Text>
                <Text style={styles.cupoLine}>{slots} hora{slots !== 1 ? 's' : ''} · {slots} cupo{slots !== 1 ? 's' : ''}</Text>
                {crossesBreak ? <Text style={styles.breakIncluded}>Incluye la pausa de almuerzo</Text> : null}
              </Pressable>
            );
          }
          if (closedReason) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Cerrado</Text><Text style={styles.closedSlotReason} numberOfLines={2}>{closedReason}</Text></View>;
          if (!vanCanReceiveAppointments(van)) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{unavailableReason}</Text></View>;
          if (extendedLayout && slot === extraMorningSlot && !halfDay) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Preparación / almuerzo</Text></View>;
          if (halfDay && afternoonSlots.includes(slot)) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Tarde libre</Text></View>;
          if (cancelled) {
            const client = clients.find((item) => item.id === cancelled.clientId);
            return <Pressable key={cancelled.id} onPress={() => onCreateFromCancelled(cancelled)} style={[styles.absoluteSlot, styles.slotCancelledAvailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.cancelledTitle}>{cancelled.status === 'Reprogramada' ? 'Cancelada y reprogramada' : 'Cancelada'} · Disponible</Text><Text style={styles.cancelledClient} numberOfLines={1}>{client?.name ?? 'Cliente'}</Text><Text style={styles.cancelledDescription} numberOfLines={1}>{cancelled.problem}</Text><Text style={styles.addSlot}>＋</Text></Pressable>;
          }
          return <Pressable key={`${van.id}-${slot}`} onPress={() => onCreate(slot)} style={[styles.absoluteSlot, styles.slotAvailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.availableText}>Disponible</Text><Text style={styles.addSlot}>＋</Text></Pressable>;
        })}
      </View>
    </View>
  );
}

function ScheduleHeader({ title, used, capacity, top }: { title: string; used: number; capacity: number; top: number }) {
  return <View style={[styles.scheduleHeader, { top }]}><Text style={styles.groupTitle}>{title}</Text><Text style={[styles.cupos, used >= capacity && styles.cuposFull]}>{used}/{capacity} horas</Text></View>;
}

function AppointmentDetails({ order, halfDay, clients, properties, services, vans, users, onUpdate, onConfirm, onCancel, onReschedule }: { order?: WorkOrder; halfDay: boolean; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }>; onConfirm: (order: WorkOrder, enableWhatsApp: boolean) => Promise<void>; onCancel: (order: WorkOrder) => Promise<void>; onReschedule: (order: WorkOrder) => void }) {
  if (!order) return <View style={styles.emptyDetails}><Text style={styles.detailTitle}>Detalles de la cita</Text><Text style={styles.detailMuted}>Selecciona una cita para ver la información completa.</Text></View>;
  const client = clients.find((item) => item.id === order.clientId);
  const property = properties.find((item) => item.id === order.propertyId);
  const service = services.find((item) => item.id === order.serviceId);
  const van = vans.find((item) => item.id === order.vanId);
  const slots = orderSlotCount(order, services);
  const techNames = order.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';
  return <View><View style={styles.detailHeader}><Pill label={order.status} tone={toneForStatus(order.status)} /><Text style={styles.detailId}>ID: {order.id}</Text></View><Text style={styles.detailTitle}>{client?.name}</Text><Text style={styles.detailSubtitle}>{service?.name ?? 'Trabajo programado'}</Text><View style={styles.detailTabs}><Text style={styles.detailTabActive}>Detalles</Text><Text style={styles.detailTab}>Cliente</Text><Text style={styles.detailTab}>Notas</Text></View><DetailRow label="Fecha y hora" value={`${formatDate(order.date, true)} · ${scheduleRangeForOrder(order, services, halfDay)}`} /><DetailRow label="Duración" value={`${slots} hora${slots !== 1 ? 's' : ''}`} /><DetailRow label="Propiedad" value={property?.name} /><DetailRow label="Dirección" value={order.address} /><DetailRow label="Zona" value={order.zone ?? property?.zone ?? client?.zone} /><DetailRow label="Técnico asignado" value={techNames} /><DetailRow label="Van asignada" value={van?.name ?? 'Sin van'} /><DetailRow label="Descripción del trabajo" value={orderDescription(order, service)} />{order.airConditionerCount ? <DetailRow label="Cantidad de aires (cita anterior)" value={String(order.airConditionerCount)} /> : null}<View style={styles.detailActions}>{order.status === 'Reserva temporal' ? <><Button variant="success" label="Confirmar y enviar WhatsApp" onPress={() => void onConfirm(order, true)} /><Button variant="secondary" label="Confirmar sin WhatsApp" onPress={() => void onConfirm(order, false)} /></> : null}<Button variant="secondary" label="Reprogramar cita" onPress={() => onReschedule(order)} /><Button variant="danger" label="Cancelar cita" onPress={() => void onCancel(order)} />{order.status !== 'Reserva temporal' ? <Button label="Marcar completada" onPress={() => void onUpdate(order.id, { status: 'Completada', updatedAt: new Date().toISOString() })} /> : null}</View></View>;
}

"""
agenda = replace_between(
    agenda,
    'function VanColumn(',
    'function SearchRow(',
    new_components,
    'agenda slot and details components',
)
agenda = replace_once(
    agenda,
    "  closedText: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },",
    """  closedText: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },
  rescheduleBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#B9D7FF', backgroundColor: colors.infoLight, borderRadius: 10, padding: 14 },
  rescheduleTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  rescheduleText: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },""",
    'reschedule banner styles',
)
agenda = replace_once(
    agenda,
    """  slotAvailable: { borderColor: '#B9E4B3', backgroundColor: '#F4FBF2' },
  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
""",
    """  slotAvailable: { borderColor: '#B9E4B3', backgroundColor: '#F4FBF2' },
  slotTemporary: { borderColor: '#E5C15A', backgroundColor: '#FFF8E5' },
  slotCancelledAvailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
""",
    'booking slot styles',
)
agenda = replace_once(
    agenda,
    "  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 12, marginTop: 5 },",
    """  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 12, marginTop: 5 },
  cancelledTitle: { color: colors.danger, fontWeight: '900', fontSize: 10, marginTop: 4 },
  cancelledClient: { color: colors.text, fontWeight: '900', fontSize: 10, marginTop: 4, paddingRight: 18 },
  cancelledDescription: { color: colors.muted, fontSize: 8, marginTop: 3, paddingRight: 18 },""",
    'cancelled slot text styles',
)
agenda_path.write_text(agenda)

print('Agenda booking states applied successfully.')
