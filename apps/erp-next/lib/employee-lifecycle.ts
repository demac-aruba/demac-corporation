import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type OffboardEmployeeInput = {
  staffId: string;
  endDate: string;
  reason: string;
  releaseLoginEmail: boolean;
};

export type OffboardEmployeeResult = {
  staffId: string;
  employeeName: string;
  endDate: string;
  releasedLoginEmail?: string | null;
  accessRetired: boolean;
  regularVanAssignmentsCleared: number;
  futureAssignmentsCleared: number;
  cleanupWarning?: string | null;
};

type LifecycleResponse<T> = {
  ok: boolean;
  message?: string;
  code?: string;
  result?: T;
};

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase Functions is not configured for this deployment.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/adminWorkforceLifecycle`;
}

async function callLifecycle<T>(action: 'offboard' | 'reactivate', payload: Record<string, unknown>) {
  const session = await requireFirebaseWebSession();
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json().catch(() => ({})) as LifecycleResponse<T>;
  if (!response.ok || !result.ok || !result.result) {
    throw new Error(result.message || `Employee lifecycle operation failed (${response.status}).`);
  }
  return result.result;
}

export function offboardEmployee(input: OffboardEmployeeInput) {
  return callLifecycle<OffboardEmployeeResult>('offboard', input as unknown as Record<string, unknown>);
}

export function reactivateEmployee(staffId: string) {
  return callLifecycle<{ staffId: string; employeeName: string }>('reactivate', { staffId });
}
