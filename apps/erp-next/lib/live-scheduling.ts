import type { BrowserAppointmentRecord } from './browser-operational';
import type { CalendarDispatchJob } from './scheduling-capacity';
import { getRuntimeSchedulingSettings } from './scheduling';
import type { DaySegment, WorkPresetId } from './scheduling';
import { listFirestoreCollection } from './firebase/firestore-rest';
import { listOfficeAppointmentAttribution, type OfficeAppointmentAttribution } from './office-booking-authority';
import {
  liveVanHalfDaySchedule,
  loadLiveOperationalCapacityState,
  type LiveOperationalCapacityState,
} from './live-operational-capacity';

// BrowserAppointmentRecord still carries the old WorkPresetId for compatibility
// with browser-only lifecycle helpers. The live work identity is preserved
// separately as workTypeId/workLabel and is never derived from this list.
const LEGACY_BROWSER_PRESETS = new Set<WorkPresetId>([
  'standard_service',
  'deep_cleaning',
  'diagnostic',
  'repair',
  'installation_standard',
  'installation_extended',
  'installation_rooftop',
  'installation_second_floor',
  'installation_third_floor',
  'anti_corrosive',
  'other',
]);

const CANONICAL_VAN_IDS = new Set(['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4']);

type LiveWorkItem = {
  id?: string;
  presetId?: string;
  serviceId?: string;
  label?: string;
  quantity?: number;
  durationMinutes?: number;
  durationMinutesPerUnit?: number;
  durationMode?: string;
};

type LiveWorkOrder = {
  id: string;
  appointmentId?: string;
  appointmentType?: string;
  appointmentWorkType?: string;
  appointmentPresetId?: string;
  appointmentWorkLabel?: string;
  appointmentWorkItems?: LiveWorkItem[];
  appointmentAssignmentRole?: string;
  appointmentEndTime?: string;
  parentWorkOrderId?: string;
  airConditionerCount?: number;
  assignmentRole?: string;
  supportForWorkOrderId?: string;
  clientId?: string;
  propertyId?: string;
  serviceId?: string;
  presetId?: string;
  quantity?: number;
  date?: string;
  time?: string;
  duration?: number;
  appointmentDurationMinutes?: number;
  address?: string;
  zone?: string;
  operationalZone?: string;
  vanId?: string;
  van?: string;
  scheduledSlots?: number | string[];
  problem?: string;
  customerFacingDescription?: string;
  customerFacingDescriptionIsDefault?: boolean;
  status?: string;
  source?: string;
  confirmedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LiveClient = {
  id: string;
  name?: string;
  company?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  preferredLanguage?: string;
};

type LiveProperty = {
  id: string;
  name?: string;
  address?: string;
  zone?: string;
  operationalZone?: string;
  accessInstructions?: string;
};

export type LiveVan = {
  id: string;
  name?: string;
  label?: string;
  code?: string;
  number?: number | string;
  vanNumber?: number | string;
  unitNumber?: number | string;
  active?: boolean;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : fallback;
}

function legacyBrowserPresetId(value: unknown): WorkPresetId {
  const candidate = text(value) as WorkPresetId;
  return LEGACY_BROWSER_PRESETS.has(candidate) ? candidate : 'other';
}

function workOrderWorkTypeId(order: LiveWorkOrder) {
  return text(order.appointmentPresetId || order.appointmentWorkType || order.presetId) || 'other';
}

function humanizeWorkType(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workOrderWorkLabel(order: LiveWorkOrder) {
  const item = Array.isArray(order.appointmentWorkItems) ? order.appointmentWorkItems[0] : undefined;
  return text(order.appointmentWorkLabel) || text(item?.label) || humanizeWorkType(workOrderWorkTypeId(order));
}

function canonicalVanIdFromValue(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const upper = raw.toUpperCase().replaceAll('_', '-').replace(/\s+/g, '-');
  if (CANONICAL_VAN_IDS.has(upper)) return upper;
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = compact.match(/^(?:van|v)([1-4])$/);
  return match ? `VAN-${match[1]}` : '';
}

function canonicalVanIdFromRecord(van: LiveVan | undefined) {
  if (!van) return '';
  const numericCandidates = [van.number, van.vanNumber, van.unitNumber]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 4);
  if (numericCandidates.length) return `VAN-${numericCandidates[0]}`;
  for (const candidate of [van.id, van.code, van.name, van.label]) {
    const canonical = canonicalVanIdFromValue(candidate);
    if (canonical) return canonical;
  }
  return '';
}

export function resolveCanonicalVanId(value: unknown, vans: LiveVan[] = []) {
  const direct = canonicalVanIdFromValue(value);
  if (direct) return direct;
  const raw = text(value);
  if (!raw) return '';
  const matchingRecord = vans.find((van) => van.id === raw);
  return canonicalVanIdFromRecord(matchingRecord);
}

function workOrderVanId(order: LiveWorkOrder, vans: LiveVan[] = []) {
  return resolveCanonicalVanId(order.vanId || order.van, vans);
}

function workOrderPresetId(order: LiveWorkOrder) {
  return legacyBrowserPresetId(workOrderWorkTypeId(order));
}

function workOrderAssignmentRole(order: LiveWorkOrder) {
  return text(order.appointmentAssignmentRole || order.assignmentRole).toLowerCase();
}

function workOrderSupportForId(order: LiveWorkOrder) {
  return text(order.parentWorkOrderId || order.supportForWorkOrderId);
}

function workOrderQuantity(order: LiveWorkOrder) {
  return positiveInteger(order.airConditionerCount ?? order.quantity);
}

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(value: number) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

function validTime(value: unknown) {
  const candidate = text(value);
  return /^\d{2}:\d{2}$/.test(candidate) ? candidate : '';
}

function normalizedSlots(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((slot) => /^\d{2}:\d{2}$/.test(slot)).sort();
}

function numericSlotCount(value: unknown) {
  if (Array.isArray(value)) return 0;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.max(1, Math.min(12, Math.ceil(count))) : 0;
}

function canonicalSlotStarts(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
) {
  const regular = getRuntimeSchedulingSettings().serviceStartTimes;
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (!halfDay) return regular;
  const windowStart = timeToMinutes(validTime(halfDay.workdayStart) || '08:00');
  const windowEnd = timeToMinutes(validTime(halfDay.workdayEnd) || '13:00');
  const extraMorning = validTime(halfDay.extraMorningSlot) || '11:30';
  return [...new Set([...regular, extraMorning])]
    .filter((slot) => {
      const minute = timeToMinutes(slot);
      return minute >= windowStart && minute < windowEnd;
    })
    .sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
}

function endFromCanonicalSlotCount(
  start: string,
  count: number,
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
) {
  const schedule = canonicalSlotStarts(state, vanId, dateKey);
  const index = schedule.indexOf(start);
  if (index >= 0 && index + count <= schedule.length) {
    const lastStart = schedule[index + count - 1];
    return minutesToTime(timeToMinutes(lastStart) + 60);
  }
  return minutesToTime(timeToMinutes(start) + count * 60);
}

function assignmentEnd(
  order: LiveWorkOrder,
  vans: LiveVan[],
  operationalState: LiveOperationalCapacityState | null,
) {
  const start = text(order.time) || '08:30';

  // Canonical capacity is the authority. Older records can contain a stale
  // appointmentEndTime generated with the regular-day slot map even though their
  // scheduledSlots correctly reflect a half-day Van. Prefer the reserved slots so
  // LIVE heals those records at projection time instead of displaying fake capacity.
  const slots = normalizedSlots(order.scheduledSlots);
  if (slots.length) return minutesToTime(timeToMinutes(slots[slots.length - 1]) + 60);

  const slotCount = numericSlotCount(order.scheduledSlots);
  if (slotCount) {
    return endFromCanonicalSlotCount(
      start,
      slotCount,
      operationalState,
      workOrderVanId(order, vans),
      text(order.date),
    );
  }

  const explicit = validTime(order.appointmentEndTime);
  if (explicit && timeToMinutes(explicit) > timeToMinutes(start)) return explicit;

  // Final compatibility fallback for historical records that predate slot snapshots.
  const duration = positiveInteger(order.appointmentDurationMinutes ?? order.duration, 60);
  return minutesToTime(timeToMinutes(start) + duration);
}

function daySegment(start: string, end: string): DaySegment {
  if (timeToMinutes(start) < 12 * 60 && timeToMinutes(end) > 13 * 60) return 'full_day';
  return timeToMinutes(start) < 12 * 60 ? 'am' : 'pm';
}

function normalizedStatus(status: unknown) {
  return text(status).toLowerCase();
}

function isCancelled(status: unknown) {
  return ['cancelada', 'cancelled', 'canceled'].includes(normalizedStatus(status));
}

function isTemporaryHold(status: unknown) {
  return ['reserva temporal', 'temporary_hold', 'temporary hold'].includes(normalizedStatus(status));
}

function projectedStatus(status: unknown): CalendarDispatchJob['status'] {
  if (isCancelled(status)) return 'cancelled';
  return isTemporaryHold(status) ? 'temporary_hold' : 'confirmed';
}

function cleanCustomerDescription(problem: unknown, fallback: string) {
  const raw = text(problem).replace(/^cita confirmada:\s*/i, '').replace(/\.$/, '').trim();
  return raw || fallback;
}

function clientLabel(client: LiveClient | undefined, fallbackId: string) {
  return text(client?.name) || text(client?.company) || fallbackId || 'Customer';
}

function propertyLabel(property: LiveProperty | undefined, fallbackId: string) {
  return text(property?.name) || text(property?.address) || fallbackId || 'Property';
}

function firstWorkItem(order: LiveWorkOrder) {
  return Array.isArray(order.appointmentWorkItems) ? order.appointmentWorkItems[0] : undefined;
}

function durationPerUnit(order: LiveWorkOrder) {
  const item = firstWorkItem(order);
  const explicit = Number(item?.durationMinutesPerUnit || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const total = Number(order.appointmentDurationMinutes || order.duration || 0);
  const quantity = workOrderQuantity(order);
  return total > 0 && quantity > 0 ? Math.round(total / quantity) : 0;
}

export function bookingActorLabel(appointment: OfficeAppointmentAttribution | undefined) {
  if (!appointment) return '';
  const source = text(appointment.source).toLowerCase();
  if (source === 'demac-customer-agent') return 'Maya';
  return text(appointment.createdByName) || (source === 'office-scheduling' ? 'Office' : '');
}

function workOrderAssignment(
  order: LiveWorkOrder,
  customer: string,
  site: string,
  sector: string,
  vans: LiveVan[],
  operationalState: LiveOperationalCapacityState | null,
): CalendarDispatchJob {
  const legacySlots = normalizedSlots(order.scheduledSlots);
  const start = text(order.time) || legacySlots[0] || '08:30';
  const end = assignmentEnd({ ...order, time: start }, vans, operationalState);
  const role = workOrderAssignmentRole(order);
  const primary = role !== 'support';
  const supportForJobId = workOrderSupportForId(order);
  return {
    id: order.id,
    dateKey: text(order.date),
    customer,
    site,
    sector,
    start,
    end,
    segment: daySegment(start, end),
    vanId: workOrderVanId(order, vans) || 'UNASSIGNED',
    presetId: workOrderPresetId(order),
    quantity: workOrderQuantity(order),
    status: projectedStatus(order.status),
    readiness: 'not_checked',
    isPrimaryAssignment: primary,
    customerCommunicationOwner: primary,
    ...(primary || !supportForJobId ? {} : { supportForJobId }),
  };
}

export function projectLiveSchedulingAppointments(
  workOrders: LiveWorkOrder[],
  clients: LiveClient[],
  properties: LiveProperty[],
  vans: LiveVan[] = [],
  canonicalAppointments: OfficeAppointmentAttribution[] = [],
  operationalState: LiveOperationalCapacityState | null = null,
): BrowserAppointmentRecord[] {
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const appointmentById = new Map(canonicalAppointments.map((appointment) => [appointment.appointmentId, appointment]));
  const grouped = new Map<string, LiveWorkOrder[]>();

  for (const order of workOrders) {
    const appointmentId = text(order.appointmentId);
    if (!appointmentId || !text(order.date) || !workOrderVanId(order, vans)) continue;
    const current = grouped.get(appointmentId) ?? [];
    current.push(order);
    grouped.set(appointmentId, current);
  }

  const appointments: BrowserAppointmentRecord[] = [];
  for (const [appointmentId, allOrders] of grouped.entries()) {
    const activeOrders = allOrders.filter((order) => !isCancelled(order.status));
    const orders = activeOrders.length ? activeOrders : allOrders;
    const sorted = [...orders].sort((a, b) => {
      const aSupport = workOrderAssignmentRole(a) === 'support' ? 1 : 0;
      const bSupport = workOrderAssignmentRole(b) === 'support' ? 1 : 0;
      return aSupport - bSupport || text(a.time).localeCompare(text(b.time)) || a.id.localeCompare(b.id);
    });
    const primary = sorted[0];
    const authorityAppointment = appointmentById.get(appointmentId);
    const clientId = text(primary.clientId);
    const propertyId = text(primary.propertyId);
    const client = clientById.get(clientId);
    const property = propertyById.get(propertyId);
    const customer = clientLabel(client, clientId);
    const site = propertyLabel(property, propertyId);
    const sector = text(primary.operationalZone) || text(primary.zone) || text(property?.operationalZone) || text(property?.zone) || 'Unknown';
    const assignments = sorted.map((order) => workOrderAssignment(order, customer, site, sector, vans, operationalState));
    const primaryAssignment = assignments.find((assignment) => assignment.isPrimaryAssignment) ?? assignments[0];
    const supportAssignment = assignments.find((assignment) => !assignment.isPrimaryAssignment);
    const quantity = sorted.reduce((total, order) => total + workOrderQuantity(order), 0);
    const workTypeId = workOrderWorkTypeId(primary);
    const workLabel = workOrderWorkLabel(primary);
    const fallbackDescription = `${workLabel} × ${quantity}`;
    const customerFacingDescription = text(primary.customerFacingDescription)
      || cleanCustomerDescription(primary.problem, fallbackDescription);
    const cancelled = activeOrders.length === 0 && assignments.every((assignment) => assignment.status === 'cancelled');
    const temporaryHold = !cancelled && assignments.some((assignment) => assignment.status === 'temporary_hold');
    const confirmedAt = text(primary.confirmedAt) || text(primary.createdAt);
    const actorLabel = bookingActorLabel(authorityAppointment);
    const durationMinutes = positiveInteger(primary.appointmentDurationMinutes ?? primary.duration, 60);
    const slotCount = numericSlotCount(primary.scheduledSlots) || normalizedSlots(primary.scheduledSlots).length || Math.ceil(durationMinutes / 60);
    const perUnitMinutes = durationPerUnit(primary);

    appointments.push({
      id: appointmentId,
      dateKey: text(primary.date),
      customerId: clientId || undefined,
      siteId: propertyId || undefined,
      customer,
      site,
      sector,
      presetId: primaryAssignment.presetId,
      workTypeId,
      workLabel,
      serviceId: text(primary.serviceId) || undefined,
      totalQuantity: quantity,
      scheduledDurationMinutes: durationMinutes,
      scheduledSlotCount: slotCount,
      durationMinutesPerUnit: perUnitMinutes || undefined,
      workLines: [{
        id: `${appointmentId}-work`,
        presetId: primaryAssignment.presetId,
        quantity,
        customerFacingDescription,
      }],
      customerFacingDescription,
      customerPhone: text(client?.phone) || undefined,
      customerWhatsapp: text(client?.whatsapp) || undefined,
      customerEmail: text(client?.email) || undefined,
      customerPreferredLanguage: text(client?.preferredLanguage) || undefined,
      propertyAddress: text(property?.address) || text(primary.address) || undefined,
      propertyAccessInstructions: text(property?.accessInstructions) || undefined,
      status: cancelled ? 'cancelled' : temporaryHold ? 'temporary_hold' : 'confirmed',
      assignments,
      primaryVanId: primaryAssignment.vanId,
      supportVanId: supportAssignment?.vanId,
      bookedById: text(authorityAppointment?.createdBy) || undefined,
      bookedByName: actorLabel || undefined,
      bookedBySource: text(authorityAppointment?.source) || undefined,
      createdAt: text(authorityAppointment?.createdAtIso) || text(primary.createdAt) || confirmedAt || new Date(0).toISOString(),
      updatedAt: text(authorityAppointment?.updatedAtIso) || text(primary.updatedAt) || undefined,
      confirmedAt: temporaryHold ? undefined : confirmedAt || undefined,
      workOrderId: primary.id,
      workOrderIds: sorted.map((order) => order.id),
    });
  }

  return appointments.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.assignments[0].start.localeCompare(b.assignments[0].start) || a.id.localeCompare(b.id));
}

export async function loadLiveSchedulingAppointments() {
  const [workOrders, clients, properties, vans, operationalState] = await Promise.all([
    listFirestoreCollection<LiveWorkOrder>('workOrders', 1000),
    listFirestoreCollection<LiveClient>('clients', 1000),
    listFirestoreCollection<LiveProperty>('properties', 1000),
    listFirestoreCollection<LiveVan>('vans', 250),
    loadLiveOperationalCapacityState(),
  ]);
  const appointmentIds = [...new Set(workOrders.map((order) => text(order.appointmentId)).filter(Boolean))];
  let attribution: OfficeAppointmentAttribution[] = [];
  try {
    attribution = await listOfficeAppointmentAttribution(appointmentIds);
  } catch {
    // Attribution is supplemental. The operational board must remain available even if the authenticated metadata read is temporarily unavailable during a deployment transition.
  }
  return projectLiveSchedulingAppointments(workOrders, clients, properties, vans, attribution, operationalState);
}