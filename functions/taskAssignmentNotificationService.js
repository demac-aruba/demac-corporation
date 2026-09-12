'use strict';

const {
  formatArubaDateTime,
  queueDocumentId,
} = require('./taskReminderService');

function titleCase(value) {
  return String(value || 'normal')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactRequirements(value, maxLength = 320) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function assignmentNotificationMessage(task, assigneeName) {
  const name = String(assigneeName || task?.assigneeNameSnapshot || 'team member').trim();
  const number = String(task?.taskNumber || 'Task').trim();
  const title = String(task?.title || 'Untitled task').trim();
  const priority = titleCase(task?.priority || 'normal');
  const deadline = formatArubaDateTime(task?.dueAt);
  const requirements = compactRequirements(task?.description);
  const lines = [
    `Hi ${name}, you have a new DEMAC task.`,
    '',
    `${number} – ${title}`,
    `Priority: ${priority}`,
    `Deadline: ${deadline} (Aruba time)`,
  ];
  if (requirements) lines.push(`Requirements: ${requirements}`);
  lines.push('', 'Please open DEMAC ERP to review and acknowledge this task.', '', '— DEMAC ERP');
  return lines.join('\n');
}

function assignmentQueueId(taskId) {
  return queueDocumentId('task-assignment', String(taskId || 'unknown'));
}

function assignmentEventId(taskId) {
  return queueDocumentId('task-event-assignment', String(taskId || 'unknown'));
}

module.exports = {
  assignmentEventId,
  assignmentNotificationMessage,
  assignmentQueueId,
  compactRequirements,
};
