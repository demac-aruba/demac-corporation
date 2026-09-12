import { loadCanonicalOperationsState, staffDisplayName } from '@/lib/canonical-operations';
import type { AuthPrincipal } from '@/lib/security';
import { effectiveTaskStatus, sortTasksByAttention, taskIsAssignedToPrincipal } from './policy';
import {
  downloadTaskAttachment,
  taskTrackerRequest,
  TaskTrackerApiError,
  uploadTaskAttachment,
} from './api';
import {
  DEFAULT_TASK_AUTOMATION_SETTINGS,
  type TaskAssignee,
  type TaskAutomationSettings,
  type TaskChecklistItem,
  type TaskEvent,
  type TaskLifecycleStatus,
  type TaskRecord,
  type TaskTrackerWorkspace,
} from './types';

function normalizePhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 7 ? `297${digits}` : digits;
}

function taskAssigneesFromOperations(profiles: Awaited<ReturnType<typeof loadCanonicalOperationsState>>['staffProfiles']): TaskAssignee[] {
  return profiles
    .filter((profile) => profile.active !== false)
    .map((profile) => ({
      staffId: profile.id,
      name: staffDisplayName(profile),
      phone: normalizePhone(profile.phone) || undefined,
      role: profile.role,
      employeeType: profile.employeeType,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadTaskTrackerWorkspace(principal: AuthPrincipal): Promise<TaskTrackerWorkspace> {
  if (!principal.capabilities.has('tasks.view')) throw new Error('You do not have access to Task Tracker.');
  try {
    const result = await taskTrackerRequest<TaskTrackerWorkspace>('workspace.load');
    const visibleTasks = principal.capabilities.has('tasks.manage')
      ? result.tasks
      : result.tasks.filter((task) => taskIsAssignedToPrincipal(task, principal));
    const visibleIds = new Set(visibleTasks.map((task) => task.id));
    return {
      ...result,
      tasks: sortTasksByAttention(visibleTasks),
      events: result.events.filter((event) => visibleIds.has(event.taskId)).sort((left, right) => right.at.localeCompare(left.at)),
      automation: { ...DEFAULT_TASK_AUTOMATION_SETTINGS, ...result.automation },
    };
  } catch (error) {
    let assignees: TaskAssignee[] = [];
    if (principal.capabilities.has('tasks.manage')) {
      try {
        const operations = await loadCanonicalOperationsState();
        assignees = taskAssigneesFromOperations(operations.staffProfiles);
      } catch {
        assignees = [];
      }
    }
    const reason = error instanceof TaskTrackerApiError ? error.message : error instanceof Error ? error.message : String(error);
    return {
      tasks: [],
      events: [],
      assignees,
      automation: { ...DEFAULT_TASK_AUTOMATION_SETTINGS },
      liveDataAvailable: false,
      dataAccessMessage: `Task Tracker is isolated in safe preview mode. Server-side persistence has not been activated in this environment yet. (${reason})`,
    };
  }
}

export async function createTask(args: {
  principal: AuthPrincipal;
  title: string;
  description: string;
  category?: string;
  priority: TaskRecord['priority'];
  assignee: TaskAssignee;
  dueAt: string;
  checklist: string[];
  completionRequirement: TaskRecord['completionRequirement'];
}): Promise<TaskRecord> {
  if (!args.principal.capabilities.has('tasks.manage')) throw new Error('You cannot assign tasks.');
  return taskTrackerRequest<TaskRecord>('task.create', {
    title: args.title,
    description: args.description,
    category: args.category,
    priority: args.priority,
    assigneeStaffId: args.assignee.staffId,
    dueAt: args.dueAt,
    checklist: args.checklist,
    completionRequirement: args.completionRequirement,
  });
}

export async function acknowledgeTask(task: TaskRecord, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.execute') && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot acknowledge this task.');
  return taskTrackerRequest<TaskRecord>('task.acknowledge', { taskId: task.id, expectedVersion: task.version });
}

export async function updateTaskStatus(task: TaskRecord, nextStatus: TaskLifecycleStatus, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.execute') && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot update this task.');
  return taskTrackerRequest<TaskRecord>('task.status', { taskId: task.id, expectedVersion: task.version, status: nextStatus });
}

export async function updateTaskChecklist(task: TaskRecord, checklist: TaskChecklistItem[], principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.execute') && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot update this task checklist.');
  return taskTrackerRequest<TaskRecord>('task.checklist', { taskId: task.id, expectedVersion: task.version, checklist });
}

export async function addTaskEvidence(task: TaskRecord, file: File, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.execute') && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot add evidence to this task.');
  return uploadTaskAttachment({ taskId: task.id, expectedVersion: task.version, file });
}

export async function downloadTaskEvidence(task: TaskRecord, attachmentId: string, fileName: string, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.execute') && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot access evidence for this task.');
  return downloadTaskAttachment({ taskId: task.id, attachmentId, fileName });
}

export async function addTaskComment(task: TaskRecord, text: string, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.execute') && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot comment on this task.');
  const message = text.trim();
  if (!message) throw new Error('Write a comment first.');
  return taskTrackerRequest<TaskEvent>('comment.add', { taskId: task.id, message });
}

export async function requestTaskUpdate(task: TaskRecord, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.manage')) throw new Error('You cannot request task updates.');
  return taskTrackerRequest<{ queueId: string }>('reminder.request', { taskId: task.id });
}

export async function saveTaskAutomationSettings(settings: TaskAutomationSettings, principal: AuthPrincipal) {
  if (!principal.capabilities.has('tasks.automations.manage')) throw new Error('You cannot change task automation rules.');
  return taskTrackerRequest<TaskAutomationSettings>('automation.save', settings as unknown as Record<string, unknown>);
}

export function taskReminderMessage(task: TaskRecord, mode: 'update_request' | 'deadline' | 'overdue' = 'deadline') {
  const due = new Intl.DateTimeFormat('en-AW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Aruba' }).format(new Date(task.dueAt));
  if (mode === 'update_request') return `Hi ${task.assigneeNameSnapshot}, an update was requested for ${task.taskNumber} – ${task.title}. Please update the task status in DEMAC ERP. Deadline: ${due}.`;
  if (mode === 'overdue') return `Hi ${task.assigneeNameSnapshot}, ${task.taskNumber} – ${task.title} is overdue. Please update or complete it in DEMAC ERP as soon as possible. Original deadline: ${due}.`;
  return `Hi ${task.assigneeNameSnapshot}, reminder for ${task.taskNumber} – ${task.title}. Deadline: ${due}. Current status: ${effectiveTaskStatus(task)}.`;
}

export function formatDailyTaskSummary(tasks: TaskRecord[], assigneeName: string, now = new Date()) {
  const active = sortTasksByAttention(tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)), now);
  const formatter = new Intl.DateTimeFormat('en-AW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Aruba' });
  const lines = active.map((task, index) => `${index + 1}. ${task.taskNumber} – ${task.title}\n   ${effectiveTaskStatus(task, now).toUpperCase()} · Due ${formatter.format(new Date(task.dueAt))}`);
  return `Good morning, ${assigneeName}. Here are your pending DEMAC tasks:\n\n${lines.length ? lines.join('\n\n') : 'No pending tasks today.'}\n\n— DEMAC ERP`;
}
