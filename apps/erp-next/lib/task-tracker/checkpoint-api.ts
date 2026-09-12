import { firebaseClientConfig } from '../firebase/client-config';
import { requireFirebaseWebSession } from '../firebase/session';
import type { RichTaskRecord, TaskCheckpointStatus } from './checkpoint-types';

export class TaskCheckpointApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
  }
}

function endpoint() {
  const explicit = process.env.NEXT_PUBLIC_TASK_TRACKER_FUNCTIONS_BASE_URL;
  const base = explicit?.replace(/\/$/, '') || (firebaseClientConfig.projectId ? `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net` : '');
  if (!base) throw new TaskCheckpointApiError('Task checkpoint backend is not configured.', 'not-configured', 503);
  return `${base}/taskCheckpointApi`;
}

async function request<T>(action: string, payload: Record<string, unknown>) {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new TaskCheckpointApiError(result.message || 'Checkpoint update failed.', result.code || 'request-failed', response.status);
    }
    return result.result as T;
  } catch (error) {
    if (error instanceof TaskCheckpointApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new TaskCheckpointApiError('Checkpoint update timed out. Refresh before retrying.', 'timeout', 0);
    throw new TaskCheckpointApiError('Connection to checkpoint tracking was interrupted. No change has been reported as saved.', 'connection-error', 0);
  } finally {
    clearTimeout(timeout);
  }
}

export function addCheckpointProgress(args: {
  task: RichTaskRecord;
  itemId: string;
  text: string;
  status: TaskCheckpointStatus;
  nextAction?: string;
  nextFollowUpAt?: string;
  waitingOn?: string;
  blockedReason?: string;
}) {
  return request<RichTaskRecord>('checkpoint.update', {
    taskId: args.task.id,
    itemId: args.itemId,
    expectedVersion: args.task.version,
    text: args.text,
    status: args.status,
    nextAction: args.nextAction || null,
    nextFollowUpAt: args.nextFollowUpAt || null,
    waitingOn: args.waitingOn || null,
    blockedReason: args.blockedReason || null,
  });
}

export function configureCheckpoint(args: {
  task: RichTaskRecord;
  itemId: string;
  requiresApproval: boolean;
  dependsOnItemId?: string;
}) {
  return request<RichTaskRecord>('checkpoint.configure', {
    taskId: args.task.id,
    itemId: args.itemId,
    expectedVersion: args.task.version,
    requiresApproval: args.requiresApproval,
    dependsOnItemId: args.dependsOnItemId || null,
  });
}

export function decideCheckpointApproval(args: {
  task: RichTaskRecord;
  itemId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}) {
  return request<RichTaskRecord>('checkpoint.approval', {
    taskId: args.task.id,
    itemId: args.itemId,
    expectedVersion: args.task.version,
    decision: args.decision,
    note: args.note || null,
  });
}
