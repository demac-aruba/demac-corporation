import type { BrowserAppointmentRecord } from './browser-operational';
import type { CalendarDispatchJob } from './scheduling-capacity';
import type { DaySegment, WorkPresetId } from './scheduling';
import { listFirestoreCollection } from './firebase/firestore-rest';

const KNOWN_PRESETS = new Set<WorkPresetId>([
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

type LiveWorkOrder = {
  id: string;
  appointmentId?: string;
  appointmentType?: string;
  appointmentWorkType?: string;
  appointmentPresetId?: string;
  appointmentAssignmentRole?: string;
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
  zone?: string;
  operationalZone?: string;
  vanId?: string;
  van?: string;
  scheduledSlots?: string[];
  problem?: string;
  status?: string;
  source?: string;
  confirmedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LiveCanonicalAppointment = {
  id: string;
  appointmentId?: string;
  source?: string;
  createdBy?: string;
  createdByName?: string;
  createdAtIso?: string;
  updatedAtIso?: string;
};

type LiveClient = {
  id: string;
  name?: string;
  company?: string;
};

type LiveProperty = {
  id: string;
  name?: string;
  address?: string;
  zone?: string;
  operationalZone?: string;
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

function presetId(value: unknown): WorkPresetId {
  const candidate = text(value) as WorkPresetId;
  return KNOWN_PRESETS.has(candidate) ? candidate : 'other';
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
  return presetId(order.appointmentPresetId || order.appointmentWorkType || order.presetId);
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

function normalizedSlots(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((slot) => /^\d{2}:\d{2}$/.test(slot)).sort();
}

function assignmentEnd(order: LiveWorkOrder) {
  const slots = normalizedSlots(order.scheduledSlots);
  if (slots.length) return minutesToTime(timeToMinutes(slots[slots.length - 1]) + 60);
  const start = text(order.time) || '08:30';
  const duration = positiveInteger(order.appointmentDurationMinutes ?? order.duration, 60);
  return minutesToTime(timeToMinutes(start) + duration);
}

function daySegment(start: string, end: string): DaySegment {
  if (timeToMinutes(start) < 12 * 60 && timeToMinutes(end) > 13 * 60) return 'full_day';
  return timeToMinutes(start) < 12 * 60 ? 'am' : 'pm';
}

function isCancelled(status: unknown) {
  const normalized = text(status).toLowerCase();
  return normalized === 'cancelada' || normalized === 'cancelled' || normalized === 'canceled';
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

export function bookingActorLabel(appointment: LiveCanonicalAppointment | undefined) {
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
): CalendarDispatchJob {
  const start = text(order.time) || normalizedSlots(order.scheduledSlots)[0] || '08:30';
  const end = assignmentEnd({ ...order, time: start });
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
    status: isCancelled(order.status) ? 'cancelled' : 'confirmed',
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
  canonicalAppointments: LiveCanonicalAppointment[] = [],
): BrowserAppointmentRecord[] {
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const appointmentById = new Map(canonicalAppointments.map((appointment) => [text(appointment.appointmentId) || appointment.id, appointment]));
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
    const assignments = sorted.map((order) => workOrderAssignment(order, customer, site, sector, vans));
    const primaryAssignment = assignments.find((assignment) => assignment.isPrimaryAssignment) ?? assignments[0];
    const supportAssignment = assignments.find((assignment) => !assignment.isPrimaryAssignment);
    const quantity = sorted.reduce((total, order) => total + workOrderQuantity(order), 0);
    const fallbackDescription = `${primaryAssignment.presetId.replaceAll('_', ' ')} x${quantity}`;
    const cancelled = activeOrders.length === 0 && assignments.every((assignment) => assignment.status === 'cancelled');
    const confirmedAt = text(primary.confirmedAt) || text(primary.createdAt);
    const actorLabel = bookingActorLabel(authorityAppointment);

    appointments.push({
      id: appointmentId,
      dateKey: text(primary.date),
      customerId: clientId || undefined,
      siteId: propertyId || undefined,
      customer,
      site,
      sector,
      presetId: primaryAssignment.presetId,
      totalQuantity: quantity,
      workLines: [{
        id: `${appointmentId}-work`,
        presetId: primaryAssignment.presetId,
        quantity,
        customerFacingDescription: cleanCustomerDescription(primary.problem, fallbackDescription),
      }],
      customerFacingDescription: cleanCustomerDescription(primary.problem, fallbackDescription),
      status: cancelled ? 'cancelled' : 'confirmed',
      assignments,
      primaryVanId: primaryAssignment.vanId,
      supportVanId: supportAssignment?.vanId,
      bookedById: text(authorityAppointment?.createdBy) || undefined,
      bookedByName: actorLabel || undefined,
      bookedBySource: text(authorityAppointment?.source) || undefined,
      createdAt: text(authorityAppointment?.createdAtIso) || text(primary.createdAt) || confirmedAt || new Date(0).toISOString(),
      updatedAt: text(authorityAppointment?.updatedAtIso) || text(primary.updatedAt) || undefined,
      confirmedAt: confirmedAt || undefined,
      workOrderId: primary.id,
    });
  }

  return appointments.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.assignments[0].start.localeCompare(b.assignments[0].start) || a.id.localeCompare(b.id));
}

export async function loadLiveSchedulingAppointments() {
  const [workOrders, clients, properties, vans, canonicalAppointments] = await Promise.all([
    listFirestoreCollection<LiveWorkOrder>('workOrders', 1000),
    listFirestoreCollection<LiveClient>('clients', 1000),
    listFirestoreCollection<LiveProperty>('properties', 1000),
    listFirestoreCollection<LiveVan>('vans', 250),
    listFirestoreCollection<LiveCanonicalAppointment>('appointments', 1000),
  ]);
  return projectLiveSchedulingAppointments(workOrders, clients, properties, vans, canonicalAppointments);
}
