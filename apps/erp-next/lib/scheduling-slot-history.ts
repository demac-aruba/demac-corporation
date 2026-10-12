import { resolveCanonicalVanId, type LiveVan } from './live-scheduling';

export type HistoryPlacement = {
  dateKey: string; primaryVanId: string; primaryStart: string; primaryEnd: string;
  primaryCapacityEnd?: string; supportVanId?: string; supportStart?: string;
};
export type ScheduleHistoryEvent = {
  id: string; kind: 'cancelled' | 'customer_reschedule' | 'operational_move'; at: string;
  actorName: string; reason: string; note: string; from: HistoryPlacement; to: HistoryPlacement | null;
};
export type ScheduleHistoryAppointment = {
  appointmentId: string; customerId: string; propertyId: string; status: string;
  date: string; startTime: string; primaryVanId: string; workLabel: string; events: ScheduleHistoryEvent[];
  createdAt?: string; createdByName?: string;
};
export type ScheduleHistoryPage = {
  appointments: ScheduleHistoryAppointment[];
  nextCursor: { phase: string; checkpoint: string; afterId?: string; afterTime?: string; afterTimestamp?: { seconds: number; nanoseconds: number } } | null;
  checkpoint: string;
};
export type SlotHistoryItem = {
  key: string; appointment: ScheduleHistoryAppointment; event: ScheduleHistoryEvent;
  date: string; vanId: string; start: string; end: string; role: 'primary' | 'support';
  customer: string; property: string;
};
const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function projectSlotHistory(appointments: ScheduleHistoryAppointment[], references: {
  clients: { id: string; name?: string; company?: string }[];
  properties: { id: string; name?: string; address?: string }[]; vans: LiveVan[];
}): SlotHistoryItem[] {
  const clients = new Map(references.clients.map(item => [item.id, item]));
  const properties = new Map(references.properties.map(item => [item.id, item]));
  const items = new Map<string, SlotHistoryItem>();
  for (const appointment of appointments) for (const event of appointment.events) {
    const from = event.from;
    if (!from || !validDate(from.dateKey)) continue;
    for (const role of ['primary', 'support'] as const) {
      const vanId = resolveCanonicalVanId(role === 'primary' ? from.primaryVanId : from.supportVanId, references.vans);
      const start = (role === 'primary' ? from.primaryStart : from.supportStart) || '';
      if (!vanId || !validTime(start)) continue;
      const toVan = resolveCanonicalVanId(role === 'primary' ? event.to?.primaryVanId : event.to?.supportVanId, references.vans);
      const toStart = role === 'primary' ? event.to?.primaryStart : event.to?.supportStart;
      // Do not label an unchanged placement as freed, even if another Van moved.
      if (event.kind !== 'cancelled' && event.to?.dateKey === from.dateKey && toVan === vanId && toStart === start) continue;
      // Older support snapshots did not save an end; mark the known start only.
      const end = role === 'primary' ? from.primaryCapacityEnd || from.primaryEnd : '';
      const client = clients.get(appointment.customerId), property = properties.get(appointment.propertyId);
      const key = `${appointment.appointmentId}:${event.id}:${role}`;
      items.set(key, { key, appointment, event, role, date: from.dateKey, vanId, start,
        end: end && validTime(end) && end > start ? end : '',
        customer: client?.company || client?.name || appointment.customerId || 'Cliente sin identificar',
        property: property?.name || property?.address || appointment.propertyId || 'Propiedad sin identificar',
      });
    }
  }
  return [...items.values()].sort((a, b) => b.event.at.localeCompare(a.event.at) || a.key.localeCompare(b.key));
}

export function historyForSlots(items: SlotHistoryItem[], starts: string[]) {
  return items.filter(item => starts.some(start => item.end ? start >= item.start && start < item.end : start === item.start));
}

export function historyKindLabel(kind: ScheduleHistoryEvent['kind']) {
  return kind === 'cancelled' ? 'Cancelada' : kind === 'operational_move' ? 'Movida de cupo' : 'Reagendada';
}
