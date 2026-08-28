import type { AppointmentRecipientSelection } from './customer-contacts';
import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

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

export async function createAfterHoursEmergency(input: {
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
  recipientSelections?: AppointmentRecipientSelection[];
}) {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'create_after_hours_emergency', data: input }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as AfterHoursEmergencyResult & {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };
    if (!response.ok) {
      const reason = typeof payload.error?.details?.reason === 'string' ? ` · ${payload.error.details.reason}` : '';
      throw new Error(`${payload.error?.message ?? 'After-hours emergency could not be created.'}${reason}`);
    }
    if (!payload.success || !payload.appointmentId || !payload.workOrderIds?.length) {
      throw new Error('Booking Authority did not return a verified after-hours Work Order. Nothing was scheduled.');
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Booking Authority took too long to respond. Nothing was scheduled.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
