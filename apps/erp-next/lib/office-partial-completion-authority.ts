import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type PartialCompletionWorkLine = {
  id: string;
  presetId: string;
  serviceId?: string;
  quantity: number;
  manualDurationMinutes?: number;
  customerFacingDescription?: string;
  technicianInstructions?: string;
};

export type PartialCompletionOutcome = {
  status: 'partial';
  revision: number;
  recordRequestId?: string;
  recordedAtIso?: string;
  recordedById?: string;
  recordedByName?: string;
  reason: string;
  note?: string;
  actualEndTime: string;
  plannedQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  plannedWorkLines: PartialCompletionWorkLine[];
  completedWorkLines: PartialCompletionWorkLine[];
  remainingWorkLines: PartialCompletionWorkLine[];
  remainingWorkStatus: 'pending_schedule' | 'scheduled';
  followUpAppointmentId?: string;
  followUpScheduledAtIso?: string;
};

type ApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`;
}

async function callPartialAuthority<T>(action: string, data: Record<string, unknown>, timeoutMs = 12_000): Promise<T> {
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
      const reason = typeof payload.error?.details?.reason === 'string' ? ` · ${payload.error.details.reason}` : '';
      const code = payload.error?.code ? ` (${payload.error.code})` : '';
      throw new Error(`${payload.error?.message ?? 'The appointment outcome operation could not be completed.'}${code}${reason}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Booking Authority took too long to confirm the appointment outcome. Refresh before trying again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function createPartialOutcomeRequestId(prefix = 'partial-outcome') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function recordOfficePartialCompletion(input: {
  appointmentId: string;
  requestId: string;
  completedQuantity: number;
  actualEndTime: string;
  reason: string;
  note?: string;
}) {
  return callPartialAuthority<{
    success: true;
    replayed?: boolean;
    appointmentId: string;
    outcome: PartialCompletionOutcome;
    retainedCapacitySlots?: string[];
    releasedCapacitySlots?: string[];
    appointment: Record<string, unknown>;
  }>('record_partial_completion', input);
}

export function scheduleOfficeRemainingWork(input: {
  appointmentId: string;
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
}) {
  return callPartialAuthority<{
    success: true;
    replayed?: boolean;
    originalAppointmentId: string;
    followUpAppointmentId: string;
    followUpAppointment: Record<string, unknown>;
    workOrderIds?: string[];
  }>('schedule_remaining_work', input);
}
