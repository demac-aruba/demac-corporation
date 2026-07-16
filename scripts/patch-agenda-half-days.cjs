const fs = require('fs');

const path = 'src/screens/AgendaScreen.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Could not find ${label}`);
  source = source.replace(search, replacement);
}

function replaceSection(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not find section ${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceOnce(
  "import { useTeamState } from '../state/TeamState';\n",
  "import { useTeamState } from '../state/TeamState';\nimport { useVanHalfDayState, vanHasHalfDayOnDate } from '../state/VanHalfDayState';\n",
  'VanHalfDayState import',
);

replaceOnce(
String.raw`const morningSlots = ['08:30', '09:30', '10:30'];
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const SLOT_HEIGHT = 118;
const SLOT_GAP = 8;
const GROUP_HEADER_HEIGHT = 30;
const LUNCH_GAP = 44;
const AFTERNOON_START_GAP = 12;
const AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) + LUNCH_GAP;
const SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP + AFTERNOON_START_GAP;`,
String.raw`const morningSlots = ['08:30', '09:30', '10:30'];
const extraMorningSlot = '11:30';
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const displaySlots = [...morningSlots, extraMorningSlot, ...afternoonSlots];
const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const SLOT_HEIGHT = 118;
const SLOT_GAP = 8;
const GROUP_HEADER_HEIGHT = 30;
const TRANSITION_GAP = 44;
const AFTERNOON_START_GAP = 12;
const AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + (morningSlots.length + 1) * (SLOT_HEIGHT + SLOT_GAP) + TRANSITION_GAP;
const SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + displaySlots.length * SLOT_HEIGHT + (displaySlots.length - 1) * SLOT_GAP + TRANSITION_GAP + AFTERNOON_START_GAP;`,
  'agenda slot constants',
);

replaceSection(
  'function orderSlotCount(order: WorkOrder, services: ServiceType[]) {',
  'function toneForStatus(status: AppointmentStatus) {',
String.raw`function orderSlotCount(order: WorkOrder, services: ServiceType[]) {
  const stored = Number(order.scheduledSlots ?? 0);
  if (stored > 0) return Math.max(1, Math.min(allSlots.length, stored));
  return Math.max(1, Math.min(allSlots.length, serviceSlots(services.find((item) => item.id === order.serviceId))));
}

function normalizeTime(time: string) {
  if (time < '09:00') return '08:30';
  if (time >= '09:00' && time < '10:30') return '09:30';
  if (time >= '10:30' && time < '11:30') return '10:30';
  if (time >= '11:30' && time < '12:30') return extraMorningSlot;
  if (time >= '12:30' && time < '14:30') return '13:30';
  if (time >= '14:30' && time < '15:30') return '14:30';
  return '15:30';
}

function slotEnd(slot: string) {
  const [hour, minute] = slot.split(':').map(Number);
  return String(hour + 1).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function slotLabel(slot: string) {
  return slot + ' - ' + slotEnd(slot);
}

function bookingSlots(halfDay: boolean) {
  return halfDay ? [...morningSlots, extraMorningSlot] : allSlots;
}

function orderOccupiedSlots(order: WorkOrder, services: ServiceType[], halfDay: boolean) {
  const normalized = normalizeTime(order.time);
  const duration = orderSlotCount(order, services);
  const source = afternoonSlots.includes(normalized)
    ? afternoonSlots
    : normalized === extraMorningSlot
      ? [...morningSlots, extraMorningSlot]
      : bookingSlots(halfDay);
  const start = source.indexOf(normalized);
  return start >= 0 ? source.slice(start, start + duration) : [];
}

function scheduleRangeForOrder(order: WorkOrder, services: ServiceType[], halfDay: boolean) {
  const occupied = orderOccupiedSlots(order, services, halfDay);
  if (!occupied.length) return slotLabel(normalizeTime(order.time));
  return occupied[0] + ' - ' + slotEnd(occupied[occupied.length - 1]);
}

function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[], halfDay: boolean) {
  return orderOccupiedSlots(order, services, halfDay).includes(slot);
}

`,
  'slot calculation helpers',
);

replaceSection(
  'function scheduleSlotTop(index: number) {',
  'function orderDescription(order: WorkOrder, service?: ServiceType) {',
String.raw`function scheduleSlotTop(index: number) {
  const afternoonOffset = index >= morningSlots.length + 1 ? GROUP_HEADER_HEIGHT + TRANSITION_GAP + AFTERNOON_START_GAP : 0;
  return GROUP_HEADER_HEIGHT + index * (SLOT_HEIGHT + SLOT_GAP) + afternoonOffset;
}

function scheduleBlockHeight(start: number, end: number) {
  const first = Math.max(0, start);
  const last = Math.max(first, end);
  const slots = last - first + 1;
  const crossesTransition = first < morningSlots.length + 1 && last >= morningSlots.length + 1;
  return slots * SLOT_HEIGHT + (slots - 1) * SLOT_GAP + (crossesTransition ? GROUP_HEADER_HEIGHT + TRANSITION_GAP + AFTERNOON_START_GAP : 0);
}

`,
  'schedule geometry helpers',
);

replaceOnce(
  "  const { calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData } = useCalendarState();\n",
  "  const { calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData } = useCalendarState();\n  const { vanHalfDaySchedules, halfDayLoading, halfDayError, refreshVanHalfDays } = useVanHalfDayState();\n",
  'half-day state hook',
);

replaceOnce(
  "  const combinedDataError = calendarDataError ?? teamDataError ?? dataError;\n",
  "  const combinedDataError = halfDayError ?? calendarDataError ?? teamDataError ?? dataError;\n  const isHalfDay = (candidateVanId: string, date = selectedDate) => vanHasHalfDayOnDate(candidateVanId, date, vanHalfDaySchedules);\n",
  'half-day date helper',
);

replaceSection(
  '  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {',
  '  useEffect(() => {\n    if (!selectedVan) return;',
String.raw`  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {
    if (calendarDateStatus(date, businessCalendarSettings, calendarClosures).closed) return false;
    if (!vanCanReceiveAppointments(candidateVan)) return false;
    const halfDay = isHalfDay(candidateVan.id, date);
    if (halfDay && afternoonSlots.includes(candidateTime)) return false;
    if (!halfDay && candidateTime === extraMorningSlot) return false;
    const candidateSchedule = bookingSlots(halfDay);
    const start = candidateSchedule.indexOf(candidateTime);
    if (start < 0 || start + workHours > candidateSchedule.length) return false;
    const candidateSlots = candidateSchedule.slice(start, start + workHours);
    return !workOrders.some(
      (order) =>
        order.date === date &&
        resolveStoredVanId(order.vanId, agendaVans, legacyVans) === candidateVan.id &&
        candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services, halfDay)),
    );
  };

`,
  'appointment availability',
);

replaceOnce(
String.raw`  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const firstAvailable = allSlots.find((slot) => isAvailable(selectedVan, slot));
    if (firstAvailable) setTime(firstAvailable);
  }, [workHours, vanId, selectedDate, workOrders, agendaVans]);`,
String.raw`  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const candidateSlots = bookingSlots(isHalfDay(selectedVan.id));
    const firstAvailable = candidateSlots.find((slot) => isAvailable(selectedVan, slot));
    if (firstAvailable) setTime(firstAvailable);
  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules]);`,
  'first available slot effect',
);

replaceOnce(
  'subtitle="Selecciona cliente, propiedad, duración, van y horario. Cada van tiene 3 horas en la mañana y 3 horas en la tarde."',
  'subtitle="Selecciona cliente, propiedad, duración, van y horario. Las vans con tarde libre trabajan jornada continua, habilitan 11:30 a. m. y bloquean la tarde."',
  'agenda subtitle',
);

replaceOnce(
  'onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData()])}',
  'onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData(), refreshVanHalfDays()])}',
  'agenda retry refresh',
);

replaceOnce(
  '<Text style={styles.workday}>Horario laboral: 8:00 AM - 5:00 PM | Pausa: 12:00 PM - 1:00 PM</Text>',
  '<Text style={styles.workday}>Horario regular: 8:00 AM - 5:00 PM | Las vans con beneficio trabajan continuo hasta 1:00 PM y tienen la tarde libre</Text>',
  'workday note',
);

replaceOnce(
  '{dataLoading || teamLoading || calendarLoading ? <Text style={styles.syncText}>Sincronizando agenda, equipo y calendario…</Text> : null}',
  '{dataLoading || teamLoading || calendarLoading || halfDayLoading ? <Text style={styles.syncText}>Sincronizando agenda, equipo, calendario y tardes libres…</Text> : null}',
  'loading state',
);

replaceOnce(
  '<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>',
  '<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} halfDay={isHalfDay(van.id)} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>',
  'VanColumn half-day prop',
);

replaceOnce(
  '<View style={styles.legendBar}><Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text><Legend color="#EAF7E7" label="Disponible" /><Legend color="#EAF3FF" label="Ocupado" /><Legend color="#FDECEC" label="No disponible" /></View>',
  '<View style={styles.legendBar}><Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text><Legend color="#EAF7E7" label="Disponible" /><Legend color="#EAF3FF" label="Ocupado" /><Legend color="#FDECEC" label="No disponible / tarde libre" /><Legend color={colors.warningLight} label="Conflicto por reprogramar" /></View>',
  'agenda legend',
);

replaceOnce(
  '<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>',
  '<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>',
  'appointment details half-day prop',
);

replaceOnce(
  '<View style={styles.optionWrap}>{allSlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>',
  '<View style={styles.optionWrap}>{displaySlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>',
  'modal slot choices',
);

replaceSection(
  'function VanColumn(',
  'function ScheduleHeader(',
String.raw`function VanColumn({ van, halfDay, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, closedReason }: { van: AgendaVan; halfDay: boolean; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void; closedReason?: string }) {
  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';
  const unavailableReason = van.status === 'Mantenimiento' ? 'Mantenimiento' : van.status === 'Fuera de servicio' ? 'Fuera de servicio' : 'Sin personal';
  const effectiveMorningSlots = halfDay ? [...morningSlots, extraMorningSlot] : morningSlots;
  const usedMorning = effectiveMorningSlots.filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services, halfDay))).length;
  const usedAfternoon = afternoonSlots.filter((slot) => orders.some((order) => order.vanId === van.id && orderOccupiesSlot(order, slot, services, halfDay))).length;

  return (
    <View style={styles.vanColumn}>
      <View style={styles.vanColumnHeader}>
        <Text style={styles.vanIcon}>🚐</Text>
        <Text style={styles.vanTitle}>{van.name}</Text>
        <Text style={styles.vanTechs}>{techNames} · {van.dispatchStatus}</Text>
        {halfDay ? <Pill label="Tarde libre" tone="danger" /> : null}
      </View>
      <View style={[styles.scheduleCanvas, { height: SCHEDULE_HEIGHT }]}>
        <ScheduleHeader title="MAÑANA" used={usedMorning} capacity={halfDay ? 4 : 3} top={0} />
        <View style={[styles.lunchDivider, { top: GROUP_HEADER_HEIGHT + (morningSlots.length + 1) * (SLOT_HEIGHT + SLOT_GAP) }]}>
          <Text style={styles.lunchText}>{halfDay ? 'JORNADA CONTINUA · SALIDA 13:00' : 'PREPARACIÓN / ALMUERZO'}</Text>
        </View>
        <ScheduleHeader title="TARDE" used={usedAfternoon} capacity={3} label={halfDay ? 'Tarde libre' : undefined} top={AFTERNOON_HEADER_TOP} />
        {displaySlots.map((slot, index) => {
          const order = orders.find((item) => item.vanId === van.id && orderOccupiesSlot(item, slot, services, halfDay));
          const top = scheduleSlotTop(index);
          if (order) {
            const occupied = orderOccupiedSlots(order, services, halfDay);
            const start = displaySlots.indexOf(occupied[0]);
            const end = displaySlots.indexOf(occupied[occupied.length - 1]);
            if (start !== index) return null;
            const slots = orderSlotCount(order, services);
            const service = services.find((item) => item.id === order.serviceId);
            const client = clients.find((item) => item.id === order.clientId);
            const property = properties.find((item) => item.id === order.propertyId);
            const zone = order.zone ?? property?.zone ?? client?.zone ?? 'Zona no registrada';
            const conflict = (halfDay && occupied.some((item) => afternoonSlots.includes(item))) || (!halfDay && occupied.includes(extraMorningSlot));
            return (
              <Pressable key={order.id} onPress={() => onSelectOrder(order.id)} style={[styles.mergedAppointment, conflict && styles.slotConflict, selectedOrderId === order.id && styles.slotSelected, { top, height: scheduleBlockHeight(start, end) }]}>
                <View style={styles.slotTop}><Text style={styles.slotTime}>{scheduleRangeForOrder(order, services, halfDay)}</Text><Pill label={conflict ? 'Conflicto' : order.status} tone={conflict ? 'warning' : toneForStatus(order.status)} /></View>
                <Text style={styles.clientName} numberOfLines={1}>{client?.name ?? 'Cliente'}</Text>
                <Text style={styles.addressLine} numberOfLines={2}>{order.address}</Text>
                <Text style={styles.zoneLine} numberOfLines={1}>{zone}</Text>
                <Text style={styles.serviceLine} numberOfLines={3}>{orderDescription(order, service)}</Text>
                <Text style={styles.cupoLine}>{slots} hora{slots !== 1 ? 's' : ''} · {slots} cupo{slots !== 1 ? 's' : ''}</Text>
                {conflict ? <Text style={styles.breakIncluded}>Requiere reprogramación por la tarde libre asignada</Text> : null}
              </Pressable>
            );
          }
          if (closedReason) return <View key={van.id + '-' + slot} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Cerrado</Text><Text style={styles.closedSlotReason} numberOfLines={2}>{closedReason}</Text></View>;
          if (halfDay && afternoonSlots.includes(slot)) return <View key={van.id + '-' + slot} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Tarde libre</Text><Text style={styles.closedSlotReason}>Beneficio semanal de la van</Text></View>;
          if (!halfDay && slot === extraMorningSlot) return <View key={van.id + '-' + slot} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>Preparación / almuerzo</Text></View>;
          if (!vanCanReceiveAppointments(van)) return <View key={van.id + '-' + slot} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{unavailableReason}</Text></View>;
          return <Pressable key={van.id + '-' + slot} onPress={() => onCreate(slot)} style={[styles.absoluteSlot, styles.slotAvailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.availableText}>Disponible</Text><Text style={styles.addSlot}>＋</Text></Pressable>;
        })}
      </View>
    </View>
  );
}

`,
  'VanColumn component',
);

replaceSection(
  'function ScheduleHeader(',
  'function AppointmentDetails(',
String.raw`function ScheduleHeader({ title, used, capacity, label, top }: { title: string; used: number; capacity: number; label?: string; top: number }) {
  return <View style={[styles.scheduleHeader, { top }]}><Text style={styles.groupTitle}>{title}</Text><Text style={[styles.cupos, !label && used >= capacity && styles.cuposFull]}>{label ?? used + '/' + capacity + ' horas'}</Text></View>;
}

`,
  'ScheduleHeader component',
);

replaceSection(
  'function AppointmentDetails(',
  'function SearchRow(',
String.raw`function AppointmentDetails({ order, halfDay, clients, properties, services, vans, users, onUpdate }: { order?: WorkOrder; halfDay: boolean; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }> }) {
  if (!order) return <View style={styles.emptyDetails}><Text style={styles.detailTitle}>Detalles de la cita</Text><Text style={styles.detailMuted}>Selecciona una cita para ver la información completa.</Text></View>;
  const client = clients.find((item) => item.id === order.clientId);
  const property = properties.find((item) => item.id === order.propertyId);
  const service = services.find((item) => item.id === order.serviceId);
  const van = vans.find((item) => item.id === order.vanId);
  const slots = orderSlotCount(order, services);
  const techNames = order.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';
  return <View><View style={styles.detailHeader}><Pill label={order.status} tone={toneForStatus(order.status)} /><Text style={styles.detailId}>ID: {order.id}</Text></View><Text style={styles.detailTitle}>{client?.name}</Text><Text style={styles.detailSubtitle}>{service?.name ?? 'Trabajo programado'}</Text><View style={styles.detailTabs}><Text style={styles.detailTabActive}>Detalles</Text><Text style={styles.detailTab}>Cliente</Text><Text style={styles.detailTab}>Notas</Text></View><DetailRow label="Fecha y hora" value={formatDate(order.date, true) + ' · ' + scheduleRangeForOrder(order, services, halfDay)} /><DetailRow label="Duración" value={String(slots) + ' hora' + (slots !== 1 ? 's' : '')} /><DetailRow label="Propiedad" value={property?.name} /><DetailRow label="Dirección" value={order.address} /><DetailRow label="Zona" value={order.zone ?? property?.zone ?? client?.zone} /><DetailRow label="Técnico asignado" value={techNames} /><DetailRow label="Van asignada" value={van?.name ?? 'Sin van'} /><DetailRow label="Descripción del trabajo" value={orderDescription(order, service)} />{order.airConditionerCount ? <DetailRow label="Cantidad de aires (cita anterior)" value={String(order.airConditionerCount)} /> : null}<View style={styles.detailActions}><Button variant="secondary" label="Editar cita" onPress={() => {}} /><Button label="Marcar completada" onPress={() => void onUpdate(order.id, { status: 'Completada', updatedAt: new Date().toISOString() })} /></View></View>;
}

`,
  'AppointmentDetails component',
);

replaceOnce(
  "  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },\n",
  "  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },\n  slotConflict: { borderColor: '#D4A72C', backgroundColor: colors.warningLight, borderWidth: 2 },\n",
  'conflict style',
);

fs.writeFileSync(path, source);
console.log('AgendaScreen.tsx updated with integrated van half-day behavior.');
