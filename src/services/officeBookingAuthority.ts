import { getValidFirebaseSession } from './firebase';

export type OfficeBookingPreset = {
  id: string;
  label: string;
  kind?: string;
  durationMinutesPerUnit: number;
  active: boolean;
};

export type OfficeBookingAssignment = {
  vanId: string;
  vanName?: string;
  technicianIds?: string[];
  quantity: number;
  slots: number;
  fullDay?: boolean;
  time?: string;
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
  assignments: OfficeBookingAssignment[];
};

export type OfficeBookingOffer = {
  id: string;
  version: number;
  status: string;
  expiresAt?: string;
  options?: OfficeBookingOption[];
};

export type OfficeAvailabilityInput = {
  requestId: string;
  customerId: string;
  propertyId: string;
  presetId: string;
  serviceId?: string;
  quantity: number;
  requestedDate?: string;
  requestedTime?: string;
  preferredTime?: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  notes?: string;
};

export type OfficeAvailabilityResult = {
  success: boolean;
  available: boolean;
  replayed?: boolean;
  offer: OfficeBookingOffer | null;
  options: OfficeBookingOption[];
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type OfficeCreateAppointmentInput = {
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
};

export type OfficeCreateAppointmentResult = {
  success: boolean;
  replayed?: boolean;
  appointmentId: string;
  appointment?: Record<string, unknown>;
  workOrderIds?: string[];
};

type OfficeApiError = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

type OfficeApiEnvelope<T> = T & { error?: OfficeApiError };

const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const officeBookingUrl = projectId
  ? `https://us-central1-${projectId}.cloudfunctions.net/officeBookingAuthority`
  : '';

async function callOfficeBookingAuthority<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!officeBookingUrl) throw new Error('Cloud Functions no está configurado para este entorno.');
  const session = await getValidFirebaseSession();
  if (!session) throw new Error('La sesión de Firebase expiró. Inicia sesión nuevamente.');
  const response = await fetch(officeBookingUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, data }),
  });
  const payload = await response.json().catch(() => ({})) as OfficeApiEnvelope<T>;
  if (!response.ok) {
    const code = payload.error?.code ? ` (${payload.error.code})` : '';
    throw new Error(`${payload.error?.message ?? 'No se pudo completar la operación de agenda.'}${code}`);
  }
  return payload as T;
}

export function createOfficeBookingRequestId(prefix = 'agenda') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export async function listOfficeBookingPresets() {
  return callOfficeBookingAuthority<{ success: true; version: number; presets: OfficeBookingPreset[] }>('list_presets');
}

export async function checkOfficeBookingAvailability(input: OfficeAvailabilityInput) {
  return callOfficeBookingAuthority<OfficeAvailabilityResult>('check_availability', input as unknown as Record<string, unknown>);
}

export async function createOfficeAppointment(input: OfficeCreateAppointmentInput) {
  const result = await callOfficeBookingAuthority<OfficeCreateAppointmentResult>('create_appointment', input as unknown as Record<string, unknown>);
  if (!result.success || !result.appointmentId) {
    throw new Error('Booking Authority no devolvió un appointmentId verificado. La cita no se puede marcar como confirmada.');
  }
  return result;
}

export async function getOfficeAppointment(appointmentId: string) {
  return callOfficeBookingAuthority<{ success: true; appointmentId: string; appointment: Record<string, unknown> }>('get_appointment', { appointmentId });
}
