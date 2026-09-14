'use strict';

const {
  formatArubaDateTime,
  queueDocumentId,
} = require('./taskReminderService');

function compactRequirements(value, maxLength = 2000) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function assignmentNotificationMessage(task, assigneeName) {
  const name = String(assigneeName || task?.assigneeNameSnapshot || 'team member').trim();
  const number = String(task?.taskNumber || 'Task').trim();
  const title = String(task?.title || 'Untitled task').trim();
  const deadline = formatArubaDateTime(task?.dueAt);
  const requirements = compactRequirements(task?.description);
  const lines = [
    `Hi ${name}, you have a new DEMAC task.`,
    '',
    number,
    `*${title}*`,
    '',
    `*Deadline:* ${deadline}`,
  ];
  if (requirements) lines.push('', '*Requirements:*', requirements);
  lines.push('', '────────────', '', 'Please open DEMAC ERP to review and acknowledge this task.', '', '— DEMAC ERP');
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
