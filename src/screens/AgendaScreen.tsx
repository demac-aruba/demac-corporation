import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { PhoneField } from '../components/PhoneField';
import { useAppState } from '../state/AppState';
import { BusinessCalendarSettings, CalendarClosure, useCalendarState } from '../state/CalendarState';
import { useTeamState } from '../state/TeamState';
import { useVanHalfDayState, vanHasHalfDayOnDate } from '../state/VanHalfDayState';
import { colors } from '../theme';
import { AppointmentChangeOrigin, AppointmentChangeReasonCategory, AppointmentNotificationRecipient, AppointmentStatus, Client, DailyVanAssignment, PreferredLanguage, Property, PropertyContact, PropertyContactLanguage, PropertyContactRole, PropertyType, ServiceType, StaffAbsence, StaffProfile, Van, WorkOrder, WorkOrderScheduleHistoryEntry } from '../types';
import { DEFAULT_PHONE_COUNTRY, normalizePhone, phoneComparisonKey, templateLanguageFor } from '../utils/phone';

const morningSlots = ['08:30', '09:30', '10:30'];
const extraMorningSlot = '11:30';
const afternoonSlots = ['13:30', '14:30', '15:30'];
const allSlots = [...morningSlots, ...afternoonSlots];
const extendedSlots = [...morningSlots, extraMorningSlot, ...afternoonSlots];
const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const propertyContactRoles: PropertyContactRole[] = ['Dueño', 'Encargado', 'Administrador', 'Inquilino', 'Contacto de acceso', 'Contabilidad', 'Otro'];
const propertyContactLanguages: PropertyContactLanguage[] = ['Español', 'English', 'Nederlands', 'Papiamento'];
const appointmentChangeOrigins: AppointmentChangeOrigin[] = ['Cliente', 'DEMAC', 'Fuerza mayor', 'Otro'];
const appointmentChangeReasons: AppointmentChangeReasonCategory[] = [
  'Cliente solicita otra fecha',
  'Cliente no puede recibirnos',
  'Cliente ya no desea el servicio',
  'No se logró contactar al cliente',
  'Problema de precio o cotización',
  'Dirección o acceso no disponible',
  'Error de programación',
  'Falta de personal de DEMAC',
  'Avería de van o herramientas',
  'Condiciones climáticas',
  'Otro',
];

type AppointmentChangeDraft = {
  origin: AppointmentChangeOrigin;
  reasonCategory: AppointmentChangeReasonCategory;
  reasonNote: string;
  changedByUserId?: string;
  changedByName: string;
  recordedAt: string;
  noticeHours: number;
};
const SLOT_HEIGHT = 118;
const SLOT_GAP = 8;
const GROUP_HEADER_HEIGHT = 30;
const LUNCH_GAP = 44;
const AFTERNOON_START_GAP = 12;
const REGULAR_AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) + LUNCH_GAP;
const EXTENDED_AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + (morningSlots.length + 1) * (SLOT_HEIGHT + SLOT_GAP) + AFTERNOON_START_GAP;
const REGULAR_SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP + AFTERNOON_START_GAP;
const EXTENDED_SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + extendedSlots.length * SLOT_HEIGHT + (extendedSlots.length - 1) * SLOT_GAP + AFTERNOON_START_GAP;

type QuickClientForm = {
  name: string;
  company: string;
  phone: string;
  phoneCountry: string;
  whatsapp: string;
  whatsappCountry: string;
  preferredLanguage: PreferredLanguage;
  propertyName: string;
  propertyType: PropertyType;
  address: string;
  zone: string;
};

const emptyQuickClientForm: QuickClientForm = {
  name: '',
  company: '',
  phone: '',
  phoneCountry: DEFAULT_PHONE_COUNTRY,
  whatsapp: '',
  whatsappCountry: DEFAULT_PHONE_COUNTRY,
  preferredLanguage: 'Español',
  propertyName: 'Propiedad principal',
  propertyType: 'Casa',
  address: '',
  zone: '',
};

type QuickPropertyForm = {
  name: string;
  type: PropertyType;
  address: string;
  zone: string;
  notes: string;
};

const emptyQuickPropertyForm: QuickPropertyForm = {
  name: '',
  type: 'Casa',
  address: '',
  zone: '',
  notes: '',
};

type QuickContactForm = {
  name: string;
  role: PropertyContactRole;
  phone: string;
  phoneCountry: string;
  whatsapp: string;
  whatsappCountry: string;
  email: string;
  preferredLanguage: PropertyContactLanguage;
  defaultSendConfirmation: boolean;
  defaultSendReminder: boolean;
  arrivalContact: boolean;
};

const emptyQuickContactForm: QuickContactForm = {
  name: '',
  role: 'Encargado',
  phone: '',
  phoneCountry: DEFAULT_PHONE_COUNTRY,
  whatsapp: '',
  whatsappCountry: DEFAULT_PHONE_COUNTRY,
  email: '',
  preferredLanguage: 'Español',
  defaultSendConfirmation: false,
  defaultSendReminder: true,
  arrivalContact: true,
};

function clientNotificationLanguage(client: Client): PropertyContactLanguage {
  if (client.preferredLanguage) return client.preferredLanguage;
  if (client.templateLanguage === 'es') return 'Español';
  if (client.templateLanguage === 'nl') return 'Nederlands';
  return 'English';
}

function clientNotificationRecipient(client: Client): AppointmentNotificationRecipient {
  return {
    id: `client-${client.id}`,
    recipientType: 'client',
    sourceId: client.id,
    name: client.name || client.company || 'Cliente',
    role: 'Cliente / facturación',
    phone: client.phone,
    phoneCountry: client.phoneCountry,
    whatsapp: client.whatsapp || client.phone,
    whatsappCountry: client.whatsappCountry || client.phoneCountry,
    preferredLanguage: clientNotificationLanguage(client),
    templateLanguage: client.templateLanguage,
    sendConfirmation: true,
    sendReminder: true,
  };
}

function contactNotificationRecipient(contact: PropertyContact): AppointmentNotificationRecipient {
  return {
    id: `contact-${contact.id}`,
    recipientType: 'propertyContact',
    sourceId: contact.id,
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    phoneCountry: contact.phoneCountry,
    whatsapp: contact.whatsapp || contact.phone,
    whatsappCountry: contact.whatsappCountry || contact.phoneCountry,
    preferredLanguage: contact.preferredLanguage,
    sendConfirmation: contact.defaultSendConfirmation === true,
    sendReminder: contact.defaultSendReminder === true,
  };
}

function buildNotificationRecipients(
  client?: Client,
  property?: Property,
  saved?: AppointmentNotificationRecipient[],
  legacyEnabled = true,
) {
  const available = [
    ...(client ? [clientNotificationRecipient(client)] : []),
    ...((property?.contacts ?? []).filter((contact) => contact.active !== false).map(contactNotificationRecipient)),
  ];
  if (!saved?.length) {
    return available.map((recipient, index) => ({
      ...recipient,
      sendConfirmation: index === 0 ? legacyEnabled : recipient.sendConfirmation,
      sendReminder: index === 0 ? legacyEnabled : recipient.sendReminder,
    }));
  }
  const savedBySource = new Map(saved.map((recipient) => [`${recipient.recipientType}:${recipient.sourceId}`, recipient]));
  const availableKeys = new Set(available.map((recipient) => `${recipient.recipientType}:${recipient.sourceId}`));
  return [
    ...available.map((recipient) => {
      const previous = savedBySource.get(`${recipient.recipientType}:${recipient.sourceId}`);
      return previous ? {
        ...recipient,
        sendConfirmation: previous.sendConfirmation === true,
        sendReminder: previous.sendReminder === true,
      } : recipient;
    }),
    ...saved.filter((recipient) => !availableKeys.has(`${recipient.recipientType}:${recipient.sourceId}`)),
  ];
}

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


function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, amount: number) {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  return localDateKey(new Date(year, month - 1 + amount, 1, 12));
}

function buildMonthCalendar(monthDate: string) {
  const [year, month] = monthDate.slice(0, 7).split('-').map(Number);
  const firstWeekday = new Date(year, month - 1, 1, 12).getDay();
  const daysInMonth = new Date(year, month, 0, 12).getDate();
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
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

function occupiedSlotsFor(time: string, slotCount: number, halfDay: boolean) {
  const normalized = normalizeTime(time);
  const source = afternoonSlots.includes(normalized) ? afternoonSlots : bookingSlots(halfDay);
  const start = source.indexOf(normalized);
  if (start < 0) return [];
  return source.slice(start, start + slotCount);
}

function orderOccupiedSlots(order: WorkOrder, services: ServiceType[], halfDay: boolean) {
  return occupiedSlotsFor(order.time, orderSlotCount(order, services), halfDay);
}

function scheduleRangeForOrder(order: WorkOrder, services: ServiceType[], halfDay: boolean) {
  const occupied = orderOccupiedSlots(order, services, halfDay);
  if (!occupied.length) return slotLabel(normalizeTime(order.time));
  return occupied[0] + ' - ' + slotEnd(occupied[occupied.length - 1]);
}

function orderOccupiesSlot(order: WorkOrder, slot: string, services: ServiceType[], halfDay: boolean) {
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

function scheduleHistoryEntry(
  order: WorkOrder,
  services: ServiceType[],
  details: AppointmentChangeDraft & {
    status: 'Cancelada' | 'Reprogramada';
    newDate?: string;
    newTime?: string;
    newVanId?: string;
  },
): WorkOrderScheduleHistoryEntry {
  return {
    id: `history-${order.id}-${Date.now()}`,
    date: order.date,
    time: order.time,
    vanId: order.vanId,
    technicianIds: order.technicianIds,
    scheduledSlots: orderSlotCount(order, services),
    status: details.status,
    clientId: order.clientId,
    propertyId: order.propertyId,
    address: order.address,
    zone: order.zone,
    problem: order.problem,
    changeOrigin: details.origin,
    reasonCategory: details.reasonCategory,
    reasonNote: details.reasonNote,
    changedByUserId: details.changedByUserId,
    changedByName: details.changedByName,
    noticeHours: details.noticeHours,
    newDate: details.newDate,
    newTime: details.newTime,
    newVanId: details.newVanId,
    recordedAt: details.recordedAt,
  };
}

function appointmentNoticeHours(order: WorkOrder) {
  const appointment = new Date(`${order.date}T${normalizeTime(order.time)}:00`);
  if (Number.isNaN(appointment.getTime())) return 0;
  return Math.round(((appointment.getTime() - Date.now()) / 3_600_000) * 10) / 10;
}

function toneForStatus(status: AppointmentStatus) {
  return statusTone(status);
}

function scheduleSlotTop(index: number, extendedLayout: boolean) {
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


function calendarDateStatus(date: string, settings: BusinessCalendarSettings, closures: CalendarClosure[]) {
  const closure = closures.find((item) => item.active !== false && item.date === date);
  if (closure) return { closed: true, reason: closure.reason };
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if ((settings.closedWeekdays ?? [0]).includes(weekday)) return { closed: true, reason: weekdaysLabel(weekday) };
  return { closed: false, reason: '' };
}

function weekdaysLabel(value: number) {
  return ['Domingo cerrado', 'Lunes cerrado', 'Martes cerrado', 'Miércoles cerrado', 'Jueves cerrado', 'Viernes cerrado', 'Sábado cerrado'][value] ?? 'Día cerrado';
}

export function AgendaScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1260;
  const {
    currentUser,
    workOrders,
    clients,
    properties,
    services,
    vans: legacyVans,
    users: legacyUsers,
    addClient,
    addProperty,
    updateProperty,
    addWorkOrder,
    updateWorkOrder,
    dataError,
    dataLoading,
    refreshOperationalData,
    clearDataError,
  } = useAppState();
  const { vans: teamVans, staffProfiles, dailyVanAssignments, staffAbsences, teamLoading, teamDataError, refreshTeamData } = useTeamState();
  const { calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData } = useCalendarState();
  const { vanHalfDaySchedules, halfDayLoading, halfDayError, refreshVanHalfDays } = useVanHalfDayState();

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [calendarMonth, setCalendarMonth] = useState(monthStart(localDateKey()));
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickClient, setShowQuickClient] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [quickClient, setQuickClient] = useState<QuickClientForm>(emptyQuickClientForm);
  const [quickClientSaving, setQuickClientSaving] = useState(false);
  const [quickClientMessage, setQuickClientMessage] = useState('');
  const [showQuickProperty, setShowQuickProperty] = useState(false);
  const [quickProperty, setQuickProperty] = useState<QuickPropertyForm>(emptyQuickPropertyForm);
  const [quickPropertySaving, setQuickPropertySaving] = useState(false);
  const [quickPropertyMessage, setQuickPropertyMessage] = useState('');
  const [showQuickContact, setShowQuickContact] = useState(false);
  const [quickContact, setQuickContact] = useState<QuickContactForm>(emptyQuickContactForm);
  const [quickContactSaving, setQuickContactSaving] = useState(false);
  const [quickContactMessage, setQuickContactMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [workHours, setWorkHours] = useState(1);
  const [workDescriptionText, setWorkDescriptionText] = useState('');
  const [vanId, setVanId] = useState(teamVans[0]?.id ?? legacyVans[0]?.id ?? '');
  const [time, setTime] = useState('08:30');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [reschedulingOrderId, setReschedulingOrderId] = useState<string | null>(null);
  const [notificationRecipients, setNotificationRecipients] = useState<AppointmentNotificationRecipient[]>([]);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [showChangeReason, setShowChangeReason] = useState(false);
  const [changeAction, setChangeAction] = useState<'cancel' | 'reschedule' | null>(null);
  const [changeOrderId, setChangeOrderId] = useState<string | null>(null);
  const [changeOrigin, setChangeOrigin] = useState<AppointmentChangeOrigin>('Cliente');
  const [changeReasonCategory, setChangeReasonCategory] = useState<AppointmentChangeReasonCategory | ''>('');
  const [changeReasonNote, setChangeReasonNote] = useState('');
  const [changeReasonMessage, setChangeReasonMessage] = useState('');
  const [pendingChangeReason, setPendingChangeReason] = useState<AppointmentChangeDraft | null>(null);

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

  const selectedMonthKey = selectedDate.slice(0, 7);
  useEffect(() => {
    setCalendarMonth((current) => current.slice(0, 7) === selectedMonthKey ? current : `${selectedMonthKey}-01`);
  }, [selectedMonthKey]);

  const calendarCells = useMemo(() => buildMonthCalendar(calendarMonth), [calendarMonth]);
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
  const selectedPropertyContacts = (selectedProperty?.contacts ?? []).filter((contact) => contact.active !== false);
  const selectedVan = agendaVans.find((item) => item.id === vanId);
  const activeOrders = orders.filter(orderBlocksCapacity);
  const selectedOrder = activeOrders.find((order) => order.id === selectedOrderId) ?? activeOrders[0];
  const editingOrder = workOrders.find((order) => order.id === editingOrderId);
  const reschedulingOrder = workOrders.find((order) => order.id === reschedulingOrderId);

  useEffect(() => {
    if (!showCreate || showQuickClient || showQuickProperty || showQuickContact) return;
    const sourceOrder = editingOrder ?? reschedulingOrder;
    const sourceMatches = sourceOrder
      && sourceOrder.clientId === clientId
      && (sourceOrder.propertyId ?? '') === propertyId;
    setNotificationRecipients(buildNotificationRecipients(
      selectedClient,
      selectedProperty,
      sourceMatches ? sourceOrder.notificationRecipients : undefined,
      sourceMatches ? sourceOrder.whatsappNotificationsEnabled !== false : true,
    ));
  }, [clientId, propertyId, editingOrderId, reschedulingOrderId, showCreate]);

  const monthTitle = new Date(`${calendarMonth}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const selectedCalendarStatus = calendarDateStatus(selectedDate, businessCalendarSettings, calendarClosures);
  const selectedDateClosed = selectedCalendarStatus.closed;
  const combinedDataError = halfDayError ?? calendarDataError ?? teamDataError ?? dataError;
  const isHalfDay = (candidateVanId: string, date = selectedDate) => vanHasHalfDayOnDate(candidateVanId, date, vanHalfDaySchedules);
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
    const needle = clientQuery.trim().toLowerCase();
    const matches = clients.filter((client) => {
      const haystack = `${client.name} ${client.company ?? ''} ${client.phone} ${client.whatsapp} ${client.address} ${client.zone}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });
    if (needle) return matches.slice(0, 12);
    const selected = matches.find((client) => client.id === clientId);
    return selected ? [selected, ...matches.filter((client) => client.id !== selected.id).slice(0, 5)] : matches.slice(0, 6);
  }, [clients, clientQuery, clientId]);

  const isAvailableFor = (candidateVan: AgendaVan, candidateTime: string, date: string, duration: number, ignoreOrderId?: string) => {
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
    isAvailableFor(candidateVan, candidateTime, date, workHours, editingOrderId ?? reschedulingOrderId ?? undefined);

  useEffect(() => {
    if (!selectedVan) return;
    if (isAvailable(selectedVan, time)) return;
    const candidateSlots = bookingSlots(isHalfDay(selectedVan.id));
    const firstAvailable = candidateSlots.find((slot) => isAvailable(selectedVan, slot));
    if (firstAvailable) setTime(firstAvailable);
  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules, editingOrderId, reschedulingOrderId]);

  const openCreate = (candidateVanId?: string, candidateTime?: string, cancelled?: CancelledSlotRecord) => {
    if (selectedDateClosed) return;
    clearDataError();
    setFormMessage('');
    setSuccessMessage('');
    setClientQuery('');
    setShowQuickClient(false);

    const sourceOrder = editingOrder ?? reschedulingOrder;
    if (sourceOrder) {
      setClientId(sourceOrder.clientId);
      setPropertyId(sourceOrder.propertyId ?? '');
      setWorkDescriptionText(sourceOrder.problem);
      setWorkHours(orderSlotCount(sourceOrder, services));
      const sourceClient = clients.find((item) => item.id === sourceOrder.clientId);
      const sourceProperty = properties.find((item) => item.id === sourceOrder.propertyId);
      setNotificationRecipients(buildNotificationRecipients(sourceClient, sourceProperty, sourceOrder.notificationRecipients, sourceOrder.whatsappNotificationsEnabled !== false));
    } else if (cancelled) {
      setClientId(cancelled.clientId);
      setPropertyId(cancelled.propertyId ?? '');
      setWorkDescriptionText(cancelled.problem);
      setWorkHours(1);
      const cancelledClient = clients.find((item) => item.id === cancelled.clientId);
      const cancelledProperty = properties.find((item) => item.id === cancelled.propertyId);
      setNotificationRecipients(buildNotificationRecipients(cancelledClient, cancelledProperty));
    }

    if (!sourceOrder && !cancelled) setNotificationRecipients(buildNotificationRecipients(selectedClient, selectedProperty));
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
    const normalizedPhone = normalizePhone(quickClient.phone, quickClient.phoneCountry);
    const normalizedWhatsApp = normalizePhone(quickClient.whatsapp.trim() || quickClient.phone, quickClient.whatsapp.trim() ? quickClient.whatsappCountry : quickClient.phoneCountry);
    const phone = normalizedPhone.e164;
    const whatsapp = normalizedWhatsApp.e164;
    const address = quickClient.address.trim();
    const zone = quickClient.zone.trim();
    const propertyName = quickClient.propertyName.trim() || 'Propiedad principal';

    if (!name) return setQuickClientMessage('Escribe el nombre completo del cliente o empresa.');
    if (!quickClient.phone.trim()) return setQuickClientMessage('Escribe un número de teléfono.');
    if (!normalizedPhone.valid) return setQuickClientMessage('El teléfono no es válido para el país seleccionado.');
    if (!normalizedWhatsApp.valid) return setQuickClientMessage('El WhatsApp no es válido para el país seleccionado.');
    const duplicateKeys = [phoneComparisonKey(phone, normalizedPhone.country), phoneComparisonKey(whatsapp, normalizedWhatsApp.country)];
    const duplicate = clients.find((client) => [phoneComparisonKey(client.phone, client.phoneCountry), phoneComparisonKey(client.whatsapp, client.whatsappCountry)].some((key) => duplicateKeys.includes(key)));
    if (duplicate) return setQuickClientMessage(`Ya existe un cliente con este teléfono o WhatsApp: ${duplicate.name}.`);
    if (!address) return setQuickClientMessage('Escribe la dirección de la propiedad.');
    if (!zone) return setQuickClientMessage('Escribe la zona de la propiedad.');

    const timestamp = Date.now();
    const now = new Date().toISOString();
    const newClient: Client = {
      id: `client-${timestamp}`,
      name,
      company: company || undefined,
      phone,
      phoneCountry: normalizedPhone.country,
      whatsapp,
      whatsappCountry: normalizedWhatsApp.country,
      preferredLanguage: quickClient.preferredLanguage,
      templateLanguage: templateLanguageFor(quickClient.preferredLanguage),
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


  const openQuickProperty = () => {
    if (!selectedClient) return setFormMessage('Selecciona un cliente antes de añadir una propiedad.');
    setQuickProperty({ ...emptyQuickPropertyForm, name: `Propiedad ${clientProperties.length + 1}`, zone: selectedClient.zone || 'Oranjestad' });
    setQuickPropertyMessage('');
    setShowQuickProperty(true);
  };

  const saveQuickProperty = async () => {
    if (!selectedClient) return setQuickPropertyMessage('Selecciona un cliente antes de añadir la propiedad.');
    if (!quickProperty.name.trim()) return setQuickPropertyMessage('Escribe un nombre para identificar la propiedad.');
    if (!quickProperty.address.trim()) return setQuickPropertyMessage('Escribe la dirección de la propiedad.');
    const now = new Date().toISOString();
    const property: Property = {
      id: `property-${Date.now()}`,
      clientId: selectedClient.id,
      name: quickProperty.name.trim(),
      type: quickProperty.type,
      address: quickProperty.address.trim(),
      zone: quickProperty.zone.trim() || selectedClient.zone || 'Aruba',
      notes: quickProperty.notes.trim() || undefined,
      contacts: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    setQuickPropertySaving(true);
    setQuickPropertyMessage('');
    const result = await addProperty(property);
    setQuickPropertySaving(false);
    if (!result.ok) return setQuickPropertyMessage(result.message ?? 'No se pudo guardar la propiedad.');
    setPropertyId(property.id);
    setQuickProperty(emptyQuickPropertyForm);
    setShowQuickProperty(false);
    setSuccessMessage(`${property.name} fue agregada y seleccionada para esta cita.`);
  };

  const openQuickContact = () => {
    if (!selectedProperty) return setFormMessage('Selecciona una propiedad antes de añadir una persona encargada.');
    setQuickContact(emptyQuickContactForm);
    setQuickContactMessage('');
    setShowQuickContact(true);
  };

  const saveQuickContact = async () => {
    if (!selectedProperty) return setQuickContactMessage('Selecciona una propiedad antes de añadir la persona.');
    if (!quickContact.name.trim()) return setQuickContactMessage('Escribe el nombre de la persona.');
    if (!quickContact.phone.trim() && !quickContact.whatsapp.trim()) return setQuickContactMessage('Escribe al menos un teléfono o WhatsApp.');
    const normalizedPhone = normalizePhone(quickContact.phone.trim() || quickContact.whatsapp, quickContact.phone.trim() ? quickContact.phoneCountry : quickContact.whatsappCountry);
    const normalizedWhatsApp = normalizePhone(quickContact.whatsapp.trim() || quickContact.phone, quickContact.whatsapp.trim() ? quickContact.whatsappCountry : quickContact.phoneCountry);
    if (!normalizedPhone.valid || !normalizedWhatsApp.valid) return setQuickContactMessage('Revisa el país y el teléfono o WhatsApp de la persona.');
    const now = new Date().toISOString();
    const contact: PropertyContact = {
      id: `contact-${Date.now()}`,
      name: quickContact.name.trim(),
      role: quickContact.role,
      phone: normalizedPhone.e164,
      phoneCountry: normalizedPhone.country,
      whatsapp: normalizedWhatsApp.e164,
      whatsappCountry: normalizedWhatsApp.country,
      email: quickContact.email.trim() || undefined,
      preferredLanguage: quickContact.preferredLanguage,
      defaultSendConfirmation: quickContact.defaultSendConfirmation,
      defaultSendReminder: quickContact.defaultSendReminder,
      arrivalContact: quickContact.arrivalContact,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    setQuickContactSaving(true);
    setQuickContactMessage('');
    const result = await updateProperty(selectedProperty.id, {
      contacts: [...(selectedProperty.contacts ?? []), contact],
      updatedAt: now,
    });
    setQuickContactSaving(false);
    if (!result.ok) return setQuickContactMessage(result.message ?? 'No se pudo guardar la persona encargada.');
    setNotificationRecipients((previous) => [
      ...previous.filter((recipient) => !(recipient.recipientType === 'propertyContact' && recipient.sourceId === contact.id)),
      contactNotificationRecipient(contact),
    ]);
    setQuickContact(emptyQuickContactForm);
    setShowQuickContact(false);
    setSuccessMessage(`${contact.name} fue agregado como contacto de ${selectedProperty.name}.`);
  };

  const toggleNotificationRecipient = (recipientId: string, field: 'sendConfirmation' | 'sendReminder') => {
    setNotificationRecipients((previous) => previous.map((recipient) => recipient.id === recipientId ? { ...recipient, [field]: !recipient[field] } : recipient));
  };

  const saveAppointment = async (status: 'Reserva temporal' | 'Confirmada') => {
    const client = clients.find((item) => item.id === clientId);
    const van = agendaVans.find((item) => item.id === vanId);
    const description = workDescriptionText.trim();
    if (selectedDateClosed) return setFormMessage(`No se pueden crear citas: ${selectedCalendarStatus.reason}.`);
    if (!client) return setFormMessage('Primero selecciona o registra un cliente.');
    if (!description) return setFormMessage('Escribe la descripción del trabajo antes de guardar la cita.');
    if (!van) return setFormMessage('Selecciona una van.');
    if (!isAvailableFor(van, time, selectedDate, workHours, editingOrderId ?? reschedulingOrderId ?? undefined)) return setFormMessage('Ese horario no tiene suficientes horas consecutivas para este trabajo.');

    const now = new Date().toISOString();
    const zone = selectedProperty?.zone ?? client.zone;
    const notificationSnapshot = notificationRecipients.map((recipient) => ({ ...recipient }));
    const invalidRecipient = notificationSnapshot.find((recipient) => (recipient.sendConfirmation || recipient.sendReminder) && !normalizePhone(recipient.whatsapp || recipient.phone, recipient.whatsappCountry || recipient.phoneCountry).valid);
    if (invalidRecipient) return setFormMessage(`${invalidRecipient.name} está seleccionado para recibir WhatsApp, pero su número no es válido. Corrige el contacto o desmárcalo.`);
    const notificationsEnabled = notificationSnapshot.some((recipient) => recipient.sendConfirmation || recipient.sendReminder);
    setSaving(true);
    setFormMessage('');

    if (editingOrder) {
            const scheduleChanged = editingOrder.date !== selectedDate
      || normalizeTime(editingOrder.time) !== time
      || resolveStoredVanId(editingOrder.vanId, agendaVans, legacyVans) !== vanId
      || orderSlotCount(editingOrder, services) !== workHours;
    if (scheduleChanged) {
      setSaving(false);
      return setFormMessage('Para cambiar fecha, van, horario o duración utiliza “Reprogramar cita”, porque ese flujo exige registrar el motivo.');
    }
    const result = await updateWorkOrder(editingOrder.id, {
        clientId,
        propertyId: selectedProperty?.id,
        date: selectedDate,
        time,
        status: editingOrder.status,
        technicianIds: van.technicianIds,
        vanId,
        address: selectedProperty?.address ?? client.address,
        zone,
        problem: description,
        scheduledSlots: workHours,
        whatsappNotificationsEnabled: editingOrder.status === 'Reserva temporal' ? false : notificationsEnabled,
        notificationRecipients: notificationSnapshot,
                scheduleHistory: editingOrder.scheduleHistory,
        updatedAt: now,
      });
      setSaving(false);
      if (!result.ok) return setFormMessage(result.message ?? 'No se pudieron guardar los cambios de la cita.');
      setSelectedOrderId(editingOrder.id);
      setEditingOrderId(null);
    } else if (reschedulingOrder) {
      if (!pendingChangeReason) {
      setSaving(false);
      return setFormMessage('Registra el motivo de la reprogramación antes de guardar el nuevo horario.');
    }
    const history = scheduleHistoryEntry(reschedulingOrder, services, {
      ...pendingChangeReason,
      status: 'Reprogramada',
      newDate: selectedDate,
      newTime: time,
      newVanId: vanId,
    });
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
        whatsappNotificationsEnabled: status === 'Confirmada' ? notificationsEnabled : false,
        notificationRecipients: notificationSnapshot,
        confirmedAt: status === 'Confirmada' ? now : reschedulingOrder.confirmedAt,
        temporaryReservedAt: status === 'Reserva temporal' ? now : reschedulingOrder.temporaryReservedAt,
        scheduleHistory: [...(reschedulingOrder.scheduleHistory ?? []), history],
        updatedAt: now,
      });
      setSaving(false);
      if (!result.ok) return setFormMessage(result.message ?? 'No se pudo reprogramar la cita.');
      setSelectedOrderId(reschedulingOrder.id);
      setReschedulingOrderId(null);
      setPendingChangeReason(null);
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
        whatsappNotificationsEnabled: status === 'Confirmada' ? notificationsEnabled : false,
        notificationRecipients: notificationSnapshot,
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
    setNotificationRecipients([]);
    setShowCreate(false);
  };

  const confirmTemporaryAppointment = async (order: WorkOrder, enableWhatsApp: boolean) => {
    const now = new Date().toISOString();
    const hasSelectedRecipients = (order.notificationRecipients ?? []).some((recipient) => recipient.sendConfirmation || recipient.sendReminder);
    await updateWorkOrder(order.id, {
      status: 'Confirmada',
      whatsappNotificationsEnabled: enableWhatsApp && (order.notificationRecipients?.length ? hasSelectedRecipients : true),
      confirmedAt: now,
      updatedAt: now,
    });
  };

  const openAppointmentChangeReason = (order: WorkOrder, action: 'cancel' | 'reschedule') => {
  setChangeOrderId(order.id);
  setChangeAction(action);
  setChangeOrigin('Cliente');
  setChangeReasonCategory('');
  setChangeReasonNote('');
  setChangeReasonMessage('');
  setShowChangeReason(true);
};

const confirmAppointmentChangeReason = async () => {
  const order = workOrders.find((item) => item.id === changeOrderId);
  if (!order || !changeAction) return setChangeReasonMessage('No se encontró la cita seleccionada.');
  if (!changeReasonCategory) return setChangeReasonMessage('Selecciona el motivo principal.');
  if (changeReasonNote.trim().length < 5) return setChangeReasonMessage('Escribe una explicación breve del motivo del cambio.');

  const now = new Date().toISOString();
  const draft: AppointmentChangeDraft = {
    origin: changeOrigin,
    reasonCategory: changeReasonCategory,
    reasonNote: changeReasonNote.trim(),
    changedByUserId: currentUser?.id,
    changedByName: currentUser?.name ?? 'Usuario DEMAC',
    recordedAt: now,
    noticeHours: appointmentNoticeHours(order),
  };

  if (changeAction === 'cancel') {
    setSaving(true);
    const history = scheduleHistoryEntry(order, services, { ...draft, status: 'Cancelada' });
    const result = await updateWorkOrder(order.id, {
      status: 'Cancelada',
      whatsappNotificationsEnabled: false,
      cancelledAt: now,
      cancellationReason: `${changeReasonCategory}: ${changeReasonNote.trim()}`,
      scheduleHistory: [...(order.scheduleHistory ?? []), history],
      updatedAt: now,
    });
    setSaving(false);
    if (!result.ok) return setChangeReasonMessage(result.message ?? 'No se pudo cancelar la cita.');
    if (selectedOrderId === order.id) setSelectedOrderId(null);
    setShowChangeReason(false);
    setChangeOrderId(null);
    setChangeAction(null);
    return;
  }

  setPendingChangeReason(draft);
  setEditingOrderId(null);
  setReschedulingOrderId(order.id);
  setSelectedDate(order.date);
  setCalendarMonth(monthStart(order.date));
  setClientId(order.clientId);
  setPropertyId(order.propertyId ?? '');
  setWorkDescriptionText(order.problem);
  setWorkHours(orderSlotCount(order, services));
  setVanId(resolveStoredVanId(order.vanId, agendaVans, legacyVans));
  setTime(normalizeTime(order.time));
  setFormMessage('');
  setSuccessMessage('');
  setShowQuickClient(false);
  setShowChangeReason(false);
  setShowCreate(true);
};

const cancelAppointment = async (order: WorkOrder) => { openAppointmentChangeReason(order, 'cancel'); };

  const startEdit = (order: WorkOrder) => {
    setEditingOrderId(order.id);
    setReschedulingOrderId(null);
    setSelectedDate(order.date);
    setCalendarMonth(monthStart(order.date));
    setClientId(order.clientId);
    setPropertyId(order.propertyId ?? '');
    setWorkDescriptionText(order.problem);
    setWorkHours(orderSlotCount(order, services));
    setVanId(resolveStoredVanId(order.vanId, agendaVans, legacyVans));
    setTime(normalizeTime(order.time));
    setFormMessage('');
    setSuccessMessage('');
    setShowQuickClient(false);
    setShowCreate(true);
  };

  const startReschedule = (order: WorkOrder) => openAppointmentChangeReason(order, 'reschedule');

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {combinedDataError ? (
        <View style={styles.errorBanner}>
          <View style={{ flex: 1 }}><Text style={styles.errorTitle}>No se pudieron guardar o cargar los datos</Text><Text style={styles.errorText}>{combinedDataError}</Text></View>
          <Button compact variant="secondary" label="Reintentar" onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData(), refreshCalendarData(), refreshVanHalfDays()])} />
        </View>
      ) : null}

      <SectionTitle
        title="Agendar nueva cita"
        subtitle="Selecciona cliente, propiedad, duración, van y horario. Cada van tiene 3 horas en la mañana y 3 horas en la tarde."
        action={<Button label={selectedDateClosed ? 'Día cerrado' : 'Nueva cita'} icon={selectedDateClosed ? '🔒' : '＋'} disabled={selectedDateClosed} onPress={() => openCreate()} />}
      />

      {reschedulingOrder ? <View style={styles.rescheduleBanner}><View style={{ flex: 1 }}><Text style={styles.rescheduleTitle}>Modo reprogramación activo</Text><Text style={styles.rescheduleText}>Selecciona el nuevo día y después haz clic en un cupo disponible. El horario anterior quedará registrado en rojo como cancelado y reprogramado.</Text></View><Button compact variant="secondary" label="Cancelar reprogramación" onPress={() => setReschedulingOrderId(null)} /></View> : null}

      {selectedDateClosed ? <View style={styles.closedBanner}><View><Text style={styles.closedTitle}>Calendario cerrado para esta fecha</Text><Text style={styles.closedText}>{selectedCalendarStatus.reason}. Las citas existentes permanecen visibles, pero no se pueden crear citas nuevas.</Text></View></View> : null}

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
              <View style={styles.monthHeader}>
                <Pressable accessibilityLabel="Mes anterior" onPress={() => setCalendarMonth((current) => addMonths(current, -1))} style={styles.monthNavButton}><Text style={styles.monthNavText}>‹</Text></Pressable>
                <Text style={styles.monthTitle}>{monthTitle}</Text>
                <Pressable accessibilityLabel="Mes siguiente" onPress={() => setCalendarMonth((current) => addMonths(current, 1))} style={styles.monthNavButton}><Text style={styles.monthNavText}>›</Text></Pressable>
              </View>
              <View style={styles.calendarWeekHeader}>{['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'].map((label) => <Text key={label} style={styles.calendarWeekdayCell}>{label}</Text>)}</View>
              <View style={styles.calendarGrid}>{calendarCells.map((date, index) => {
                if (!date) return <View key={`empty-${index}`} style={styles.calendarEmptyDay} />;
                const active = date === selectedDate;
                const dateStatus = calendarDateStatus(date, businessCalendarSettings, calendarClosures);
                return <Pressable key={date} accessibilityLabel={formatDate(date, true)} onPress={() => setSelectedDate(date)} style={[styles.calendarDay, dateStatus.closed && styles.calendarDayClosed, active && styles.calendarDayActive]}><Text style={[styles.calendarNumber, active && styles.calendarDayTextActive]}>{Number(date.slice(-2))}</Text>{dateStatus.closed ? <Text style={[styles.calendarClosedLabel, active && styles.calendarDayTextActive]}>•</Text> : null}</Pressable>;
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
          {dataLoading || teamLoading || calendarLoading || halfDayLoading ? <Text style={styles.syncText}>Sincronizando agenda, equipo y calendario…</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} halfDay={isHalfDay(van.id)} extendedLayout={extendedDayLayout} users={staffDirectory} orders={activeOrders} cancelledSlots={cancelledSlots} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} onCreateFromCancelled={(record) => openCreate(van.id, record.slot, record)} closedReason={selectedDateClosed ? selectedCalendarStatus.reason : undefined} />)}</View>
          </ScrollView>
          <View style={styles.legendBar}><Text style={styles.legendTitle}>Leyenda de disponibilidad:</Text><Legend color="#EAF7E7" label="Disponible" /><Legend color="#EAF3FF" label="Cita confirmada" /><Legend color="#FFF4D8" label="Reserva temporal" /><Legend color="#FDECEC" label="Cancelado y disponible" /><Legend color="#FDECEC" label="No disponible" /></View>
        </Card>

        <Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} onConfirm={confirmTemporaryAppointment} onEdit={startEdit} onCancel={cancelAppointment} onReschedule={startReschedule} /></Card>
      </View>

      <AppModal
        visible={showCreate}
        title={showQuickClient ? 'Agregar cliente rápido' : showQuickProperty ? 'Añadir propiedad' : showQuickContact ? 'Añadir persona encargada' : editingOrder ? 'Editar cita' : reschedulingOrder ? 'Reprogramar cita' : 'Confirmar nueva cita'}
        onClose={() => {
          if (showQuickClient) {
  if (!quickClientSaving) setShowQuickClient(false);
  return;
}
if (showQuickProperty) {
  if (!quickPropertySaving) setShowQuickProperty(false);
  return;
}
if (showQuickContact) {
  if (!quickContactSaving) setShowQuickContact(false);
  return;
}
if (!saving) {
            setShowCreate(false);
            setEditingOrderId(null);
            setReschedulingOrderId(null);
            setPendingChangeReason(null);
          }
        }}
      >
        {showQuickClient ? (
          <ScrollView>
            <Text style={styles.modalIntro}>Registra el cliente y su primera propiedad sin salir de la agenda. Al guardar, quedarán seleccionados automáticamente en la cita.</Text>
            {quickClientMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{quickClientMessage}</Text></View> : null}
            <Input label="Nombre completo o empresa" value={quickClient.name} onChangeText={(name) => setQuickClient({ ...quickClient, name })} placeholder="Ej. María Pérez o Empresa ABC" />
            <Input label="Empresa (opcional)" value={quickClient.company} onChangeText={(company) => setQuickClient({ ...quickClient, company })} placeholder="Déjalo vacío si es cliente residencial" />
            <View style={styles.twoColumnFields}>
              <View style={styles.halfField}><PhoneField label="Teléfono" value={quickClient.phone} country={quickClient.phoneCountry} onChangeText={(phone) => setQuickClient({ ...quickClient, phone })} onCountryChange={(phoneCountry) => setQuickClient((current) => ({ ...current, phoneCountry }))} /></View>
              <View style={styles.halfField}><PhoneField label="WhatsApp" value={quickClient.whatsapp} country={quickClient.whatsappCountry} onChangeText={(whatsapp) => setQuickClient({ ...quickClient, whatsapp })} onCountryChange={(whatsappCountry) => setQuickClient((current) => ({ ...current, whatsappCountry }))} placeholder="Si queda vacío, usaremos el teléfono" /></View>
            </View>
            <Text style={styles.quickFieldLabel}>Idioma preferido</Text>
            <View style={styles.optionWrap}>{propertyContactLanguages.map((preferredLanguage) => <Option key={preferredLanguage} label={preferredLanguage} active={quickClient.preferredLanguage === preferredLanguage} onPress={() => setQuickClient({ ...quickClient, preferredLanguage })} />)}</View>
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
        ) : showQuickProperty ? (
<ScrollView>
  <Text style={styles.modalIntro}>Registra otra propiedad para {selectedClient?.name ?? 'el cliente'} sin salir de la cita. Al guardar quedará seleccionada automáticamente.</Text>
  {quickPropertyMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{quickPropertyMessage}</Text></View> : null}
  <Input label="Nombre para identificarla" value={quickProperty.name} onChangeText={(name) => setQuickProperty({ ...quickProperty, name })} placeholder="Ej. Bowling, Oficina principal o Apartamento 4B" />
  <Text style={styles.quickFieldLabel}>Tipo de propiedad</Text>
  <View style={styles.optionWrap}>{propertyTypes.map((type) => <Option key={type} label={type} active={quickProperty.type === type} onPress={() => setQuickProperty({ ...quickProperty, type })} />)}</View>
  <Input label="Dirección" value={quickProperty.address} onChangeText={(address) => setQuickProperty({ ...quickProperty, address })} placeholder="Calle, número y referencia" />
  <Input label="Zona" value={quickProperty.zone} onChangeText={(zone) => setQuickProperty({ ...quickProperty, zone })} placeholder="Ej. Oranjestad, Noord o Santa Cruz" />
  <Input label="Notas de acceso (opcional)" value={quickProperty.notes} onChangeText={(notes) => setQuickProperty({ ...quickProperty, notes })} multiline placeholder="Ej. Entrada por el portón lateral, llamar al llegar…" />
  <View style={styles.modalActions}>
    <Button variant="secondary" label="Volver a la cita" disabled={quickPropertySaving} onPress={() => setShowQuickProperty(false)} />
    <Button label={quickPropertySaving ? 'Guardando…' : 'Guardar y seleccionar'} disabled={quickPropertySaving} onPress={() => void saveQuickProperty()} />
  </View>
</ScrollView>
        ) : showQuickContact ? (
<ScrollView>
  <Text style={styles.modalIntro}>Añade una persona relacionada con {selectedProperty?.name ?? 'esta propiedad'}. En el próximo módulo podrás decidir si recibe confirmaciones, recordatorios o ambos.</Text>
  {quickContactMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{quickContactMessage}</Text></View> : null}
  <Input label="Nombre completo" value={quickContact.name} onChangeText={(name) => setQuickContact({ ...quickContact, name })} placeholder="Ej. Omar Pérez" />
  <Text style={styles.quickFieldLabel}>Función en la propiedad</Text>
  <View style={styles.optionWrap}>{propertyContactRoles.map((role) => <Option key={role} label={role} active={quickContact.role === role} onPress={() => setQuickContact({ ...quickContact, role })} />)}</View>
  <View style={styles.twoColumnFields}>
    <View style={styles.halfField}><PhoneField label="Teléfono" value={quickContact.phone} country={quickContact.phoneCountry} onChangeText={(phone) => setQuickContact({ ...quickContact, phone })} onCountryChange={(phoneCountry) => setQuickContact((current) => ({ ...current, phoneCountry }))} /></View>
    <View style={styles.halfField}><PhoneField label="WhatsApp" value={quickContact.whatsapp} country={quickContact.whatsappCountry} onChangeText={(whatsapp) => setQuickContact({ ...quickContact, whatsapp })} onCountryChange={(whatsappCountry) => setQuickContact((current) => ({ ...current, whatsappCountry }))} placeholder="Si queda vacío, usaremos el teléfono" /></View>
  </View>
  <Input label="Correo electrónico (opcional)" value={quickContact.email} onChangeText={(email) => setQuickContact({ ...quickContact, email })} keyboardType="email-address" />
  <Text style={styles.quickFieldLabel}>Idioma preferido</Text>
  <View style={styles.optionWrap}>{propertyContactLanguages.map((language) => <Option key={language} label={language} active={quickContact.preferredLanguage === language} onPress={() => setQuickContact({ ...quickContact, preferredLanguage: language })} />)}</View>
  <Text style={styles.quickFieldLabel}>Preferencias operativas</Text>
  <View style={styles.optionWrap}><Option label="Confirmación por defecto" active={quickContact.defaultSendConfirmation} onPress={() => setQuickContact({ ...quickContact, defaultSendConfirmation: !quickContact.defaultSendConfirmation })} /><Option label="Recordatorio por defecto" active={quickContact.defaultSendReminder} onPress={() => setQuickContact({ ...quickContact, defaultSendReminder: !quickContact.defaultSendReminder })} /><Option label="Contacto para llamar al llegar" active={quickContact.arrivalContact} onPress={() => setQuickContact({ ...quickContact, arrivalContact: !quickContact.arrivalContact })} /></View>
  <View style={styles.modalActions}>
    <Button variant="secondary" label="Volver a la cita" disabled={quickContactSaving} onPress={() => setShowQuickContact(false)} />
    <Button label={quickContactSaving ? 'Guardando…' : 'Guardar persona'} disabled={quickContactSaving} onPress={() => void saveQuickContact()} />
  </View>
</ScrollView>
        ) : (
<ScrollView>
            <Text style={styles.modalIntro}>Selecciona el cliente y la propiedad, define cuántas horas ocupará el trabajo y escribe toda la descripción necesaria.</Text>
            {reschedulingOrder ? (
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 15 }}>
                <Text style={styles.quickSectionTitle}>Nueva fecha de la cita</Text>
                <Text style={styles.fallbackText}>Fecha seleccionada: {formatDate(selectedDate, true)}</Text>
                <View style={styles.monthHeader}>
                  <Pressable accessibilityLabel="Mes anterior" onPress={() => setCalendarMonth((current) => addMonths(current, -1))} style={styles.monthNavButton}><Text style={styles.monthNavText}>‹</Text></Pressable>
                  <Text style={styles.monthTitle}>{monthTitle}</Text>
                  <Pressable accessibilityLabel="Mes siguiente" onPress={() => setCalendarMonth((current) => addMonths(current, 1))} style={styles.monthNavButton}><Text style={styles.monthNavText}>›</Text></Pressable>
                </View>
                <View style={styles.calendarWeekHeader}>{['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'].map((label) => <Text key={`reschedule-${label}`} style={styles.calendarWeekdayCell}>{label}</Text>)}</View>
                <View style={styles.calendarGrid}>{calendarCells.map((date, index) => {
                  if (!date) return <View key={`reschedule-empty-${index}`} style={styles.calendarEmptyDay} />;
                  const active = date === selectedDate;
                  const dateStatus = calendarDateStatus(date, businessCalendarSettings, calendarClosures);
                  return <Pressable key={`reschedule-${date}`} disabled={dateStatus.closed} accessibilityLabel={formatDate(date, true)} onPress={() => setSelectedDate(date)} style={[styles.calendarDay, dateStatus.closed && styles.calendarDayClosed, active && styles.calendarDayActive]}><Text style={[styles.calendarNumber, active && styles.calendarDayTextActive]}>{Number(date.slice(-2))}</Text>{dateStatus.closed ? <Text style={[styles.calendarClosedLabel, active && styles.calendarDayTextActive]}>•</Text> : null}</Pressable>;
                })}</View>
              </View>
            ) : null}
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

                        <View style={styles.inlineFieldHeader}>
    <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>Propiedad / lugar de servicio</Text>
    <Button compact variant="secondary" label="Añadir propiedad" icon="＋" disabled={!selectedClient} onPress={openQuickProperty} />
  </View>
  {clientProperties.length ? <View style={styles.optionWrap}>{clientProperties.map((property) => <Option key={property.id} label={`${property.name} · ${property.address} · ${property.zone}`} active={propertyId === property.id} onPress={() => { setPropertyId(property.id); setSuccessMessage(''); }} />)}</View> : selectedClient ? <Text style={styles.fallbackText}>Este cliente todavía no tiene propiedades. Presiona “Añadir propiedad”.</Text> : <Text style={styles.fallbackText}>Selecciona o registra un cliente para escoger la propiedad.</Text>}

  {selectedProperty ? (
    <View style={styles.propertyContactsPanel}>
      <View style={styles.inlineFieldHeader}>
        <View><Text style={styles.propertyContactsTitle}>Personas vinculadas a esta propiedad</Text><Text style={styles.propertyContactsHelp}>Encargados, administradores, acceso o contabilidad.</Text></View>
        <Button compact variant="secondary" label="Añadir persona" icon="＋" onPress={openQuickContact} />
      </View>
      {selectedPropertyContacts.length ? selectedPropertyContacts.map((contact) => (
        <View key={contact.id} style={styles.propertyContactRow}>
          <View style={{ flex: 1 }}><Text style={styles.propertyContactName}>{contact.name}</Text><Text style={styles.propertyContactMeta}>{contact.role} · WhatsApp {contact.whatsapp || contact.phone} · {contact.preferredLanguage}{contact.arrivalContact ? ' · Llamar al llegar' : ''}</Text></View>
        </View>
      )) : <Text style={styles.fallbackText}>Todavía no hay personas registradas para esta propiedad.</Text>}
    </View>
  ) : null}

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
            <View style={styles.optionWrap}>{(selectedVan && isHalfDay(selectedVan.id) ? [...morningSlots, extraMorningSlot] : allSlots).map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>

            <Text style={styles.stepLabel}>6</Text>
            <Input label="Descripción del trabajo" value={workDescriptionText} onChangeText={setWorkDescriptionText} multiline placeholder="Ej. Dos servicios estándar, diagnóstico de una unidad e instalación de otra. Agrega instrucciones de acceso, contacto, síntomas y cualquier detalle necesario…" />

            <Text style={styles.fieldLabel}>Notificaciones por WhatsApp</Text>
  <Text style={styles.notificationHelp}>Selecciona de forma independiente quién recibe la confirmación y quién recibe el recordatorio. Las reservas temporales guardan esta selección, pero no envían mensajes hasta que la cita sea confirmada.</Text>
  <View style={styles.notificationMatrix}>
    <View style={[styles.notificationRow, styles.notificationHeaderRow]}>
      <Text style={[styles.notificationHeaderText, { flex: 1 }]}>Destinatario</Text>
      <Text style={styles.notificationColumnHeader}>Confirmar cita</Text>
      <Text style={styles.notificationColumnHeader}>Recordar cita</Text>
    </View>
    {notificationRecipients.map((recipient) => (
      <View key={recipient.id} style={styles.notificationRow}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Text style={styles.notificationName}>{recipient.name}</Text>
          <Text style={styles.notificationMeta}>{recipient.role} · {recipient.whatsapp || recipient.phone} · {recipient.preferredLanguage}</Text>
        </View>
        <Pressable accessibilityLabel={`Confirmación para ${recipient.name}`} onPress={() => toggleNotificationRecipient(recipient.id, 'sendConfirmation')} style={[styles.notificationCheck, recipient.sendConfirmation && styles.notificationCheckActive]}><Text style={[styles.notificationCheckText, recipient.sendConfirmation && styles.notificationCheckTextActive]}>{recipient.sendConfirmation ? '✓' : ''}</Text></Pressable>
        <Pressable accessibilityLabel={`Recordatorio para ${recipient.name}`} onPress={() => toggleNotificationRecipient(recipient.id, 'sendReminder')} style={[styles.notificationCheck, recipient.sendReminder && styles.notificationCheckActive]}><Text style={[styles.notificationCheckText, recipient.sendReminder && styles.notificationCheckTextActive]}>{recipient.sendReminder ? '✓' : ''}</Text></Pressable>
      </View>
    ))}
    {!notificationRecipients.length ? <Text style={styles.notificationEmpty}>Selecciona un cliente o registra una persona con WhatsApp.</Text> : null}
  </View>
  {notificationRecipients.some((recipient) => recipient.sendConfirmation || recipient.sendReminder) ? null : <Text style={styles.notificationDisabledText}>No se enviarán mensajes de WhatsApp para esta cita.</Text>}

            <View style={styles.summaryBox}><Text style={styles.summaryTitle}>Resumen de la cita</Text><Text style={styles.summaryLine}>{selectedClient?.name ?? 'Sin cliente'} · {selectedProperty?.name ?? selectedClient?.address ?? 'Sin dirección'}</Text><Text style={styles.summaryLine}>{workHours} hora{workHours !== 1 ? 's' : ''} · {selectedVan?.name} · {formatDate(selectedDate)} · {time}</Text><Text style={styles.summaryLine} numberOfLines={2}>{workDescriptionText.trim() || 'Falta agregar la descripción del trabajo.'}</Text></View>
            <View style={styles.modalActions}>
              <Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => { setShowCreate(false); setEditingOrderId(null); setReschedulingOrderId(null); setPendingChangeReason(null); }} />
              {editingOrder ? (
                <Button label={saving ? 'Guardando…' : 'Guardar cambios'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment(editingOrder.status === 'Reserva temporal' ? 'Reserva temporal' : 'Confirmada')} />
              ) : (
                <>
                  <Button variant="secondary" label={saving ? 'Guardando…' : 'Reservar temporalmente'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment('Reserva temporal')} />
                  <Button label={saving ? 'Guardando…' : reschedulingOrder ? 'Guardar reprogramación' : 'Confirmar cita'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment('Confirmada')} />
                </>
              )}
            </View>
          </ScrollView>
        )}
            </AppModal>

  <AppModal
    visible={showChangeReason}
    title={changeAction === 'reschedule' ? 'Motivo de la reprogramación' : 'Motivo de la cancelación'}
    onClose={() => {
      if (saving) return;
      setShowChangeReason(false);
      setChangeOrderId(null);
      setChangeAction(null);
      setChangeReasonMessage('');
    }}
  >
    <ScrollView>
      <Text style={styles.modalIntro}>Este registro es obligatorio y quedará visible en el historial del cliente para fines operativos y de auditoría.</Text>
      {changeReasonMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{changeReasonMessage}</Text></View> : null}

      <Text style={styles.fieldLabel}>Quién originó el cambio</Text>
      <View style={styles.optionWrap}>{appointmentChangeOrigins.map((origin) => <Option key={origin} label={origin} active={changeOrigin === origin} onPress={() => setChangeOrigin(origin)} />)}</View>

      <Text style={styles.fieldLabel}>Motivo principal</Text>
      <View style={styles.optionWrap}>{appointmentChangeReasons.map((reason) => <Option key={reason} label={reason} active={changeReasonCategory === reason} onPress={() => setChangeReasonCategory(reason)} />)}</View>

      <Input
        label="Explicación del operador"
        value={changeReasonNote}
        onChangeText={setChangeReasonNote}
        multiline
        placeholder="Ej. La clienta solicitó mover la cita porque el encargado de la propiedad no estará presente."
      />

      <View style={styles.modalActions}>
        <Button variant="secondary" label="Volver" disabled={saving} onPress={() => { setShowChangeReason(false); setChangeOrderId(null); setChangeAction(null); }} />
        <Button
          variant={changeAction === 'cancel' ? 'danger' : 'primary'}
          label={saving ? 'Guardando…' : changeAction === 'reschedule' ? 'Continuar a reprogramar' : 'Confirmar cancelación'}
          disabled={saving}
          onPress={() => void confirmAppointmentChangeReason()}
        />
      </View>
    </ScrollView>
  </AppModal>
</ScrollView>
  );
}

function VanColumn({ van, halfDay, extendedLayout, users, orders, cancelledSlots, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, onCreateFromCancelled, closedReason }: { van: AgendaVan; halfDay: boolean; extendedLayout: boolean; users: { id: string; name: string }[]; orders: WorkOrder[]; cancelledSlots: CancelledSlotRecord[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void; onCreateFromCancelled: (record: CancelledSlotRecord) => void; closedReason?: string }) {
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

function AppointmentDetails({ order, halfDay, clients, properties, services, vans, users, onUpdate, onConfirm, onEdit, onCancel, onReschedule }: { order?: WorkOrder; halfDay: boolean; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }>; onConfirm: (order: WorkOrder, enableWhatsApp: boolean) => Promise<void>; onEdit: (order: WorkOrder) => void; onCancel: (order: WorkOrder) => Promise<void>; onReschedule: (order: WorkOrder) => void }) {
  if (!order) return <View style={styles.emptyDetails}><Text style={styles.detailTitle}>Detalles de la cita</Text><Text style={styles.detailMuted}>Selecciona una cita para ver la información completa.</Text></View>;
  const client = clients.find((item) => item.id === order.clientId);
  const property = properties.find((item) => item.id === order.propertyId);
  const service = services.find((item) => item.id === order.serviceId);
  const van = vans.find((item) => item.id === order.vanId);
  const slots = orderSlotCount(order, services);
  const techNames = order.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';
  const confirmationNames = (order.notificationRecipients ?? []).filter((recipient) => recipient.sendConfirmation).map((recipient) => recipient.name).join(', ');
  const reminderNames = (order.notificationRecipients ?? []).filter((recipient) => recipient.sendReminder).map((recipient) => recipient.name).join(', ');
  return <View><View style={styles.detailHeader}><Pill label={order.status} tone={toneForStatus(order.status)} /><Text style={styles.detailId}>ID: {order.id}</Text></View><Text style={styles.detailTitle}>{client?.name}</Text><Text style={styles.detailSubtitle}>{service?.name ?? 'Trabajo programado'}</Text><View style={styles.detailTabs}><Text style={styles.detailTabActive}>Detalles</Text><Text style={styles.detailTab}>Cliente</Text><Text style={styles.detailTab}>Notas</Text></View><DetailRow label="Fecha y hora" value={`${formatDate(order.date, true)} · ${scheduleRangeForOrder(order, services, halfDay)}`} /><DetailRow label="Duración" value={`${slots} hora${slots !== 1 ? 's' : ''}`} /><DetailRow label="Propiedad" value={property?.name} /><DetailRow label="Dirección" value={order.address} /><DetailRow label="Zona" value={order.zone ?? property?.zone ?? client?.zone} /><DetailRow label="Técnico asignado" value={techNames} /><DetailRow label="Van asignada" value={van?.name ?? 'Sin van'} /><DetailRow label="Descripción del trabajo" value={orderDescription(order, service)} /><DetailRow label="Confirmación WhatsApp" value={confirmationNames || (order.whatsappNotificationsEnabled !== false ? client?.name : 'No enviar')} /><DetailRow label="Recordatorio WhatsApp" value={reminderNames || (order.whatsappNotificationsEnabled !== false ? client?.name : 'No enviar')} />{order.airConditionerCount ? <DetailRow label="Cantidad de aires (cita anterior)" value={String(order.airConditionerCount)} /> : null}<View style={styles.detailActions}>{order.status === 'Reserva temporal' ? <><Button variant="success" label="Confirmar y enviar WhatsApp" onPress={() => void onConfirm(order, true)} /><Button variant="secondary" label="Confirmar sin WhatsApp" onPress={() => void onConfirm(order, false)} /></> : null}<Button variant="secondary" label="Editar cita" onPress={() => onEdit(order)} /><Button variant="secondary" label="Reprogramar cita" onPress={() => onReschedule(order)} /><Button variant="danger" label="Cancelar cita" onPress={() => void onCancel(order)} />{order.status !== 'Reserva temporal' ? <Button label="Marcar completada" onPress={() => void onUpdate(order.id, { status: 'Completada', updatedAt: new Date().toISOString() })} /> : null}</View></View>;
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
  closedBanner: { borderWidth: 1, borderColor: '#E8A9A7', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 14 },
  closedTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  closedText: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },
  rescheduleBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#B9D7FF', backgroundColor: colors.infoLight, borderRadius: 10, padding: 14 },
  rescheduleTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  rescheduleText: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },
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
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  monthTitle: { color: colors.text, fontWeight: '900', fontSize: 15, textTransform: 'capitalize', textAlign: 'center' },
  monthNavButton: { width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  monthNavText: { color: colors.text, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  calendarWeekHeader: { flexDirection: 'row', gap: 3, marginBottom: 4 },
  calendarWeekdayCell: { width: 28, color: colors.muted, fontSize: 7, fontWeight: '900', textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  calendarEmptyDay: { width: 28, height: 34 },
  calendarDay: { width: 28, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', position: 'relative' },
  calendarDayClosed: { backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#E8A9A7' },
  calendarDayActive: { backgroundColor: colors.primary },
  calendarNumber: { color: colors.text, fontWeight: '900', fontSize: 10 },
  calendarDayTextActive: { color: '#FFFFFF' },
  calendarClosedLabel: { position: 'absolute', bottom: 1, color: colors.danger, fontSize: 8, fontWeight: '900' },
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
  slotTemporary: { borderColor: '#E5C15A', backgroundColor: '#FFF8E5' },
  slotCancelledAvailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotUnavailable: { borderColor: '#F2B8B5', backgroundColor: colors.dangerLight },
  slotSelected: { borderColor: colors.primary, borderWidth: 2 },
  slotTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, alignItems: 'center', minHeight: 18, marginBottom: 2 },
  slotTime: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  availableText: { color: colors.primary, fontWeight: '900', fontSize: 12, marginTop: 5 },
  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 12, marginTop: 5 },
  cancelledTitle: { color: colors.danger, fontWeight: '900', fontSize: 10, marginTop: 4 },
  cancelledClient: { color: colors.text, fontWeight: '900', fontSize: 10, marginTop: 4, paddingRight: 18 },
  cancelledDescription: { color: colors.muted, fontSize: 8, marginTop: 3, paddingRight: 18 },
  closedSlotReason: { color: colors.muted, fontSize: 9, lineHeight: 12, marginTop: 5, textAlign: 'center' },
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
  inlineFieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4, marginBottom: 8, flexWrap: 'wrap' },
  propertyContactsPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: '#FAFBFC', padding: 11, marginBottom: 15 },
  propertyContactsTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  propertyContactsHelp: { color: colors.muted, fontSize: 9, marginTop: 2 },
  propertyContactRow: { flexDirection: 'row', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E8EBEF' },
  propertyContactName: { color: colors.text, fontWeight: '900', fontSize: 10 },
  propertyContactMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  notificationHelp: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: -3, marginBottom: 10, paddingLeft: 24 },
  notificationMatrix: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden', backgroundColor: '#FFFFFF', marginBottom: 8 },
  notificationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 11, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#E8EBEF' },
  notificationHeaderRow: { borderTopWidth: 0, backgroundColor: '#F4F6F8' },
  notificationHeaderText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  notificationColumnHeader: { width: 82, color: colors.muted, fontSize: 8, fontWeight: '900', textAlign: 'center' },
  notificationName: { color: colors.text, fontSize: 10, fontWeight: '900' },
  notificationMeta: { color: colors.muted, fontSize: 8, marginTop: 3 },
  notificationCheck: { width: 34, height: 34, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginHorizontal: 24 },
  notificationCheckActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  notificationCheckText: { color: colors.muted, fontSize: 17, fontWeight: '900' },
  notificationCheckTextActive: { color: '#FFFFFF' },
  notificationEmpty: { color: colors.muted, fontSize: 10, padding: 12 },
  notificationDisabledText: { color: colors.warning, fontSize: 10, fontWeight: '800', marginBottom: 12 },
  summaryBox: { backgroundColor: '#F4F5F7', borderRadius: 10, padding: 13, marginTop: 8 },
  summaryTitle: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 6 },
  summaryLine: { color: colors.muted, fontSize: 10, marginTop: 3 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15, flexWrap: 'wrap' },
});