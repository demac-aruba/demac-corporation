import { firebaseClientConfig } from '../firebase/client-config';
import { requireFirebaseWebSession } from '../firebase/session';
import type { TaskAttachment, TaskRecord } from './types';

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

async function parseApiError(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({}));
  return new TaskTrackerApiError(
    result.message || fallback,
    result.code || 'request-failed',
    response.status,
  );
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

export async function uploadTaskAttachment(args: {
  taskId: string;
  expectedVersion: number;
  file: File;
}): Promise<{ attachment: TaskAttachment; task: TaskRecord }> {
  if (!args.file.name.trim()) throw new TaskTrackerApiError('Choose an evidence file.', 'file-required', 400);
  if (!Number.isFinite(args.file.size) || args.file.size <= 0) throw new TaskTrackerApiError('The selected evidence file is empty.', 'file-empty', 400);
  if (args.file.size > 20 * 1024 * 1024) throw new TaskTrackerApiError('Task evidence files must be 20 MB or smaller.', 'file-too-large', 413);

  const session = await requireFirebaseWebSession();
  const query = new URLSearchParams({
    taskId: args.taskId,
    expectedVersion: String(args.expectedVersion),
    fileName: args.file.name,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${baseUrl()}/taskTrackerAttachments?${query.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': args.file.type || 'application/octet-stream',
      },
      body: args.file,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) throw await parseApiError(response, 'Task evidence could not be uploaded.');
    const result = await response.json().catch(() => ({}));
    if (!result.ok || !result.result?.attachment || !result.result?.task) {
      throw new TaskTrackerApiError('Task evidence upload returned an incomplete response.', 'invalid-response', 502);
    }
    return result.result as { attachment: TaskAttachment; task: TaskRecord };
  } catch (error) {
    if (error instanceof TaskTrackerApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TaskTrackerApiError('Task evidence upload timed out. Refresh before retrying.', 'timeout', 0);
    }
    throw new TaskTrackerApiError('Connection was interrupted while uploading task evidence. Refresh before retrying.', 'connection-error', 0);
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadTaskAttachment(args: {
  taskId: string;
  attachmentId: string;
  fileName: string;
}) {
  const session = await requireFirebaseWebSession();
  const query = new URLSearchParams({ taskId: args.taskId, attachmentId: args.attachmentId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${baseUrl()}/taskTrackerAttachments?${query.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.idToken}` },
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) throw await parseApiError(response, 'Task evidence could not be downloaded.');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = args.fileName || 'task-evidence';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch (error) {
    if (error instanceof TaskTrackerApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TaskTrackerApiError('Task evidence download timed out.', 'timeout', 0);
    }
    throw new TaskTrackerApiError('Connection was interrupted while downloading task evidence.', 'connection-error', 0);
  } finally {
    clearTimeout(timeout);
  }
}
