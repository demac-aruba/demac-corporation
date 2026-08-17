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

type LiveWorkOrder = {
  id: string;
  appointmentId?: string;
  appointmentType?: string;
  assignmentRole?: string;
  supportForWorkOrderId?: string;
  clientId?: string;
  propertyId?: string;
  presetId?: string;
  quantity?: number;
  date?: string;
  time?: string;
  duration?: number;
  appointmentDurationMinutes?: number;
  zone?: string;
  operationalZone?: string;
  van?: string;
  scheduledSlots?: string[];
  problem?: string;
  status?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
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

function workOrderAssignment(
  order: LiveWorkOrder,
  customer: string,
  site: string,
  sector: string,
): CalendarDispatchJob {
  const start = text(order.time) || normalizedSlots(order.scheduledSlots)[0] || '08:30';
  const end = assignmentEnd({ ...order, time: start });
  const primary = text(order.assignmentRole).toLowerCase() !== 'support';
  return {
    id: order.id,
    dateKey: text(order.date),
    customer,
    site,
    sector,
    start,
    end,
    segment: daySegment(start, end),
    vanId: text(order.van) || 'UNASSIGNED',
    presetId: presetId(order.presetId),
    quantity: positiveInteger(order.quantity),
    status: isCancelled(order.status) ? 'cancelled' : 'confirmed',
    readiness: 'not_checked',
    isPrimaryAssignment: primary,
    customerCommunicationOwner: primary,
    ...(primary || !text(order.supportForWorkOrderId) ? {} : { supportForJobId: text(order.supportForWorkOrderId) }),
  };
}

export function projectLiveSchedulingAppointments(
  workOrders: LiveWorkOrder[],
  clients: LiveClient[],
  properties: LiveProperty[],
): BrowserAppointmentRecord[] {
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const grouped = new Map<string, LiveWorkOrder[]>();

  for (const order of workOrders) {
    const appointmentId = text(order.appointmentId);
    if (!appointmentId || !text(order.date) || !text(order.van)) continue;
    const current = grouped.get(appointmentId) ?? [];
    current.push(order);
    grouped.set(appointmentId, current);
  }

  const appointments: BrowserAppointmentRecord[] = [];
  for (const [appointmentId, orders] of grouped.entries()) {
    const sorted = [...orders].sort((a, b) => {
      const aSupport = text(a.assignmentRole).toLowerCase() === 'support' ? 1 : 0;
      const bSupport = text(b.assignmentRole).toLowerCase() === 'support' ? 1 : 0;
      return aSupport - bSupport || text(a.time).localeCompare(text(b.time)) || a.id.localeCompare(b.id);
    });
    const primary = sorted[0];
    const clientId = text(primary.clientId);
    const propertyId = text(primary.propertyId);
    const client = clientById.get(clientId);
    const property = propertyById.get(propertyId);
    const customer = clientLabel(client, clientId);
    const site = propertyLabel(property, propertyId);
    const sector = text(primary.operationalZone) || text(primary.zone) || text(property?.operationalZone) || text(property?.zone) || 'Unknown';
    const assignments = sorted.map((order) => workOrderAssignment(order, customer, site, sector));
    const primaryAssignment = assignments.find((assignment) => assignment.isPrimaryAssignment) ?? assignments[0];
    const supportAssignment = assignments.find((assignment) => !assignment.isPrimaryAssignment);
    const quantity = sorted.reduce((total, order) => total + positiveInteger(order.quantity), 0);
    const fallbackDescription = `${primaryAssignment.presetId.replaceAll('_', ' ')} x${quantity}`;
    const cancelled = assignments.every((assignment) => assignment.status === 'cancelled');

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
      createdAt: text(primary.createdAt) || new Date(0).toISOString(),
      updatedAt: text(primary.updatedAt) || undefined,
      confirmedAt: text(primary.createdAt) || undefined,
      workOrderId: primary.id,
    });
  }

  return appointments.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.assignments[0].start.localeCompare(b.assignments[0].start) || a.id.localeCompare(b.id));
}

export async function loadLiveSchedulingAppointments() {
  const [workOrders, clients, properties] = await Promise.all([
    listFirestoreCollection<LiveWorkOrder>('workOrders', 1000),
    listFirestoreCollection<LiveClient>('clients', 1000),
    listFirestoreCollection<LiveProperty>('properties', 1000),
  ]);
  return projectLiveSchedulingAppointments(workOrders, clients, properties);
}
