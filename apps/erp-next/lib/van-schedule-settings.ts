import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type VanScheduleGroupSetting = {
  vanId: string;
  sourceVanId?: string;
  vanName: string;
  groupName: string;
  groupJid: string;
  enabled: boolean;
  configured: boolean;
};

type GroupResponse = {
  success: true;
  version: number;
  groups: VanScheduleGroupSetting[];
};

export type VanScheduleSendResult = {
  success: true;
  version: number;
  dateKey: string;
  vanCount: number;
  workOrderCount: number;
  messageCount: number;
  results: Array<{
    queued: boolean;
    created?: boolean;
    vanId?: string;
    groupName?: string;
    workOrderId?: string;
    reason?: string;
  }>;
};

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`;
}

async function callVanScheduleAuthority<T>(action: string, data: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
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
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || 'Van WhatsApp schedule operation failed.');
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Van WhatsApp schedule operation took too long to respond. Nothing was changed.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getVanScheduleGroupSettings() {
  return callVanScheduleAuthority<GroupResponse>('get_van_schedule_groups', {});
}

export function saveVanScheduleGroupSetting(input: {
  vanId: string;
  groupName: string;
  groupJid: string;
  enabled: boolean;
}) {
  return callVanScheduleAuthority<GroupResponse>('save_van_schedule_groups', { groups: [input] });
}

export function sendVanSchedulesNow(input: {
  dateKey: string;
  vanId?: string;
  requestId: string;
}) {
  return callVanScheduleAuthority<VanScheduleSendResult>('send_van_schedules_now', input, 30_000);
}
