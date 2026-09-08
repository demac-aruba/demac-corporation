import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type MayaCancellationRow = {
  id: string; customerId: string; customer: string; address: string; sector: string;
  identityVerified: boolean; scheduledDate: string; scheduledTime: string;
  cancelledAt: string; reason: string; note: string; actor: string; source: string;
  currentAvailabilityVerified: false; workLines: Array<{ service: string; quantity: number | null }>;
};
export type MayaWaitlistRow = {
  id: string; customer: string; address: string; sector: string; identityVerified: boolean;
  state: 'waiting' | 'withdrawn' | 'expired' | 'needs_review';
  kind: 'new_appointment' | 'earlier_appointment';
  conversationId: string; appointmentId: string; sourceMessageId: string;
  requestedAt: string; dateFrom: string; dateTo: string;
  originalDate: string; originalTime: string; preference: string;
  canContact: false; capacityReserved: false;
};
export type MayaRecoveryRow = {
  caseId: string; appointmentId: string; kind: string;
  status: 'compatible_for_review' | 'incompatible' | 'needs_review' | 'needs_work_details' | 'excluded';
  reason: string; customer?: string; address?: string; sector?: string;
  originalDate?: string; originalTime?: string; date?: string; time?: string; endTime?: string;
  customerConfirmationRequired: true; capacityReserved: false; proactiveContactAuthorized: false;
};
export type MayaPage<T> = { success: true; rows: T[]; nextCursor: string | null; checkedAt: string; readOnly: true };
export type CancellationFilter = { from: string; to: string };

async function readOperations<T>(action: string, data: Record<string, unknown>, timeoutMs = 20_000): Promise<MayaPage<T>> {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase is not configured for ERP Next.');
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }),
    });
    const payload = await response.json().catch(() => null) as (MayaPage<T> & { error?: { message?: string } }) | null;
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.rows)) {
      throw new Error(payload?.error?.message || 'This Maya workspace could not be loaded. The deployed backend may not include this feature yet.');
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Loading timed out. Refresh to retry; these lists do not modify appointments.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export function listMayaCancellations(filter: CancellationFilter, afterId?: string) {
  return readOperations<MayaCancellationRow>('list_maya_cancellations', { ...filter, pageSize: 25, ...(afterId ? { afterId } : {}) });
}
export function listMayaWaitlist(afterId?: string) {
  return readOperations<MayaWaitlistRow>('list_maya_waitlist', { pageSize: 25, ...(afterId ? { afterId } : {}) });
}
export function inspectMayaRecoveryCandidates(cancelledAppointmentId: string, afterId?: string) {
  return readOperations<MayaRecoveryRow>('inspect_maya_recovery_candidates', {
    cancelledAppointmentId, pageSize: 10, ...(afterId ? { afterId } : {}),
  }, 50_000);
}
