import type { AuthPrincipal } from '@/lib/security';

export type TaskPriority = 'normal' | 'important' | 'urgent' | 'critical';
export type TaskLifecycleStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
export type TaskDisplayStatus = TaskLifecycleStatus | 'overdue';
export type TaskCompletionRequirement = 'none' | 'checklist_required' | 'attachment_required';
export type TaskReminderKind = 'pre_deadline_24h' | 'pre_deadline_3h' | 'pre_deadline_1h' | 'deadline' | 'overdue';

export type TaskChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  completedAt?: string;
  completedByUserId?: string;
};

export type TaskAttachment = {
  id: string;
  fileName: string;
  storagePath: string;
  mediaUrl?: string;
  contentType?: string;
  size?: number;
  uploadedAt: string;
  uploadedByUserId: string;
  uploadedByName: string;
};

export type TaskReminderPolicy = {
  dailySummary: boolean;
  twentyFourHoursBefore: boolean;
  threeHoursBefore: boolean;
  oneHourBefore: boolean;
  deadlineAlert: boolean;
  overdueReminders: boolean;
  overdueIntervalHours: number;
};

export type TaskRecord = {
  id: string;
  taskNumber: string;
  title: string;
  description: string;
  category?: string;
  priority: TaskPriority;
  status: TaskLifecycleStatus;
  assigneeStaffId: string;
  assigneeNameSnapshot: string;
  assigneePhoneSnapshot?: string;
  dueAt: string;
  checklist: TaskChecklistItem[];
  attachments: TaskAttachment[];
  completionRequirement: TaskCompletionRequirement;
  reminderPolicy: TaskReminderPolicy;
  acknowledgedAt?: string;
  acknowledgedByUserId?: string;
  completedAt?: string;
  completedByUserId?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  createdAt: string;
  createdByUserId: string;
  createdByName: string;
  updatedAt: string;
  updatedByUserId: string;
  updatedByName: string;
  version: number;
};

export type TaskEventType =
  | 'created'
  | 'acknowledged'
  | 'status_changed'
  | 'priority_changed'
  | 'deadline_changed'
  | 'checklist_updated'
  | 'attachment_added'
  | 'comment_added'
  | 'reminder_queued'
  | 'update_requested'
  | 'completed'
  | 'cancelled';

export type TaskEvent = {
  id: string;
  taskId: string;
  type: TaskEventType;
  at: string;
  actorUserId: string;
  actorName: string;
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type TaskAutomationSettings = {
  id: 'task-tracker';
  enabled: boolean;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  twentyFourHoursBefore: boolean;
  threeHoursBefore: boolean;
  oneHourBefore: boolean;
  deadlineAlert: boolean;
  overdueReminders: boolean;
  overdueIntervalHours: number;
  escalateOverdue: boolean;
  escalateAfterHours: number;
  updatedAt?: string;
  updatedByUserId?: string;
  updatedByName?: string;
};

export type TaskReminderCandidate = {
  key: string;
  taskId: string;
  kind: TaskReminderKind;
  scheduledFor: string;
  priority: TaskPriority;
};

export type TaskAssignee = {
  staffId: string;
  name: string;
  phone?: string;
  role?: string;
  employeeType?: string;
};

export type TaskTrackerWorkspace = {
  tasks: TaskRecord[];
  events: TaskEvent[];
  assignees: TaskAssignee[];
  automation: TaskAutomationSettings;
  liveDataAvailable: boolean;
  dataAccessMessage?: string;
};

export type TaskAccess = {
  canViewAll: boolean;
  canAssign: boolean;
  canExecute: boolean;
  canManageAutomations: boolean;
};

export type TaskActorContext = Pick<AuthPrincipal, 'userId' | 'displayName' | 'staffId' | 'role' | 'capabilities'>;

export const DEFAULT_TASK_REMINDER_POLICY: TaskReminderPolicy = {
  dailySummary: true,
  twentyFourHoursBefore: true,
  threeHoursBefore: true,
  oneHourBefore: true,
  deadlineAlert: true,
  overdueReminders: true,
  overdueIntervalHours: 12,
};

export const DEFAULT_TASK_AUTOMATION_SETTINGS: TaskAutomationSettings = {
  id: 'task-tracker',
  enabled: true,
  dailySummaryEnabled: true,
  dailySummaryTime: '08:00',
  twentyFourHoursBefore: true,
  threeHoursBefore: true,
  oneHourBefore: true,
  deadlineAlert: true,
  overdueReminders: true,
  overdueIntervalHours: 12,
  escalateOverdue: true,
  escalateAfterHours: 24,
};
