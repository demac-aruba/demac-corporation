import type { CalendarDispatchJob } from './scheduling-capacity';
import type { BookingRestriction, BookingWorkLine, DaySegment, WorkPresetId } from './scheduling';

export type BrowserAppointmentStatus = 'temporary_hold' | 'confirmed' | 'cancelled';
export type BrowserAppointmentChangeKind = 'created' | 'confirmed' | 'details_edited' | 'operational_move' | 'customer_reschedule' | 'cancelled' | 'operational_issue' | 'support_reflow' | 'support_move' | 'undo_move';

export type BrowserAppointmentScheduleSnapshot = {
  dateKey: string;
  primaryVanId: string;
  primaryStart: string;
  primaryEnd: string;
  supportVanId?: string;
  supportStart?: string;
  supportEnd?: string;
};

export type BrowserAppointmentHistoryEvent = {
  id: string;
  kind: BrowserAppointmentChangeKind;
  at: string;
  actorId?: string;
  actorName?: string;
  reason?: string;
  note?: string;
  from?: BrowserAppointmentScheduleSnapshot;
  to?: BrowserAppointmentScheduleSnapshot;
  customerNotificationRecommended?: boolean;
};

export type BrowserAppointmentRecord = {
  id: string;
  dateKey: string;
  customerId?: string;
  siteId?: string;
  customer: string;
  site: string;
  sector: string;
  presetId: WorkPresetId;
  totalQuantity: number;
  workLines?: BookingWorkLine[];
  bookingRestriction?: BookingRestriction;
  customerFacingDescription: string;
  technicianInstructions?: string;
  status: BrowserAppointmentStatus;
  assignments: CalendarDispatchJob[];
  primaryVanId: string;
  supportVanId?: string;
  lifecycleHistory?: BrowserAppointmentHistoryEvent[];
  cancellationReason?: string;
  cancellationNote?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt?: string;
  confirmedAt?: string;
  workOrderId?: string;
};

export type BrowserWorkOrderAssignment = {
  vanId: string;
  role: 'primary' | 'support';
  quantity: number;
  customerCommunicationOwner: boolean;
  start?: string;
  end?: string;
  segment?: DaySegment;
};

export type BrowserWorkOrderRecord = {
  id: string;
  appointmentId: string;
  customerId?: string;
  siteId?: string;
  customer: string;
  site: string;
  sector: string;
  presetId: WorkPresetId;
  totalQuantity: number;
  workLines?: BookingWorkLine[];
  bookingRestriction?: BookingRestriction;
  customerFacingDescription: string;
  technicianInstructions?: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  primaryVanId: string;
  supportVanId?: string;
  readiness: 'ready' | 'at_risk' | 'blocked';
  lifecycle: 'scheduled' | 'cancelled';
  assignments: BrowserWorkOrderAssignment[];
  scheduleHistory?: BrowserAppointmentHistoryEvent[];
  createdAt: string;
  updatedAt?: string;
};

export function createBrowserWorkOrder(appointment: BrowserAppointmentRecord): BrowserWorkOrderRecord {
  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? appointment.assignments[0];
  const support = appointment.assignments.find((assignment) => !assignment.isPrimaryAssignment);
  const suffix = appointment.id.replace(/^APT-/, '');
  return {
    id: appointment.workOrderId ?? `WO-${suffix}`,
    appointmentId: appointment.id,
    customerId: appointment.customerId,
    siteId: appointment.siteId,
    customer: appointment.customer,
    site: appointment.site,
    sector: appointment.sector,
    presetId: appointment.presetId,
    totalQuantity: appointment.totalQuantity,
    workLines: appointment.workLines,
    bookingRestriction: appointment.bookingRestriction,
    customerFacingDescription: appointment.customerFacingDescription,
    technicianInstructions: appointment.technicianInstructions,
    scheduledDate: appointment.dateKey,
    scheduledStart: primary?.start ?? '08:30',
    scheduledEnd: primary?.end ?? '09:30',
    primaryVanId: primary?.vanId ?? appointment.primaryVanId,
    supportVanId: support?.vanId ?? appointment.supportVanId,
    readiness: appointment.assignments.some((assignment) => assignment.readiness === 'blocked') ? 'blocked' : appointment.assignments.some((assignment) => assignment.readiness === 'at_risk') ? 'at_risk' : 'ready',
    lifecycle: appointment.status === 'cancelled' ? 'cancelled' : 'scheduled',
    assignments: appointment.assignments.map((assignment) => ({
      vanId: assignment.vanId,
      role: assignment.isPrimaryAssignment ? 'primary' : 'support',
      quantity: assignment.quantity,
      customerCommunicationOwner: assignment.customerCommunicationOwner ?? assignment.isPrimaryAssignment,
      start: assignment.start,
      end: assignment.end,
      segment: assignment.segment,
    })),
    scheduleHistory: appointment.lifecycleHistory,
    createdAt: new Date().toISOString(),
    updatedAt: appointment.updatedAt,
  };
}