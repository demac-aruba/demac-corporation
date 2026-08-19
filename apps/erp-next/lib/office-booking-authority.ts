import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type OfficeBookingPreset = {
  id: string;
  label: string;
  kind?: string;
  durationMinutesPerUnit: number;
  active: boolean;
};

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
    endTime?: string;
  }>;
};

export type OfficeAvailabilityResult = {
  success: boolean;
  available: boolean;
  offer: { id: string; version: number; status: string; expiresAt?: string } | null;
  options: OfficeBookingOption[];
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type OfficeAppointmentAttribution = {
  appointmentId: string;
  source?: string;
  createdBy?: string;
  createdByName?: string;
  createdAtIso?: string;
  updatedAtIso?: string;
};

export type OfficeLifecycleResult = {
  success: true;
  appointmentId: string;
  changeKind?: 'customer_reschedule' | 'operational_move';
  customerNotificationRecommended?: boolean;
  appointment: Record<string, unknown>;
};

export type OfficeCreateAppointmentResult = {
  success: true;
  replayed?: boolean;
  appointmentId: string;
  appointment: Record<string, unknown>;
  workOrderIds: string[];
};

type ApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`;
}

function apiErrorDetail(payload: ApiError) {
  const reason = payload.error?.details?.reason;
  return typeof reason === 'string' && reason.trim() ? ` · ${reason.trim()}` : '';
}

async function callOfficeBookingAuthority<T>(action: string, data: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T & ApiError;
    if (!response.ok) {
      const code = payload.error?.code ? ` (${payload.error.code})` : '';
      throw new Error(`${payload.error?.message ?? 'The appointment operation could not be completed.'}${code}${apiErrorDetail(payload)}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Booking Authority took too long to respond. Nothing was saved. Refresh and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function createOfficeLifecycleRequestId(prefix = 'schedule') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export async function listOfficeBookingPresets() {
  return callOfficeBookingAuthority<{ success: true; version: number; presets: OfficeBookingPreset[] }>(
    'list_presets',
    {},
    8_000,
  );
}

export async function checkOfficeCreateAvailability(input: {
  requestId: string;
  customerId: string;
  propertyId: string;
  presetId: string;
  serviceId?: string;
  quantity: number;
  requestedDate: string;
  requestedTime: string;
  requiredVanId: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  notes?: string;
}) {
  return callOfficeBookingAuthority<OfficeAvailabilityResult>('check_availability', input, 12_000);
}

export async function confirmOfficeAppointment(input: {
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
}) {
  const result = await callOfficeBookingAuthority<OfficeCreateAppointmentResult>('create_appointment', input, 12_000);
  if (!result.success || !result.appointmentId) {
    throw new Error('Booking Authority did not return a verified appointment id. Nothing was marked as confirmed.');
  }
  return result;
}

export async function listOfficeAppointmentAttribution(appointmentIds: string[]) {
  const ids = [...new Set(appointmentIds.map((item) => item.trim()).filter(Boolean))];
  const attribution: OfficeAppointmentAttribution[] = [];
  for (let index = 0; index < ids.length; index += 500) {
    const result = await callOfficeBookingAuthority<{ success: true; attribution: OfficeAppointmentAttribution[] }>(
      'list_appointment_attribution',
      { appointmentIds: ids.slice(index, index + 500) },
      6_000,
    );
    attribution.push(...(result.attribution ?? []));
  }
  return attribution;
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
  changeKind?: 'customer_reschedule' | 'operational_move';
}) {
  return callOfficeBookingAuthority<OfficeAvailabilityResult>('check_availability', input, 12_000);
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
  return callOfficeBookingAuthority<OfficeLifecycleResult>('reschedule_appointment', input, 12_000);
}

/**
 * Fast path for an authenticated office drag-and-drop move.
 * Booking Authority derives the work/customer data from the canonical appointment,
 * validates the exact van/time, and commits the lifecycle transaction inside one
 * server request so the browser does not pay two sequential network round trips.
 */
export async function moveOfficeAppointment(input: {
  appointmentId: string;
  requestId: string;
  requestedDate: string;
  requestedTime: string;
  requiredVanId: string;
  reason: string;
  note?: string;
}) {
  return callOfficeBookingAuthority<OfficeLifecycleResult>('move_appointment', input, 12_000);
}
