'use strict';

const crypto = require('node:crypto');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onRequest } = require('firebase-functions/v2/https');

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();
const REGION = 'us-central1';
const TASK_COLLECTION = 'taskRecords';
const EVENT_COLLECTION = 'taskEvents';
const SETTINGS_REF = db.collection('businessSettings').doc('task-tracker');
const MANAGER_ROLES = new Set(['super_admin', 'operations', 'project_manager']);
const CHECKPOINT_STATUSES = new Set(['pending', 'in_progress', 'waiting', 'blocked', 'completed']);
const APPROVAL_DECISIONS = new Set(['approved', 'rejected']);

function cleanText(value, maxLength = 2000) {
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
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
  const snapshot = await db.collection('users').doc(decoded.uid).get();
  if (!snapshot.exists) throw fail('not-provisioned', 'This account is not provisioned for DEMAC ERP.', 403);
  const profile = snapshot.data() || {};
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

function isManager(actor) {
  return MANAGER_ROLES.has(actor.role);
}

function requireManager(actor) {
  if (!isManager(actor)) throw fail('manager-required', 'Only authorized DEMAC managers may configure or approve checkpoints.', 403);
}

function requireTaskExecutor(actor, task) {
  if (isManager(actor)) return;
  if (actor.role !== 'office_operator' || !actor.staffId || actor.staffId !== task.assigneeStaffId) {
    throw fail('task-forbidden', 'You may only update checkpoints assigned to your own operator profile.', 403);
  }
}

async function requireBackendEnabled() {
  const snapshot = await SETTINGS_REF.get();
  if (!snapshot.exists || snapshot.data()?.backendEnabled !== true) {
    throw fail('task-tracker-not-active', 'Task Tracker persistence is not activated yet. No checkpoint was changed.', 503);
  }
}

function isoNow() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function checkpointStatus(item) {
  if (item?.completed === true) return 'completed';
  const value = cleanText(item?.status, 40);
  return CHECKPOINT_STATUSES.has(value) ? value : 'pending';
}

function normalizeDateTime(value) {
  const raw = cleanText(value, 100);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw fail('follow-up-invalid', 'Choose a valid follow-up date and time.');
  return date.toISOString();
}

function serializeRecord(data) {
  if (!data || typeof data !== 'object') return data;
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value.toDate === 'function') result[key] = value.toDate().toISOString();
    else if (Array.isArray(value)) result[key] = value.map((item) => serializeRecord(item));
    else if (value && typeof value === 'object') result[key] = serializeRecord(value);
    else result[key] = value;
  }
  return result;
}

function eventRecord({ taskId, type, actor, message, metadata = null }) {
  return {
    id: randomId('task-event'),
    taskId,
    type,
    at: isoNow(),
    actorUserId: actor.uid,
    actorName: actor.name,
    message,
    metadata,
  };
}

function findCheckpoint(task, itemId) {
  const checklist = Array.isArray(task.checklist) ? task.checklist : [];
  const index = checklist.findIndex((item) => cleanText(item?.id, 180) === itemId);
  if (index < 0) throw fail('checkpoint-not-found', 'This checkpoint no longer exists.', 404);
  return { checklist, index, item: checklist[index] || {} };
}

function dependencyBlocked(item, checklist) {
  const dependencyId = cleanText(item?.dependsOnItemId, 180);
  if (!dependencyId) return null;
  const dependency = checklist.find((candidate) => cleanText(candidate?.id, 180) === dependencyId);
  if (!dependency) return 'The configured prerequisite no longer exists.';
  if (dependency.completed !== true) return `Complete prerequisite “${cleanText(dependency.label, 120)}” first.`;
  return null;
}

async function mutateTaskCheckpoint(actor, payload, mutator) {
  await requireBackendEnabled();
  const taskId = cleanText(payload.taskId, 180);
  const itemId = cleanText(payload.itemId, 180);
  const expectedVersion = Number(payload.expectedVersion);
  if (!taskId || !itemId) throw fail('checkpoint-required', 'Task and checkpoint are required.');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw fail('version-required', 'Refresh the task before updating this checkpoint.', 409);
  const taskRef = db.collection(TASK_COLLECTION).doc(taskId);
  let result;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(taskRef);
    if (!snapshot.exists) throw fail('task-not-found', 'This task no longer exists.', 404);
    const task = { id: snapshot.id, ...snapshot.data() };
    requireTaskExecutor(actor, task);
    if (['completed', 'cancelled'].includes(task.status)) throw fail('task-terminal', 'Closed tasks cannot receive checkpoint updates.', 409);
    if (Number(task.version || 1) !== expectedVersion) throw fail('version-conflict', 'This task changed while you were viewing it. Refresh and retry.', 409);

    const { checklist, index, item } = findCheckpoint(task, itemId);
    const output = mutator({ task, checklist, index, item });
    const at = isoNow();
    const nextChecklist = checklist.map((candidate, candidateIndex) => candidateIndex === index ? output.item : candidate);
    const patch = {
      checklist: nextChecklist,
      updatedAt: at,
      updatedByUserId: actor.uid,
      updatedByName: actor.name,
      version: Number(task.version || 1) + 1,
      ...(task.status === 'pending' && output.markInProgress ? { status: 'in_progress' } : {}),
    };
    transaction.set(taskRef, patch, { merge: true });
    const event = eventRecord({ taskId, type: output.eventType, actor, message: output.message, metadata: output.metadata || null });
    transaction.set(db.collection(EVENT_COLLECTION).doc(event.id), event);
    result = serializeRecord({ ...task, ...patch });
  });

  return result;
}

async function addCheckpointUpdate(actor, payload) {
  const text = cleanText(payload.text, 3000);
  if (!text) throw fail('update-required', 'Write a progress update before saving this checkpoint.');
  const requestedStatus = cleanText(payload.status, 40) || 'in_progress';
  if (!CHECKPOINT_STATUSES.has(requestedStatus)) throw fail('checkpoint-status-invalid', 'Choose a valid checkpoint status.');
  const nextAction = cleanText(payload.nextAction, 1000) || null;
  const nextFollowUpAt = normalizeDateTime(payload.nextFollowUpAt);
  const waitingOn = cleanText(payload.waitingOn, 240) || null;
  const blockedReason = cleanText(payload.blockedReason, 1000) || null;
  if (requestedStatus === 'blocked' && !blockedReason) throw fail('blocked-reason-required', 'Explain what is blocking this checkpoint.');

  return mutateTaskCheckpoint(actor, payload, ({ checklist, item }) => {
    if (requestedStatus === 'completed') {
      const dependencyProblem = dependencyBlocked(item, checklist);
      if (dependencyProblem) throw fail('checkpoint-dependency', dependencyProblem, 409);
      if (item.requiresApproval === true && item.approvalStatus !== 'approved') {
        throw fail('checkpoint-approval-required', 'This checkpoint requires manager approval before it can be completed.', 409);
      }
    }
    const at = isoNow();
    const update = {
      id: randomId('checkpoint-update'),
      text,
      at,
      actorUserId: actor.uid,
      actorName: actor.name,
      status: requestedStatus,
      ...(nextAction ? { nextAction } : {}),
      ...(nextFollowUpAt ? { nextFollowUpAt } : {}),
      ...(waitingOn ? { waitingOn } : {}),
      ...(blockedReason ? { blockedReason } : {}),
    };
    const updates = [...(Array.isArray(item.updates) ? item.updates : []), update].slice(-100);
    const completed = requestedStatus === 'completed';
    const nextItem = {
      ...item,
      status: requestedStatus,
      completed,
      updates,
      lastUpdateAt: at,
      lastUpdatedByUserId: actor.uid,
      lastUpdatedByName: actor.name,
      nextAction: completed ? null : nextAction,
      nextFollowUpAt: completed ? null : nextFollowUpAt,
      waitingOn: completed ? null : waitingOn,
      blockedReason: completed ? null : blockedReason,
      ...(completed ? { completedAt: at, completedByUserId: actor.uid } : {}),
    };
    if (!completed) {
      delete nextItem.completedAt;
      delete nextItem.completedByUserId;
    }
    return {
      item: nextItem,
      eventType: completed ? 'checkpoint_completed' : 'checkpoint_update',
      message: `${cleanText(item.label, 180)} — ${text}`,
      metadata: { itemId: cleanText(item.id, 180), checkpointStatus: requestedStatus },
      markInProgress: true,
    };
  });
}

async function configureCheckpoint(actor, payload) {
  requireManager(actor);
  return mutateTaskCheckpoint(actor, payload, ({ checklist, item }) => {
    const requiresApproval = payload.requiresApproval === true;
    const dependsOnItemId = cleanText(payload.dependsOnItemId, 180) || null;
    if (dependsOnItemId && dependsOnItemId === cleanText(item.id, 180)) throw fail('self-dependency', 'A checkpoint cannot depend on itself.');
    if (dependsOnItemId && !checklist.some((candidate) => cleanText(candidate?.id, 180) === dependsOnItemId)) {
      throw fail('dependency-not-found', 'Choose a valid prerequisite checkpoint.');
    }
    const nextItem = {
      ...item,
      requiresApproval,
      dependsOnItemId,
      approvalStatus: requiresApproval ? (item.approvalStatus === 'approved' ? 'approved' : 'pending') : 'not_required',
    };
    return {
      item: nextItem,
      eventType: 'checkpoint_configured',
      message: `${cleanText(item.label, 180)} checkpoint rules updated.`,
      metadata: { itemId: cleanText(item.id, 180), requiresApproval, dependsOnItemId: dependsOnItemId || '' },
      markInProgress: false,
    };
  });
}

async function decideCheckpointApproval(actor, payload) {
  requireManager(actor);
  const decision = cleanText(payload.decision, 40);
  if (!APPROVAL_DECISIONS.has(decision)) throw fail('approval-invalid', 'Choose approve or reject.');
  const note = cleanText(payload.note, 1000) || null;
  return mutateTaskCheckpoint(actor, payload, ({ item }) => {
    if (item.requiresApproval !== true) throw fail('approval-not-required', 'This checkpoint does not require manager approval.', 409);
    const at = isoNow();
    const nextItem = {
      ...item,
      approvalStatus: decision,
      approvalAt: at,
      approvalByUserId: actor.uid,
      approvalByName: actor.name,
      ...(note ? { approvalNote: note } : {}),
    };
    return {
      item: nextItem,
      eventType: decision === 'approved' ? 'checkpoint_approved' : 'checkpoint_rejected',
      message: `${cleanText(item.label, 180)} was ${decision}${note ? `: ${note}` : '.'}`,
      metadata: { itemId: cleanText(item.id, 180), decision },
      markInProgress: false,
    };
  });
}

async function handleAction(actor, action, payload) {
  if (action === 'checkpoint.update') return addCheckpointUpdate(actor, payload);
  if (action === 'checkpoint.configure') return configureCheckpoint(actor, payload);
  if (action === 'checkpoint.approval') return decideCheckpointApproval(actor, payload);
  throw fail('unknown-action', 'Unknown Task Tracker checkpoint action.', 404);
}

exports.taskCheckpointApi = onRequest(
  { region: REGION, memory: '256MiB', timeoutSeconds: 120, maxInstances: 40 },
  async (request, response) => {
    setCors(request, response);
    if (request.method === 'OPTIONS') return response.status(204).send('');
    if (request.method !== 'POST') return response.status(405).json({ ok: false, code: 'method', message: 'Use POST.' });
    try {
      const actor = await requireActor(request);
      const action = cleanText(request.body?.action, 120);
      const payload = request.body?.payload && typeof request.body.payload === 'object' ? request.body.payload : {};
      const result = await handleAction(actor, action, payload);
      return response.status(200).json({ ok: true, result });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) logger.error('Task checkpoint request failed.', error);
      return response.status(status).json({
        ok: false,
        code: status < 500 ? error.code || 'request-failed' : 'service-unavailable',
        message: status < 500 ? error.message : 'Task checkpoint update could not be completed. No change has been reported as saved.',
      });
    }
  },
);

module.exports._taskCheckpointTest = {
  checkpointStatus,
  dependencyBlocked,
  normalizeRole,
};
