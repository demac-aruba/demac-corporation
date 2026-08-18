import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type OfficeBookingOption = {
  id: string;
  date: string;
  time: string;
  endTime?: string;
  address?: string;
  zone?: string;
  presetId?: string;
  presetLabel?: string;
  serviceId?: string;
  durationMinutesPerUnit?: number;
  quantity?: number;
  assignments: Array<{
    vanId: string;
    vanName?: string;
    technicianIds?: string[];
    quantity: number;
    slots: number;
    fullDay?: boolean;
    time?: string;
  }>;
};

export type OfficeAvailabilityResult = {
  success: boolean;
  available: boolean;
  offer: { id: string; version: number; status: string; expiresAt?: string } | null;
  options: OfficeBookingOption[];
  reason?: string;
};

export type OfficeAppointmentAttribution = {
  appointmentId: string;
  source?: string;
  createdBy?: string;
  createdByName?: string;
  createdAtIso?: string;
  updatedAtIso?: string;
};

type ApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`;
}

async function callOfficeBookingAuthority<T>(action: string, data: Record<string, unknown>): Promise<T> {
  const session = await requireFirebaseWebSession();
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, data }),
  });
  const payload = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) {
    const code = payload.error?.code ? ` (${payload.error.code})` : '';
    throw new Error(`${payload.error?.message ?? 'The appointment operation could not be completed.'}${code}`);
  }
  return payload;
}

export function createOfficeLifecycleRequestId(prefix = 'schedule') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export async function listOfficeAppointmentAttribution(appointmentIds: string[]) {
  const result = await callOfficeBookingAuthority<{ success: true; attribution: OfficeAppointmentAttribution[] }>('list_appointment_attribution', { appointmentIds });
  return result.attribution ?? [];
}

export async function checkOfficeRescheduleAvailability(input: {
  appointmentId: string;
  requestId: string;
  customerId: string;
  propertyId: string;
  presetId: string;
  quantity: number;
  requestedDate: string;
  requestedTime?: string;
  requiredVanId?: string;
  customerFacingDescription?: string;
}) {
  return callOfficeBookingAuthority<OfficeAvailabilityResult>('check_availability', input);
}

export async function cancelOfficeAppointment(input: {
  appointmentId: string;
  requestId: string;
  reason: string;
  note?: string;
}) {
  return callOfficeBookingAuthority<{ success: true; appointmentId: string; appointment: Record<string, unknown> }>('cancel_appointment', input);
}

export async function rescheduleOfficeAppointment(input: {
  appointmentId: string;
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
  reason: string;
  note?: string;
  changeKind?: 'customer_reschedule' | 'operational_move';
}) {
  return callOfficeBookingAuthority<{
    success: true;
    appointmentId: string;
    changeKind?: 'customer_reschedule' | 'operational_move';
    customerNotificationRecommended?: boolean;
    appointment: Record<string, unknown>;
  }>('reschedule_appointment', input);
}
