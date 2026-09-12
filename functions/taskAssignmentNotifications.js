'use strict';

const { getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { normalizeArubaPhone } = require('./taskReminderService');
const {
  assignmentEventId,
  assignmentNotificationMessage,
  assignmentQueueId,
} = require('./taskAssignmentNotificationService');

if (!getApps().length) initializeApp();

const db = getFirestore();
const REGION = 'us-central1';
const SETTINGS_REF = db.collection('businessSettings').doc('task-tracker');
const OUTBOUND_QUEUE_COLLECTION = 'whatsappOutboundQueue';
const EVENT_COLLECTION = 'taskEvents';

async function taskTrackerBackendEnabled() {
  const snapshot = await SETTINGS_REF.get();
  return snapshot.exists && snapshot.data()?.backendEnabled === true;
}

async function canonicalAssigneeContact(task) {
  const staffId = String(task?.assigneeStaffId || '').trim();
  if (!staffId) {
    return {
      name: String(task?.assigneeNameSnapshot || 'team member').trim(),
      phone: normalizeArubaPhone(task?.assigneePhoneSnapshot),
      active: true,
    };
  }
  const snapshot = await db.collection('staffProfiles').doc(staffId).get();
  const profile = snapshot.exists ? snapshot.data() || {} : {};
  return {
    name: String(profile.name || profile.displayName || task?.assigneeNameSnapshot || 'team member').trim(),
    phone: normalizeArubaPhone(profile.phone || profile.mobile || task?.assigneePhoneSnapshot),
    active: snapshot.exists ? profile.active !== false : true,
  };
}

async function queueAssignmentNotification(task) {
  if (!task?.id) return { queued: false, reason: 'missing-task-id' };
  if (!(await taskTrackerBackendEnabled())) return { queued: false, reason: 'backend-disabled' };

  const contact = await canonicalAssigneeContact(task);
  if (contact.active === false) return { queued: false, reason: 'assignee-inactive' };
  if (!contact.phone) return { queued: false, reason: 'missing-phone' };

  const queueId = assignmentQueueId(task.id);
  const eventId = assignmentEventId(task.id);
  const queueRef = db.collection(OUTBOUND_QUEUE_COLLECTION).doc(queueId);
  const eventRef = db.collection(EVENT_COLLECTION).doc(eventId);
  const text = assignmentNotificationMessage(task, contact.name);
  let created = false;

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(queueRef);
    if (existing.exists) return;
    created = true;
    transaction.create(queueRef, {
      id: queueId,
      provider: 'wacli',
      status: 'queued',
      type: 'text',
      to: contact.phone,
      text,
      reason: 'task_assigned',
      source: 'task-tracker-assignment',
      taskId: task.id,
      taskNumber: task.taskNumber || null,
      createdByUserId: task.createdByUserId || 'task-tracker',
      createdByName: task.createdByName || 'Task Tracker',
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(eventRef, {
      id: eventId,
      taskId: task.id,
      type: 'reminder_queued',
      at: new Date().toISOString(),
      actorUserId: 'task-assignment-automation',
      actorName: 'Task Assignment Automation',
      message: 'Immediate WhatsApp task assignment notification queued.',
      metadata: { queueId, reason: 'task_assigned' },
    });
  });

  return { queued: created, reason: created ? 'queued' : 'already-queued', queueId };
}

exports.notifyTaskAssigneeOnCreate = onDocumentCreated(
  {
    document: 'taskRecords/{taskId}',
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 20,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const task = { id: snapshot.id, ...snapshot.data() };
    try {
      const result = await queueAssignmentNotification(task);
      if (!result.queued && result.reason !== 'already-queued' && result.reason !== 'backend-disabled') {
        logger.warn('Task assignment WhatsApp was not queued.', { taskId: task.id, reason: result.reason });
      }
      if (result.queued) logger.info('Task assignment WhatsApp queued.', { taskId: task.id, queueId: result.queueId });
    } catch (error) {
      logger.error('Task assignment WhatsApp trigger failed.', { taskId: task.id, error: error?.message || String(error) });
      throw error;
    }
  },
);

module.exports.queueAssignmentNotification = queueAssignmentNotification;
