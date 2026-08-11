import type { CalendarDispatchJob } from './scheduling-capacity';
import type { WorkPresetId } from './scheduling';

export type BrowserAppointmentStatus = 'temporary_hold' | 'confirmed' | 'cancelled';

export type BrowserAppointmentRecord = {
  id: string;
  dateKey: string;
  customer: string;
  site: string;
  sector: string;
  presetId: WorkPresetId;
  totalQuantity: number;
  customerFacingDescription: string;
  technicianInstructions?: string;
  status: BrowserAppointmentStatus;
  assignments: CalendarDispatchJob[];
  primaryVanId: string;
  supportVanId?: string;
  createdAt: string;
  confirmedAt?: string;
  workOrderId?: string;
};

export type BrowserWorkOrderRecord = {
  id: string;
  appointmentId: string;
  customer: string;
  site: string;
  sector: string;
  presetId: WorkPresetId;
  totalQuantity: number;
  customerFacingDescription: string;
  technicianInstructions?: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  primaryVanId: string;
  supportVanId?: string;
  readiness: 'ready' | 'at_risk' | 'blocked';
  lifecycle: 'scheduled';
  assignments: Array<{ vanId: string; role: 'primary' | 'support'; quantity: number; customerCommunicationOwner: boolean }>;
  createdAt: string;
};

export function createBrowserWorkOrder(appointment: BrowserAppointmentRecord): BrowserWorkOrderRecord {
  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? appointment.assignments[0];
  const support = appointment.assignments.find((assignment) => !assignment.isPrimaryAssignment);
  const suffix = appointment.id.replace(/^APT-/, '');
  return {
    id: appointment.workOrderId ?? `WO-${suffix}`,
    appointmentId: appointment.id,
    customer: appointment.customer,
    site: appointment.site,
    sector: appointment.sector,
    presetId: appointment.presetId,
    totalQuantity: appointment.totalQuantity,
    customerFacingDescription: appointment.customerFacingDescription,
    technicianInstructions: appointment.technicianInstructions,
    scheduledDate: appointment.dateKey,
    scheduledStart: primary?.start ?? '08:30',
    scheduledEnd: primary?.end ?? '09:30',
    primaryVanId: primary?.vanId ?? appointment.primaryVanId,
    supportVanId: support?.vanId ?? appointment.supportVanId,
    readiness: appointment.assignments.some((assignment) => assignment.readiness === 'blocked') ? 'blocked' : appointment.assignments.some((assignment) => assignment.readiness === 'at_risk') ? 'at_risk' : 'ready',
    lifecycle: 'scheduled',
    assignments: appointment.assignments.map((assignment) => ({
      vanId: assignment.vanId,
      role: assignment.isPrimaryAssignment ? 'primary' : 'support',
      quantity: assignment.quantity,
      customerCommunicationOwner: assignment.customerCommunicationOwner ?? assignment.isPrimaryAssignment,
    })),
    createdAt: new Date().toISOString(),
  };
}
