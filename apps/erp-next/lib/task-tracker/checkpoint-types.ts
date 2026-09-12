import type { TaskChecklistItem, TaskRecord, TaskTrackerWorkspace } from './types';

export type TaskCheckpointStatus = 'pending' | 'in_progress' | 'waiting' | 'blocked' | 'completed';
export type TaskCheckpointApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export type TaskCheckpointUpdate = {
  id: string;
  text: string;
  at: string;
  actorUserId: string;
  actorName: string;
  status: TaskCheckpointStatus;
  nextAction?: string;
  nextFollowUpAt?: string;
  waitingOn?: string;
  blockedReason?: string;
};

export type RichTaskCheckpoint = TaskChecklistItem & {
  status?: TaskCheckpointStatus;
  updates?: TaskCheckpointUpdate[];
  lastUpdateAt?: string;
  lastUpdatedByUserId?: string;
  lastUpdatedByName?: string;
  nextAction?: string | null;
  nextFollowUpAt?: string | null;
  waitingOn?: string | null;
  blockedReason?: string | null;
  requiresApproval?: boolean;
  approvalStatus?: TaskCheckpointApprovalStatus;
  approvalAt?: string;
  approvalByUserId?: string;
  approvalByName?: string;
  approvalNote?: string;
  dependsOnItemId?: string | null;
};

export type RichTaskRecord = Omit<TaskRecord, 'checklist'> & { checklist: RichTaskCheckpoint[] };
export type RichTaskWorkspace = Omit<TaskTrackerWorkspace, 'tasks'> & { tasks: RichTaskRecord[] };

export function checkpointStatus(item: RichTaskCheckpoint): TaskCheckpointStatus {
  if (item.completed) return 'completed';
  return item.status && ['pending', 'in_progress', 'waiting', 'blocked', 'completed'].includes(item.status)
    ? item.status
    : 'pending';
}

export function latestCheckpointUpdate(item: RichTaskCheckpoint) {
  const updates = Array.isArray(item.updates) ? item.updates : [];
  return updates.length ? updates[updates.length - 1] : null;
}

export function checkpointIsStale(item: RichTaskCheckpoint, taskCreatedAt: string, now = new Date(), staleDays = 2) {
  if (checkpointStatus(item) === 'completed') return false;
  const latest = item.lastUpdateAt || latestCheckpointUpdate(item)?.at || taskCreatedAt;
  const at = Date.parse(String(latest || ''));
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at >= staleDays * 24 * 60 * 60 * 1000;
}

export function checkpointFollowUpDue(item: RichTaskCheckpoint, now = new Date()) {
  if (checkpointStatus(item) === 'completed' || !item.nextFollowUpAt) return false;
  const at = Date.parse(item.nextFollowUpAt);
  return Number.isFinite(at) && at <= now.getTime();
}
