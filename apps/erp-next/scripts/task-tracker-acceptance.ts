import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roleCapabilities, type AuthPrincipal } from '../lib/security';
import {
  assertTaskTransition,
  buildTaskReminderSchedule,
  canExecuteTask,
  dueReminderCandidates,
  effectiveTaskStatus,
  sortTasksByAttention,
  taskCompletionBlocked,
} from '../lib/task-tracker/policy';
import { DEFAULT_TASK_REMINDER_POLICY, type TaskRecord } from '../lib/task-tracker/types';

const manager: AuthPrincipal = {
  userId: 'owner-1', displayName: 'Owner', role: 'super_admin', active: true, staffId: 'STAFF-OWNER', capabilities: roleCapabilities.super_admin,
};
const operator: AuthPrincipal = {
  userId: 'operator-1', displayName: 'Operator', role: 'office_operator', active: true, staffId: 'STAFF-OP-1', capabilities: roleCapabilities.office_operator,
};

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1', taskNumber: 'TSK-000001', title: 'Delta Blue Report', description: 'Prepare the report.', category: 'Report',
    priority: 'important', status: 'pending', assigneeStaffId: 'STAFF-OP-1', assigneeNameSnapshot: 'Scarlett', assigneePhoneSnapshot: '2975600000',
    dueAt: '2026-09-12T14:00:00.000Z', checklist: [{ id: 'i-1', label: 'Draft report', completed: false }], attachments: [],
    completionRequirement: 'checklist_required', reminderPolicy: { ...DEFAULT_TASK_REMINDER_POLICY }, createdAt: '2026-09-11T12:00:00.000Z',
    createdByUserId: manager.userId, createdByName: manager.displayName, updatedAt: '2026-09-11T12:00:00.000Z', updatedByUserId: manager.userId,
    updatedByName: manager.displayName, version: 1, ...overrides,
  };
}

function shouldDeriveOverdueWithoutPersistingASecondStatus() {
  const record = task({ status: 'in_progress', dueAt: '2026-09-11T12:00:00.000Z' });
  assert.equal(effectiveTaskStatus(record, new Date('2026-09-11T13:00:00.000Z')), 'overdue');
  assert.equal(record.status, 'in_progress');
}
function shouldEnforceTerminalLifecycle() {
  assert.doesNotThrow(() => assertTaskTransition('pending', 'in_progress'));
  assert.doesNotThrow(() => assertTaskTransition('waiting', 'completed'));
  assert.throws(() => assertTaskTransition('completed', 'in_progress'), /cannot transition/i);
  assert.throws(() => assertTaskTransition('cancelled', 'pending'), /cannot transition/i);
}
function shouldEnforceCompletionEvidence() {
  const checklistTask = task();
  assert.match(taskCompletionBlocked(checklistTask) || '', /checklist/i);
  assert.equal(taskCompletionBlocked({ ...checklistTask, checklist: [{ ...checklistTask.checklist[0], completed: true }] }), null);
  const attachmentTask = task({ completionRequirement: 'attachment_required', checklist: [] });
  assert.match(taskCompletionBlocked(attachmentTask) || '', /attach/i);
  assert.equal(taskCompletionBlocked({ ...attachmentTask, attachments: [{ id: 'a-1', fileName: 'proof.jpg', storagePath: 'task-evidence/task-1/a-1-proof.jpg', uploadedAt: '2026-09-11T13:00:00.000Z', uploadedByUserId: operator.userId, uploadedByName: operator.displayName }] }), null);
}
function shouldScopeExecutionToAssignedOperator() {
  const assigned = task();
  const other = { ...operator, staffId: 'STAFF-OTHER' };
  assert.equal(canExecuteTask(assigned, operator), true);
  assert.equal(canExecuteTask(assigned, other), false);
  assert.equal(canExecuteTask(assigned, manager), true);
}
function shouldPlanDeterministicDeadlineReminders() {
  const record = task({ dueAt: '2026-09-12T14:00:00.000Z' });
  const schedule = buildTaskReminderSchedule(record);
  assert.deepEqual(schedule.map((item) => item.kind), ['pre_deadline_24h', 'pre_deadline_3h', 'pre_deadline_1h', 'deadline']);
  assert.equal(schedule[0].scheduledFor, '2026-09-11T14:00:00.000Z');
  assert.equal(schedule[3].scheduledFor, '2026-09-12T14:00:00.000Z');
  assert.equal(new Set(schedule.map((item) => item.key)).size, schedule.length);
}
function shouldNotDuplicateAlreadyQueuedReminder() {
  const record = task({ dueAt: '2026-09-12T14:00:00.000Z' });
  const scheduled = buildTaskReminderSchedule(record)[0];
  const candidates = dueReminderCandidates({ task: record, now: new Date('2026-09-11T14:05:00.000Z'), windowMinutes: 10, alreadyQueuedKeys: new Set([scheduled.key]) });
  assert.equal(candidates.length, 0);
}
function shouldGenerateOverdueCadenceOnlyWhileOpen() {
  const open = task({ dueAt: '2026-09-11T00:00:00.000Z', reminderPolicy: { ...DEFAULT_TASK_REMINDER_POLICY, overdueIntervalHours: 12 } });
  const candidates = dueReminderCandidates({ task: open, now: new Date('2026-09-11T12:05:00.000Z'), windowMinutes: 10 });
  assert.equal(candidates.some((item) => item.kind === 'overdue'), true);
  const completed = { ...open, status: 'completed' as const };
  assert.equal(dueReminderCandidates({ task: completed, now: new Date('2026-09-11T12:05:00.000Z'), windowMinutes: 10 }).some((item) => item.kind === 'overdue'), false);
}
function shouldSortAttentionWithoutScheduleDependency() {
  const normal = task({ id: 'normal', taskNumber: 'TSK-2', priority: 'normal', dueAt: '2026-09-13T12:00:00.000Z' });
  const critical = task({ id: 'critical', taskNumber: 'TSK-3', priority: 'critical', dueAt: '2026-09-13T12:00:00.000Z' });
  const overdue = task({ id: 'overdue', taskNumber: 'TSK-1', priority: 'normal', dueAt: '2026-09-10T12:00:00.000Z' });
  assert.deepEqual(sortTasksByAttention([normal, critical, overdue], new Date('2026-09-11T12:00:00.000Z')).map((item) => item.id), ['overdue', 'critical', 'normal']);
}
function shouldGiveOnlyApprovedRolesTaskCapabilities() {
  assert.equal(roleCapabilities.super_admin.has('tasks.manage'), true);
  assert.equal(roleCapabilities.operations.has('tasks.manage'), true);
  assert.equal(roleCapabilities.project_manager.has('tasks.manage'), true);
  assert.equal(roleCapabilities.office_operator.has('tasks.execute'), true);
  assert.equal(roleCapabilities.office_operator.has('tasks.manage'), false);
  assert.equal(roleCapabilities.technician.has('tasks.view'), false);
  assert.equal(roleCapabilities.finance.has('tasks.view'), false);
}
function shouldPreservePurposeBuiltMobileAndEvidenceUx() {
  const component = readFileSync(join(process.cwd(), 'components/task-tracker/task-tracker-workspace.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'components/task-tracker/task-tracker.module.css'), 'utf8');
  assert.match(component, /mobileTaskList/);
  assert.match(component, /mobileBoardTabs/);
  assert.match(component, /Attach Evidence/);
  assert.match(component, /attachment_required/);
  assert.match(component, /downloadTaskEvidence/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.desktopTable\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.mobileTaskList\s*\{[^}]*display:/s);
  assert.match(css, /\.drawer\s*\{[^}]*width:\s*100%/s);
}

shouldDeriveOverdueWithoutPersistingASecondStatus();
shouldEnforceTerminalLifecycle();
shouldEnforceCompletionEvidence();
shouldScopeExecutionToAssignedOperator();
shouldPlanDeterministicDeadlineReminders();
shouldNotDuplicateAlreadyQueuedReminder();
shouldGenerateOverdueCadenceOnlyWhileOpen();
shouldSortAttentionWithoutScheduleDependency();
shouldGiveOnlyApprovedRolesTaskCapabilities();
shouldPreservePurposeBuiltMobileAndEvidenceUx();

console.log('Task Tracker acceptance checks passed: lifecycle, authorization, reminders, evidence completion, and mobile UX contract verified.');
