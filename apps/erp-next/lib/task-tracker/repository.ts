import { loadCanonicalOperationsState, staffDisplayName } from '@/lib/canonical-operations';
import {
  getFirestoreDocument,
  listFirestoreCollection,
  saveFirestoreDocument,
  updateFirestoreDocument,
} from '@/lib/firebase/firestore-rest';
import type { AuthPrincipal } from '@/lib/security';
import {
  assertTaskTransition,
  canExecuteTask,
  effectiveTaskStatus,
  sortTasksByAttention,
  taskCompletionBlocked,
  taskIsAssignedToPrincipal,
} from './policy';
import {
  DEFAULT_TASK_AUTOMATION_SETTINGS,
  DEFAULT_TASK_REMINDER_POLICY,
  type TaskAssignee,
  type TaskAutomationSettings,
  type TaskChecklistItem,
  type TaskEvent,
  type TaskEventType,
  type TaskLifecycleStatus,
  type TaskRecord,
  type TaskTrackerWorkspace,
} from './types';

const TASK_COLLECTION = 'taskRecords';
const TASK_EVENT_COLLECTION = 'taskEvents';
const OUTBOUND_QUEUE_COLLECTION = 'whatsappOutboundQueue';

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 7 ? `297${digits}` : digits;
}

function requireCapability(principal: AuthPrincipal, capability: 'tasks.manage' | 'tasks.execute' | 'tasks.automations.manage') {
  if (!principal.active || !principal.capabilities.has(capability)) throw new Error(`Forbidden: ${capability}`);
}

function newEvent(args: {
  taskId: string;
  type: TaskEventType;
  principal: AuthPrincipal;
  message?: string;
  metadata?: TaskEvent['metadata'];
}): TaskEvent {
  return {
    id: id('task-event'),
    taskId: args.taskId,
    type: args.type,
    at: nowIso(),
    actorUserId: args.principal.userId,
    actorName: args.principal.displayName,
    message: args.message,
    metadata: args.metadata,
  };
}

async function appendEvent(event: TaskEvent) {
  return saveFirestoreDocument(TASK_EVENT_COLLECTION, event);
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

  const operations = await loadCanonicalOperationsState();
  const [taskResult, eventResult, automationResult] = await Promise.allSettled([
    listFirestoreCollection<TaskRecord>(TASK_COLLECTION, 1000),
    listFirestoreCollection<TaskEvent>(TASK_EVENT_COLLECTION, 2000),
    getFirestoreDocument<TaskAutomationSettings>('businessSettings', 'task-tracker'),
  ]);

  const taskAccessError = taskResult.status === 'rejected' ? errorText(taskResult.reason) : '';
  const eventAccessError = eventResult.status === 'rejected' ? errorText(eventResult.reason) : '';
  const liveDataAvailable = taskResult.status === 'fulfilled' && eventResult.status === 'fulfilled';
  const allTasks = taskResult.status === 'fulfilled' ? taskResult.value : [];
  const allEvents = eventResult.status === 'fulfilled' ? eventResult.value : [];
  const storedAutomation = automationResult.status === 'fulfilled' ? automationResult.value : null;

  const visibleTasks = principal.capabilities.has('tasks.manage')
    ? allTasks
    : allTasks.filter((task) => taskIsAssignedToPrincipal(task, principal));
  const visibleIds = new Set(visibleTasks.map((task) => task.id));

  return {
    tasks: sortTasksByAttention(visibleTasks),
    events: allEvents.filter((event) => visibleIds.has(event.taskId)).sort((left, right) => right.at.localeCompare(left.at)),
    assignees: taskAssigneesFromOperations(operations.staffProfiles),
    automation: { ...DEFAULT_TASK_AUTOMATION_SETTINGS, ...(storedAutomation ?? {}) },
    liveDataAvailable,
    dataAccessMessage: liveDataAvailable
      ? undefined
      : `Task Tracker data is not activated in this environment yet. The module is isolated and read-safe until its Firestore access rules are reviewed and approved.${taskAccessError || eventAccessError ? ` (${taskAccessError || eventAccessError})` : ''}`,
  };
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
  requireCapability(args.principal, 'tasks.manage');
  const createdAt = nowIso();
  const taskId = id('task');
  const suffix = taskId.replace(/\D/g, '').slice(-6).padStart(6, '0');
  const checklist: TaskChecklistItem[] = args.checklist
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label, index) => ({ id: `${taskId}-item-${index + 1}`, label, completed: false }));

  if (!args.title.trim()) throw new Error('Task title is required.');
  if (!args.assignee.staffId) throw new Error('Choose an assignee.');
  if (!Number.isFinite(Date.parse(args.dueAt))) throw new Error('Choose a valid task deadline.');

  const task: TaskRecord = {
    id: taskId,
    taskNumber: `TSK-${suffix}`,
    title: args.title.trim(),
    description: args.description.trim(),
    category: args.category?.trim() || undefined,
    priority: args.priority,
    status: 'pending',
    assigneeStaffId: args.assignee.staffId,
    assigneeNameSnapshot: args.assignee.name,
    assigneePhoneSnapshot: normalizePhone(args.assignee.phone) || undefined,
    dueAt: new Date(args.dueAt).toISOString(),
    checklist,
    attachments: [],
    completionRequirement: args.completionRequirement,
    reminderPolicy: { ...DEFAULT_TASK_REMINDER_POLICY },
    createdAt,
    createdByUserId: args.principal.userId,
    createdByName: args.principal.displayName,
    updatedAt: createdAt,
    updatedByUserId: args.principal.userId,
    updatedByName: args.principal.displayName,
    version: 1,
  };

  const saved = await saveFirestoreDocument(TASK_COLLECTION, task);
  await appendEvent(newEvent({ taskId: task.id, type: 'created', principal: args.principal, message: `Task assigned to ${task.assigneeNameSnapshot}.` }));
  return saved;
}

export async function acknowledgeTask(task: TaskRecord, principal: AuthPrincipal) {
  if (!canExecuteTask(task, principal)) throw new Error('You cannot acknowledge this task.');
  if (task.acknowledgedAt) return task;
  const at = nowIso();
  const updated = await updateFirestoreDocument<TaskRecord>(TASK_COLLECTION, task.id, {
    acknowledgedAt: at,
    acknowledgedByUserId: principal.userId,
    updatedAt: at,
    updatedByUserId: principal.userId,
    updatedByName: principal.displayName,
    version: task.version + 1,
  });
  await appendEvent(newEvent({ taskId: task.id, type: 'acknowledged', principal, message: 'Task acknowledged.' }));
  return updated;
}

export async function updateTaskStatus(task: TaskRecord, nextStatus: TaskLifecycleStatus, principal: AuthPrincipal) {
  if (!canExecuteTask(task, principal)) throw new Error('You cannot update this task.');
  assertTaskTransition(task.status, nextStatus);
  if (nextStatus === 'completed') {
    const blocked = taskCompletionBlocked(task);
    if (blocked) throw new Error(blocked);
  }

  const at = nowIso();
  const changes: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: at,
    updatedByUserId: principal.userId,
    updatedByName: principal.displayName,
    version: task.version + 1,
  };
  if (nextStatus === 'completed') {
    changes.completedAt = at;
    changes.completedByUserId = principal.userId;
  }
  if (nextStatus === 'cancelled') {
    changes.cancelledAt = at;
    changes.cancelledByUserId = principal.userId;
  }

  const updated = await updateFirestoreDocument<TaskRecord>(TASK_COLLECTION, task.id, changes);
  await appendEvent(newEvent({
    taskId: task.id,
    type: nextStatus === 'completed' ? 'completed' : nextStatus === 'cancelled' ? 'cancelled' : 'status_changed',
    principal,
    message: `Status changed from ${task.status} to ${nextStatus}.`,
    metadata: { from: task.status, to: nextStatus },
  }));
  return updated;
}

export async function updateTaskChecklist(task: TaskRecord, checklist: TaskChecklistItem[], principal: AuthPrincipal) {
  if (!canExecuteTask(task, principal)) throw new Error('You cannot update this task checklist.');
  const at = nowIso();
  const normalized = checklist.map((item) => ({
    ...item,
    completedAt: item.completed ? item.completedAt || at : undefined,
    completedByUserId: item.completed ? item.completedByUserId || principal.userId : undefined,
  }));
  const updated = await updateFirestoreDocument<TaskRecord>(TASK_COLLECTION, task.id, {
    checklist: normalized,
    updatedAt: at,
    updatedByUserId: principal.userId,
    updatedByName: principal.displayName,
    version: task.version + 1,
  });
  await appendEvent(newEvent({ taskId: task.id, type: 'checklist_updated', principal }));
  return updated;
}

export async function addTaskComment(task: TaskRecord, text: string, principal: AuthPrincipal) {
  if (!canExecuteTask(task, principal) && !principal.capabilities.has('tasks.manage')) throw new Error('You cannot comment on this task.');
  const message = text.trim();
  if (!message) throw new Error('Write a comment first.');
  return appendEvent(newEvent({ taskId: task.id, type: 'comment_added', principal, message }));
}

export function taskReminderMessage(task: TaskRecord, mode: 'update_request' | 'deadline' | 'overdue' = 'deadline') {
  const due = new Intl.DateTimeFormat('en-AW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Aruba' }).format(new Date(task.dueAt));
  if (mode === 'update_request') return `Hi ${task.assigneeNameSnapshot}, an update was requested for ${task.taskNumber} – ${task.title}. Please update the task status in DEMAC ERP. Deadline: ${due}.`;
  if (mode === 'overdue') return `Hi ${task.assigneeNameSnapshot}, ${task.taskNumber} – ${task.title} is overdue. Please update or complete it in DEMAC ERP as soon as possible. Original deadline: ${due}.`;
  return `Hi ${task.assigneeNameSnapshot}, reminder for ${task.taskNumber} – ${task.title}. Deadline: ${due}. Current status: ${effectiveTaskStatus(task)}.`;
}

async function queueTaskWhatsApp(task: TaskRecord, text: string, principal: AuthPrincipal, reason: string) {
  const to = normalizePhone(task.assigneePhoneSnapshot);
  if (!to) throw new Error(`${task.assigneeNameSnapshot} does not have a WhatsApp phone number on the canonical staff profile.`);
  const queuedAt = nowIso();
  const queueId = id('task-wa');
  await saveFirestoreDocument(OUTBOUND_QUEUE_COLLECTION, {
    id: queueId,
    provider: 'wacli',
    status: 'queued',
    type: 'text',
    to,
    text,
    taskId: task.id,
    taskNumber: task.taskNumber,
    reason,
    createdByUserId: principal.userId,
    createdByName: principal.displayName,
    createdAt: queuedAt,
  });
  await appendEvent(newEvent({ taskId: task.id, type: reason === 'update_request' ? 'update_requested' : 'reminder_queued', principal, message: text, metadata: { queueId, reason } }));
  return queueId;
}

export async function requestTaskUpdate(task: TaskRecord, principal: AuthPrincipal) {
  requireCapability(principal, 'tasks.manage');
  return queueTaskWhatsApp(task, taskReminderMessage(task, 'update_request'), principal, 'update_request');
}

export async function saveTaskAutomationSettings(settings: TaskAutomationSettings, principal: AuthPrincipal) {
  requireCapability(principal, 'tasks.automations.manage');
  const document: TaskAutomationSettings = {
    ...settings,
    id: 'task-tracker',
    updatedAt: nowIso(),
    updatedByUserId: principal.userId,
    updatedByName: principal.displayName,
  };
  return saveFirestoreDocument('businessSettings', document);
}

export function formatDailyTaskSummary(tasks: TaskRecord[], assigneeName: string, now = new Date()) {
  const active = sortTasksByAttention(tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)), now);
  const formatter = new Intl.DateTimeFormat('en-AW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Aruba' });
  const lines = active.map((task, index) => `${index + 1}. ${task.taskNumber} – ${task.title}\n   ${effectiveTaskStatus(task, now).toUpperCase()} · Due ${formatter.format(new Date(task.dueAt))}`);
  return `Good morning, ${assigneeName}. Here are your pending DEMAC tasks:\n\n${lines.length ? lines.join('\n\n') : 'No pending tasks today.'}\n\n— DEMAC ERP`;
}
