import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';
import {
  parseFieldJobResponse,
  parseFieldPrepareVisitResponse,
  parseFieldScheduleResponse,
} from './field-authority-contract';

export { fieldActionAllowed } from './field-authorization';
export type {
  FieldAllowedAction,
  FieldAssignmentSource,
  FieldJobDetail,
  FieldKnownEquipment,
  FieldPlannedWork,
  FieldPreparedVisit,
  FieldPrepareSource,
  FieldPrepareVisitResponse,
  FieldResponsibility,
  FieldScheduleJob,
  FieldVisitStatus,
} from './field-authority-contract';

type FieldApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/fieldOperationsAuthority`;
}

function asApiErrorPayload(value: unknown): FieldApiError {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as FieldApiError
    : {};
}

function abortError() {
  const error = new Error('Field Operations request timed out.');
  error.name = 'AbortError';
  return error;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function callFieldAuthority(action: string, data: Record<string, unknown>, timeoutMs = 12_000): Promise<unknown> {
  // One deadline covers token refresh plus the protected Field request. Otherwise a stalled
  // Firebase refresh could bypass the Field fetch timeout and leave stale assignments visible.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const session = await abortable(requireFirebaseWebSession(), controller.signal);
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiError = asApiErrorPayload(payload);
      const code = apiError.error?.code ? ` (${apiError.error.code})` : '';
      throw new Error(`${apiError.error?.message ?? 'Field Operations could not complete the request.'}${code}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Field Operations took too long to respond. Refresh and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getFieldSchedule(startDate: string, endDate = startDate) {
  return parseFieldScheduleResponse(await callFieldAuthority('get_schedule', { startDate, endDate }));
}

export async function getFieldJob(workOrderId: string) {
  return parseFieldJobResponse(await callFieldAuthority('get_job', { workOrderId }));
}

export async function prepareFieldVisit(workOrderId: string, requestId: string) {
  return parseFieldPrepareVisitResponse(await callFieldAuthority('prepare_visit', { workOrderId, requestId }));
}
