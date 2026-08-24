import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type FieldResponsibility = 'lead' | 'technician' | 'helper' | 'office';

export type FieldPlannedWork = {
  id: string;
  serviceId?: string;
  presetId?: string;
  label: string;
  quantity: number;
  durationMinutes?: number;
};

export type FieldScheduleJob = {
  id: string;
  workOrderId: string;
  appointmentId: string;
  date: string;
  time: string;
  endTime?: string;
  status: string;
  customerId: string;
  customerName: string;
  propertyId: string;
  propertyName?: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  arrivalPhone?: string;
  arrivalWhatsapp?: string;
  accessInstructions?: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  plannedWork: FieldPlannedWork[];
  estimatedQuantity: number;
  vanId: string;
  technicianIds: string[];
  responsibility: FieldResponsibility;
  assignmentRole?: string;
};

export type FieldKnownEquipment = {
  id: string;
  qrCode?: string;
  locationLabel?: string;
  systemType?: string;
  brand?: string;
  model?: string;
  serial?: string;
  btu?: number | string | null;
  refrigerant?: string;
  voltage?: string;
  condition?: string;
  active: boolean;
};

export type FieldJobDetail = FieldScheduleJob & { knownEquipment: FieldKnownEquipment[] };

type FieldApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/fieldOperationsAuthority`;
}

async function callFieldAuthority<T>(action: string, data: Record<string, unknown>, timeoutMs = 12_000): Promise<T> {
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
    const payload = await response.json().catch(() => ({})) as T & FieldApiError;
    if (!response.ok) {
      const code = payload.error?.code ? ` (${payload.error.code})` : '';
      throw new Error(`${payload.error?.message ?? 'Field Operations could not complete the request.'}${code}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Field Operations took too long to respond. Refresh and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getFieldSchedule(startDate: string, endDate = startDate) {
  return callFieldAuthority<{ success: true; version: number; jobs: FieldScheduleJob[] }>('get_schedule', { startDate, endDate });
}

export async function getFieldJob(workOrderId: string) {
  return callFieldAuthority<{ success: true; version: number; job: FieldJobDetail }>('get_job', { workOrderId });
}
