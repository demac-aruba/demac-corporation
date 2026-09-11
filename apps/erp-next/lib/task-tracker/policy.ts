import type { AuthPrincipal } from '@/lib/security';
import type {
  TaskAccess,
  TaskDisplayStatus,
  TaskLifecycleStatus,
  TaskRecord,
  TaskReminderCandidate,
  TaskReminderKind,
} from './types';

const terminalStatuses = new Set<TaskLifecycleStatus>(['completed', 'cancelled']);

const transitions: Record<TaskLifecycleStatus, ReadonlySet<TaskLifecycleStatus>> = {
  pending: new Set(['in_progress', 'waiting', 'completed', 'cancelled']),
  in_progress: new Set(['pending', 'waiting', 'completed', 'cancelled']),
  waiting: new Set(['pending', 'in_progress', 'completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

export function taskAccess(principal: Pick<AuthPrincipal, 'role' | 'capabilities'>): TaskAccess {
  return {
    canViewAll: principal.capabilities.has('tasks.manage'),
    canAssign: principal.capabilities.has('tasks.manage'),
    canExecute: principal.capabilities.has('tasks.execute'),
    canManageAutomations: principal.capabilities.has('tasks.automations.manage'),
  };
}

export function effectiveTaskStatus(task: Pick<TaskRecord, 'status' | 'dueAt'>, now = new Date()): TaskDisplayStatus {
  if (task.status === 'completed' || task.status === 'cancelled') return task.status;
  const due = Date.parse(task.dueAt);
  return Number.isFinite(due) && due < now.getTime() ? 'overdue' : task.status;
}

export function canTransitionTask(from: TaskLifecycleStatus, to: TaskLifecycleStatus) {
  return from === to || transitions[from].has(to);
}

export function assertTaskTransition(from: TaskLifecycleStatus, to: TaskLifecycleStatus) {
  if (!canTransitionTask(from, to)) throw new Error(`Task cannot transition from ${from} to ${to}.`);
}

export function taskCompletionBlocked(task: Pick<TaskRecord, 'completionRequirement' | 'checklist' | 'attachments'>) {
  if (task.completionRequirement === 'checklist_required' && task.checklist.some((item) => !item.completed)) {
    return 'Complete every checklist item before closing this task.';
  }
  if (task.completionRequirement === 'attachment_required' && task.attachments.length === 0) {
    return 'Attach the required evidence before closing this task.';
  }
  return null;
}

export function taskProgress(task: Pick<TaskRecord, 'checklist' | 'status'>) {
  if (task.status === 'completed') return 100;
  if (!task.checklist.length) return task.status === 'in_progress' ? 40 : 0;
  const completed = task.checklist.filter((item) => item.completed).length;
  return Math.round((completed / task.checklist.length) * 100);
}

function isoAtOffset(dueMs: number, offsetMs: number) {
  return new Date(dueMs + offsetMs).toISOString();
}

function reminderKey(taskId: string, kind: TaskReminderKind, scheduledFor: string) {
  return `${taskId}:${kind}:${scheduledFor}`;
}

export function buildTaskReminderSchedule(task: TaskRecord): TaskReminderCandidate[] {
  if (terminalStatuses.has(task.status)) return [];
  const dueMs = Date.parse(task.dueAt);
  if (!Number.isFinite(dueMs)) return [];
  const result: TaskReminderCandidate[] = [];
  const add = (kind: TaskReminderKind, scheduledFor: string) => result.push({
    key: reminderKey(task.id, kind, scheduledFor),
    taskId: task.id,
    kind,
    scheduledFor,
    priority: task.priority,
  });

  if (task.reminderPolicy.twentyFourHoursBefore) add('pre_deadline_24h', isoAtOffset(dueMs, -24 * 60 * 60 * 1000));
  if (task.reminderPolicy.threeHoursBefore) add('pre_deadline_3h', isoAtOffset(dueMs, -3 * 60 * 60 * 1000));
  if (task.reminderPolicy.oneHourBefore) add('pre_deadline_1h', isoAtOffset(dueMs, -60 * 60 * 1000));
  if (task.reminderPolicy.deadlineAlert) add('deadline', new Date(dueMs).toISOString());

  return result.sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

export function dueReminderCandidates(args: {
  task: TaskRecord;
  now?: Date;
  alreadyQueuedKeys?: ReadonlySet<string>;
  windowMinutes?: number;
}): TaskReminderCandidate[] {
  const now = args.now ?? new Date();
  const alreadyQueued = args.alreadyQueuedKeys ?? new Set<string>();
  const windowMs = Math.max(1, args.windowMinutes ?? 10) * 60 * 1000;
  const lowerBound = now.getTime() - windowMs;

  const planned = buildTaskReminderSchedule(args.task).filter((candidate) => {
    const scheduledMs = Date.parse(candidate.scheduledFor);
    return scheduledMs <= now.getTime() && scheduledMs >= lowerBound && !alreadyQueued.has(candidate.key);
  });

  if (terminalStatuses.has(args.task.status) || !args.task.reminderPolicy.overdueReminders) return planned;
  const dueMs = Date.parse(args.task.dueAt);
  if (!Number.isFinite(dueMs) || now.getTime() <= dueMs) return planned;

  const intervalHours = Math.max(1, Math.round(args.task.reminderPolicy.overdueIntervalHours || 12));
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const elapsed = now.getTime() - dueMs;
  const occurrence = Math.max(1, Math.floor(elapsed / intervalMs));
  const scheduledMs = dueMs + occurrence * intervalMs;
  if (scheduledMs >= lowerBound && scheduledMs <= now.getTime()) {
    const scheduledFor = new Date(scheduledMs).toISOString();
    const candidate: TaskReminderCandidate = {
      key: reminderKey(args.task.id, 'overdue', scheduledFor),
      taskId: args.task.id,
      kind: 'overdue',
      scheduledFor,
      priority: args.task.priority,
    };
    if (!alreadyQueued.has(candidate.key)) planned.push(candidate);
  }

  return planned.sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

export function taskIsAssignedToPrincipal(task: Pick<TaskRecord, 'assigneeStaffId'>, principal: Pick<AuthPrincipal, 'staffId'>) {
  return Boolean(principal.staffId && task.assigneeStaffId === principal.staffId);
}

export function canExecuteTask(task: Pick<TaskRecord, 'assigneeStaffId'>, principal: Pick<AuthPrincipal, 'staffId' | 'capabilities'>) {
  if (principal.capabilities.has('tasks.manage')) return true;
  return principal.capabilities.has('tasks.execute') && taskIsAssignedToPrincipal(task, principal);
}

export function taskPriorityWeight(priority: TaskRecord['priority']) {
  return priority === 'critical' ? 4 : priority === 'urgent' ? 3 : priority === 'important' ? 2 : 1;
}

export function sortTasksByAttention(tasks: TaskRecord[], now = new Date()) {
  return [...tasks].sort((left, right) => {
    const leftOverdue = effectiveTaskStatus(left, now) === 'overdue' ? 1 : 0;
    const rightOverdue = effectiveTaskStatus(right, now) === 'overdue' ? 1 : 0;
    if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
    const priorityDelta = taskPriorityWeight(right.priority) - taskPriorityWeight(left.priority);
    if (priorityDelta) return priorityDelta;
    return Date.parse(left.dueAt) - Date.parse(right.dueAt);
  });
}
