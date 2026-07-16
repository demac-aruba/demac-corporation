const fs = require('fs');

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Could not find ${label}`);
  return source.replace(search, replacement);
}

function replaceSection(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not find section ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const agendaPath = 'src/screens/AgendaScreen.tsx';
let agenda = fs.readFileSync(agendaPath, 'utf8');

agenda = replaceOnce(
  agenda,
  "import { useTeamState } from '../state/TeamState';\n",
  "import { useTeamState } from '../state/TeamState';\nimport { useVanHalfDayState, vanHasHalfDayOnDate } from '../state/VanHalfDayState';\n",
  'VanHalfDayState import',
);

agenda = replaceOnce(
  agenda,
  `const morningSlots = ['08:30', '09:30', '10:30'];
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
  `const morningSlots = ['08:30', '09:30', '10:30'];
const extraMorningSlot = '11:30';
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const extendedSlots = [...morningSlots, extraMorningSlot, ...afternoonSlots];
const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const SLOT_HEIGHT = 118;
const SLOT_GAP = 8;
const GROUP_HEADER_HEIGHT = 30;
const LUNCH_GAP = 44;
const AFTERNOON_START_GAP = 12;
const REGULAR_AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) + LUNCH_GAP;
const EXTENDED_AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + (morningSlots.length + 1) * (SLOT_HEIGHT + SLOT_GAP) + AFTERNOON_START_GAP;
const REGULAR_SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP + AFTERNOON_START_GAP;
const EXTENDED_SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + extendedSlots.length * SLOT_HEIGHT + (extendedSlots.length - 1) * SLOT_GAP + AFTERNOON_START_GAP;`,
  'agenda slot constants',
);

agenda = replaceSection(
  agenda,
  'function orderSlotCount(order: WorkOrder, services: ServiceType[]) {',
  'function toneForStatus(status: AppointmentStatus) {',
  `function orderSlotCount(order: WorkOrder, services: ServiceType[]) {
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
  const source = afternoonSlots.includes(normalized) ? afternoonSlots : bookingSlots(halfDay);
  const start = source.indexOf(normalized);
  if (start < 0) return [];
  return source.slice(start, start + orderSlotCount(order, services));
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

agenda = replaceSection(
  agenda,
  'function scheduleSlotTop(index: number) {',
  'function orderDescription(order: WorkOrder, service?: ServiceType) {',
  `function scheduleSlotTop(index: number, extendedLayout: boolean) {
  const morningCount = extendedLayout ? morningSlots.length + 1 : morningSlots.length;
  const afternoonOffset = index >= morningCount
    ? GROUP_HEADER_HEIGHT + (extendedLayout ? AFTERNOON_START_GAP : LUNCH_GAP + AFTERNOON_START_GAP)
    : 0;
  return GROUP_HEADER_HEIGHT + index * (SLOT_HEIGHT + SLOT_GAP) + afternoonOffset;
}

function scheduleBlockHeight(start: number, end: number, extendedLayout: boolean) {
  const first = Math.max(0, start);
  const last = Math.max(first, end);
  const slots = last - first + 1;
  const morningCount = extendedLayout ? morningSlots.length + 1 : morningSlots.length;
  const crossesBreak = first < morningCount && last >= morningCount;
  const breakHeight = extendedLayout ? GROUP_HEADER_HEIGHT + AFTERNOON_START_GAP : GROUP_HEADER_HEIGHT + LUNCH_GAP + AFTERNOON_START_GAP;
  return slots * SLOT_HEIGHT + (slots - 1) * SLOT_GAP + (crossesBreak ? breakHeight : 0);
}

`,
  'schedule geometry helpers',
);

agenda = replaceOnce(
  agenda,
  "  const { calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData } = useCalendarState();\n",
  "  const { calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData } = useCalendarState();\n  const { vanHalfDaySchedules, halfDayLoading, halfDayError, refreshVanHalfDays } = useVanHalfDayState();\n",
  'half-day state hook',
);

agenda = replaceOnce(
  agenda,
  "  const combinedDataError = calendarDataError ?? teamDataError ?? dataError;\n",
  "  const combinedDataError = halfDayError ?? calendarDataError ?? teamDataError ?? dataError;\n  const isHalfDay = (candidateVanId: string, date = selectedDate) => vanHasHalfDayOnDate(candidateVanId, date, vanHalfDaySchedules);\n  const extendedDayLayout = agendaVans.some((van) => isHalfDay(van.id));\n",
  'half-day date helper',
);

agenda = replaceSection(
  agenda,
  '  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {',
  '  useEffect(() => {\n    if (!selectedVan) return;',
  `  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {
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

agenda = replaceOnce(
  agenda,
  `  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const firstAvailable = allSlots.find((slot) => isAvailable(selectedVan, slot));
    if (firstAvailable) setTime(firstAvailable);
  }, [workHours, vanId, selectedDate, workOrders, agendaVans]);`,
  `  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const candidateSlots = bookingSlots(isHalfDay(selectedVan.id));
    const firstAvailable = candidateSlots.find((slot) => isAvailable(selectedVan, slot));
    if (firstAvailable) setTime(firstAvailable);
  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules]);`,
  'first available slot effect',
);

agenda = replaceOnce(
  agenda,
  'onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData()])}',
  'onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData(), refreshVanHalfDays()])}',
  'agenda retry refresh',
);

agenda = replaceOnce(
  agenda,
  '{dataLoading || teamLoading || calendarLoading ? <Text style={styles.syncText}>Sincronizando agenda, equipo y calendario…</Text> : null}',
  '{dataLoading || teamLoading || calendarLoading || halfDayLoading ? <Text style={styles.syncText}>Sincronizando agenda, equipo y calendario…</Text> : null}',
  'loading state',
);

agenda = replaceOnce(
  agenda,
  '<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>',
  '<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} halfDay={isHalfDay(van.id)} extendedLayout={extendedDayLayout} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>',
  'VanColumn half-day props',
);

agenda = replaceOnce(
  agenda,
  '<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>',
  '<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>',
  'appointment details half-day prop',
);

agenda = replaceOnce(
  agenda,
  '<View style={styles.optionWrap}>{allSlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>',
  '<View style={styles.optionWrap}>{(selectedVan && isHalfDay(selectedVan.id) ? [...morningSlots, extraMorningSlot] : allSlots).map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>',
  'appointment time options',
);

agenda = replaceSection(
  agenda,
  'function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, closedReason }:',
  'function ScheduleHeader(',
  `function VanColumn({ van, halfDay, extendedLayout, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, closedReason }: { van: AgendaVan; halfDay: boolean; extendedLayout: boolean; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void; closedReason?: string }) {
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
              <Pressable key={order.id} onPress={() => onSelectOrder(order.id)} style={[styles.mergedAppointment, selectedOrderId === order.id && styles.slotSelected, { top, height: scheduleBlockHeight(start, Math.max(start, end), extendedLayout) }]}>
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
          return <Pressable key={`${van.id}-${slot}`} onPress={() => onCreate(slot)} style={[styles.absoluteSlot, styles.slotAvailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.availableText}>Disponible</Text><Text style={styles.addSlot}>＋</Text></Pressable>;
        })}
      </View>
    </View>
  );
}

function ScheduleHeader(`,
  'VanColumn component',
);

agenda = replaceOnce(
  agenda,
  'function ScheduleHeader({ title, used, top }: { title: string; used: number; top: number }) {\n  return <View style={[styles.scheduleHeader, { top }]}><Text style={styles.groupTitle}>{title}</Text><Text style={[styles.cupos, used >= 3 && styles.cuposFull]}>{used}/3 horas</Text></View>;\n}',
  'function ScheduleHeader({ title, used, capacity, top }: { title: string; used: number; capacity: number; top: number }) {\n  return <View style={[styles.scheduleHeader, { top }]}><Text style={styles.groupTitle}>{title}</Text><Text style={[styles.cupos, used >= capacity && styles.cuposFull]}>{used}/{capacity} horas</Text></View>;\n}',
  'ScheduleHeader capacity',
);

agenda = replaceOnce(
  agenda,
  'function AppointmentDetails({ order, clients, properties, services, vans, users, onUpdate }: { order?: WorkOrder; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }> }) {',
  'function AppointmentDetails({ order, halfDay, clients, properties, services, vans, users, onUpdate }: { order?: WorkOrder; halfDay: boolean; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }> }) {',
  'AppointmentDetails signature',
);

agenda = replaceOnce(
  agenda,
  '${scheduleRange(order.time, slots)}',
  '${scheduleRangeForOrder(order, services, halfDay)}',
  'appointment details range',
);

fs.writeFileSync(agendaPath, agenda);

const statePath = 'src/state/VanHalfDayState.tsx';
let state = fs.readFileSync(statePath, 'utf8');
state = replaceOnce(
  state,
  "export type VanHalfDayWeekday = 1 | 2 | 3 | 4 | 5 | 6;\n",
  "export type VanHalfDayWeekday = 1 | 2 | 3 | 4 | 5 | 6;\nexport const VAN_HALF_DAY_EFFECTIVE_FROM = '2026-08-01';\n",
  'half-day effective date constant',
);
state = replaceOnce(
  state,
  "export function vanHasHalfDayOnDate(vanId: string, date: string, schedules: VanHalfDaySchedule[]) {\n  const weekday = new Date(`${date}T12:00:00`).getDay();\n  return schedules.some((schedule) => schedule.active && schedule.vanId === vanId && schedule.weekday === weekday);\n}\n",
  "export function vanHasHalfDayOnDate(vanId: string, date: string, schedules: VanHalfDaySchedule[]) {\n  if (date < VAN_HALF_DAY_EFFECTIVE_FROM) return false;\n  const weekday = new Date(`${date}T12:00:00`).getDay();\n  return schedules.some((schedule) => schedule.active && schedule.vanId === vanId && schedule.weekday === weekday);\n}\n",
  'half-day effective date check',
);
fs.writeFileSync(statePath, state);
