'use strict';

const crypto = require('node:crypto');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const logger = require('firebase-functions/logger');
const { onRequest } = require('firebase-functions/v2/https');
const {
  MAX_TASK_ATTACHMENT_BYTES,
  attachmentContentDisposition,
  taskAttachmentStoragePath,
  validateTaskAttachment,
} = require('./taskAttachmentPolicy');

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();
const storage = getStorage();
const REGION = 'us-central1';
const TASK_COLLECTION = 'taskRecords';
const EVENT_COLLECTION = 'taskEvents';
const SETTINGS_REF = db.collection('businessSettings').doc('task-tracker');
const MANAGER_ROLES = new Set(['super_admin', 'operations', 'project_manager']);

function cleanText(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeRole(value) {
  const role = cleanText(value, 50).toLowerCase().replace(/[\s-]+/g, '_');
  if (['owner', 'admin', 'superadmin', 'super_admin'].includes(role)) return 'super_admin';
  if (['operation', 'operations', 'manager', 'supervisor'].includes(role)) return 'operations';
  if (['office', 'operator', 'office_operator'].includes(role)) return 'office_operator';
  if (['project_manager', 'projects'].includes(role)) return 'project_manager';
  return null;
}

function setCors(request, response) {
  const origin = request.get('origin') || '*';
  response.set('Access-Control-Allow-Origin', origin);
  response.set('Vary', 'Origin');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.set('Access-Control-Max-Age', '3600');
  response.set('Cache-Control', 'no-store');
  response.set('X-Content-Type-Options', 'nosniff');
}

async function requireActor(request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.get('authorization') || '');
  if (!match) throw fail('unauthenticated', 'Sign in to DEMAC ERP.', 401);
  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1], true);
  } catch {
    throw fail('unauthenticated', 'Your DEMAC ERP session expired. Sign in again.', 401);
  }
  const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
  if (!profileSnapshot.exists) throw fail('not-provisioned', 'This account is not provisioned for DEMAC ERP.', 403);
  const profile = profileSnapshot.data() || {};
  if (profile.active !== true) throw fail('inactive', 'This DEMAC ERP account is inactive.', 403);
  const role = normalizeRole(profile.role);
  if (!role) throw fail('task-tracker-forbidden', 'Your ERP role does not have Task Tracker access.', 403);
  return {
    uid: decoded.uid,
    name: cleanText(profile.name || profile.displayName || decoded.name || decoded.email || 'DEMAC User', 160),
    role,
    staffId: cleanText(profile.staffId, 160) || null,
  };
}

async function requireBackendEnabled() {
  const snapshot = await SETTINGS_REF.get();
  if (!snapshot.exists || snapshot.data()?.backendEnabled !== true) {
    throw fail('task-tracker-not-active', 'Task Tracker persistence is not activated yet. No evidence was changed.', 503);
  }
}

function requireTaskAccess(actor, task) {
  if (MANAGER_ROLES.has(actor.role)) return;
  if (actor.role !== 'office_operator' || !actor.staffId || actor.staffId !== task.assigneeStaffId) {
    throw fail('task-forbidden', 'You may only access evidence for tasks assigned to your own operator profile.', 403);
  }
}

async function loadTask(taskId) {
  const id = cleanText(taskId, 180);
  if (!id) throw fail('task-required', 'Task id is required.');
  const snapshot = await db.collection(TASK_COLLECTION).doc(id).get();
  if (!snapshot.exists) throw fail('task-not-found', 'This task no longer exists.', 404);
  return { id: snapshot.id, ...snapshot.data() };
}

function rawRequestBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  return Buffer.alloc(0);
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function isoNow() {
  return new Date().toISOString();
}

async function uploadEvidence(request, actor) {
  await requireBackendEnabled();
  const taskId = cleanText(request.query.taskId, 180);
  const expectedVersion = Number(request.query.expectedVersion);
  const task = await loadTask(taskId);
  requireTaskAccess(actor, task);
  if (['completed', 'cancelled'].includes(task.status)) throw fail('task-terminal', 'Evidence cannot be added after a task is closed.', 409);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw fail('version-required', 'Refresh the task and retry the evidence upload.', 409);
  if (Number(task.version || 1) !== expectedVersion) throw fail('version-conflict', 'This task changed while you were viewing it. Refresh and retry.', 409);

  const bytes = rawRequestBody(request);
  const validation = validateTaskAttachment({
    fileName: request.query.fileName,
    contentType: request.get('content-type'),
    size: bytes.length,
  });
  const attachmentId = randomId('task-file');
  const storagePath = taskAttachmentStoragePath(task.id, attachmentId, validation.fileName);
  const bucket = storage.bucket();
  const object = bucket.file(storagePath);
  const uploadedAt = isoNow();
  const attachment = {
    id: attachmentId,
    fileName: validation.fileName,
    storagePath,
    contentType: validation.contentType,
    size: validation.size,
    uploadedAt,
    uploadedByUserId: actor.uid,
    uploadedByName: actor.name,
  };

  await object.save(bytes, {
    resumable: false,
    metadata: {
      contentType: validation.contentType,
      cacheControl: 'private, no-store',
      metadata: {
        taskId: task.id,
        attachmentId,
        uploadedByUserId: actor.uid,
      },
    },
  });

  try {
    let updatedTask;
    await db.runTransaction(async (transaction) => {
      const taskRef = db.collection(TASK_COLLECTION).doc(task.id);
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists) throw fail('task-not-found', 'This task no longer exists.', 404);
      const current = { id: snapshot.id, ...snapshot.data() };
      requireTaskAccess(actor, current);
      if (Number(current.version || 1) !== expectedVersion) throw fail('version-conflict', 'This task changed during the upload. Refresh and retry.', 409);
      if (['completed', 'cancelled'].includes(current.status)) throw fail('task-terminal', 'Evidence cannot be added after a task is closed.', 409);
      const attachments = [...(Array.isArray(current.attachments) ? current.attachments : []), attachment].slice(-100);
      const patch = {
        attachments,
        updatedAt: uploadedAt,
        updatedByUserId: actor.uid,
        updatedByName: actor.name,
        version: Number(current.version || 1) + 1,
      };
      updatedTask = { ...current, ...patch };
      const eventId = randomId('task-event');
      transaction.set(taskRef, patch, { merge: true });
      transaction.set(db.collection(EVENT_COLLECTION).doc(eventId), {
        id: eventId,
        taskId: task.id,
        type: 'attachment_added',
        at: uploadedAt,
        actorUserId: actor.uid,
        actorName: actor.name,
        message: `Evidence attached: ${validation.fileName}`,
        metadata: { attachmentId, fileName: validation.fileName, size: validation.size },
      });
    });
    return { attachment, task: updatedTask };
  } catch (error) {
    await object.delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  }
}

async function downloadEvidence(request, actor, response) {
  // `backendEnabled` is a write/automation kill switch. Existing evidence remains
  // readable to an already-authorized Task actor for audit and reconciliation.
  const task = await loadTask(request.query.taskId);
  requireTaskAccess(actor, task);
  const attachmentId = cleanText(request.query.attachmentId, 200);
  const attachment = (Array.isArray(task.attachments) ? task.attachments : []).find((item) => item?.id === attachmentId);
  if (!attachment?.storagePath) throw fail('attachment-not-found', 'This task evidence file no longer exists.', 404);

  const [bytes] = await storage.bucket().file(String(attachment.storagePath)).download();
  response.set('Content-Type', cleanText(attachment.contentType, 150) || 'application/octet-stream');
  response.set('Content-Length', String(bytes.length));
  response.set('Content-Disposition', attachmentContentDisposition(attachment.fileName || 'evidence'));
  response.set('Content-Security-Policy', "sandbox; default-src 'none'");
  response.status(200).send(bytes);
}

exports.taskTrackerAttachments = onRequest(
  { region: REGION, memory: '512MiB', timeoutSeconds: 120, maxInstances: 20 },
  async (request, response) => {
    setCors(request, response);
    if (request.method === 'OPTIONS') return response.status(204).send('');
    try {
      const actor = await requireActor(request);
      if (request.method === 'POST') {
        const contentLength = Number(request.get('content-length') || 0);
        if (contentLength > MAX_TASK_ATTACHMENT_BYTES) throw fail('attachment-too-large', 'Task evidence files must be 20 MB or smaller.', 413);
        const result = await uploadEvidence(request, actor);
        return response.status(200).json({ ok: true, result });
      }
      if (request.method === 'GET') return downloadEvidence(request, actor, response);
      return response.status(405).json({ ok: false, code: 'method', message: 'Use GET or POST.' });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) logger.error('Task Tracker evidence request failed.', error);
      return response.status(status).json({
        ok: false,
        code: status < 500 ? error.code || 'request-failed' : 'service-unavailable',
        message: status < 500 ? error.message : 'Task evidence could not be completed. No change has been reported as saved.',
      });
    }
  },
);
