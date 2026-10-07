import type { VisitReferences } from './booking-visit-references';
import { firebaseTransportUrl } from './firebase/isolated-preview';
import type { AppointmentRecipientSelection } from './customer-contacts';
import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';
import type { OfficeBookingWorkLine } from './office-booking-authority';

export type AfterHoursEmergencyResult = {
  success: true;
  replayed?: boolean;
  appointmentId: string;
  workOrderIds: string[];
  appointment: Record<string, unknown>;
  workOrder: Record<string, unknown> | null;
};

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`;
}

export type SpecialBookingInput = {
  visitReferences?: VisitReferences;
  project?: { id: string; phaseId: string; version: number };
  dwellingId?: string; requesterId?: string; accessContactId?: string;
  requestId: string;
  customerId: string;
  propertyId: string;
  workLines: OfficeBookingWorkLine[];
  requestedDate: string;
  requestedTime: string;
  requiredVanId: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  recipientSelections?: AppointmentRecipientSelection[];
};

export type RestDayOvertimeProposal = {
  kind: 'weekly_rest_overtime' | 'capacity_overflow_overtime'; ordinarySlots?: number;
  date: string; vanId: string; vanName: string; start: string; estimatedEnd: string; capacityEnd: string;
  requiredSlots: number; durationMinutes: number; regularEnd: string; confirmationToken: string;
};

export class SpecialBookingError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

async function specialBookingRequest<T>(action: string, input: SpecialBookingInput & { overtimeConsent?: { accepted: true; confirmationToken: string } }): Promise<T> {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(firebaseTransportUrl(endpoint()), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data: input }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as AfterHoursEmergencyResult & {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };
    if (!response.ok) {
      const reason = typeof payload.error?.details?.reason === 'string' ? ` · ${payload.error.details.reason}` : '';
      throw new SpecialBookingError(`${payload.error?.message ?? 'The booking could not be created.'}${reason}`, response.status >= 500);
    }
    if (!payload.success || (!['prepare_rest_day_overtime', 'prepare_capacity_overtime'].includes(action) && (!payload.appointmentId || !payload.workOrderIds?.length))) {
      throw new SpecialBookingError('The booking response could not be verified. Retry the original request.', true);
    }
    if (input.project && action === 'create_rest_day_overtime'
      && (payload.appointment?.projectId !== input.project.id || payload.appointment?.projectPhaseId !== input.project.phaseId
        || payload.workOrder?.projectId !== input.project.id || payload.workOrder?.projectPhaseId !== input.project.phaseId)) {
      throw new SpecialBookingError('The Project booking link could not be verified. Retry the original request.', true);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SpecialBookingError('The booking response timed out. Retry the original request to verify whether it was saved.', true);
    }
    if (error instanceof SpecialBookingError) throw error;
    throw new SpecialBookingError(error instanceof Error ? error.message : 'Booking connection failed.', true);
  } finally {
    window.clearTimeout(timer);
  }
}

export function createAfterHoursEmergency(input: SpecialBookingInput) {
  return specialBookingRequest<AfterHoursEmergencyResult>('create_after_hours_emergency', input);
}
export function prepareRestDayOvertime(input: SpecialBookingInput) {
  return specialBookingRequest<{ success: true; proposal: RestDayOvertimeProposal }>('prepare_rest_day_overtime', input);
}
export function createRestDayOvertime(input: SpecialBookingInput & { overtimeConsent: { accepted: true; confirmationToken: string } }) {
  return specialBookingRequest<AfterHoursEmergencyResult>('create_rest_day_overtime', input);
}
export function prepareCapacityOvertime(input: SpecialBookingInput) {
  return specialBookingRequest<{ success: true; proposal: RestDayOvertimeProposal }>('prepare_capacity_overtime', input);
}
export function createCapacityOvertime(input: SpecialBookingInput & { overtimeConsent: { accepted: true; confirmationToken: string } }) {
  return specialBookingRequest<AfterHoursEmergencyResult>('create_capacity_overtime', input);
}
