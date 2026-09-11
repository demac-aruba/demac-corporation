import { firebaseClientConfig } from '../firebase/client-config';
import { requireFirebaseWebSession } from '../firebase/session';

export class TaskTrackerApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
  }
}

function baseUrl() {
  const explicit = process.env.NEXT_PUBLIC_TASK_TRACKER_FUNCTIONS_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (!firebaseClientConfig.projectId) {
    throw new TaskTrackerApiError('Task Tracker backend is not configured for this deployment.', 'not-configured', 503);
  }
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net`;
}

export async function taskTrackerRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${baseUrl()}/taskTrackerApi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.idToken}`,
      },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new TaskTrackerApiError(
        result.message || 'Task Tracker could not complete this request.',
        result.code || 'request-failed',
        response.status,
      );
    }
    return result.result as T;
  } catch (error) {
    if (error instanceof TaskTrackerApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TaskTrackerApiError('Task Tracker timed out. No change has been reported as saved.', 'timeout', 0);
    }
    throw new TaskTrackerApiError('Connection to Task Tracker was interrupted. No change has been reported as saved.', 'connection-error', 0);
  } finally {
    clearTimeout(timeout);
  }
}
