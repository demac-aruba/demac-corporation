const crypto = require("crypto");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onRequest } = require("firebase-functions/v2/https");
const { normalizeArubaPhone } = require("./taskReminderService");

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();
const REGION = "us-central1";
const TASK_COLLECTION = "taskRecords";
const EVENT_COLLECTION = "taskEvents";
const SETTINGS_REF = db.collection("businessSettings").doc("task-tracker");
const OUTBOUND_QUEUE_COLLECTION = "whatsappOutboundQueue";
const TASK_STATUSES = new Set(["pending", "in_progress", "waiting", "completed", "cancelled"]);
const TASK_PRIORITIES = new Set(["normal", "important", "urgent", "critical"]);
const COMPLETION_REQUIREMENTS = new Set(["none", "checklist_required", "attachment_required"]);
const MANAGER_ROLES = new Set(["super_admin", "operations", "project_manager"]);

function cleanText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeRole(value) {
  const role = cleanText(value, 50).toLowerCase().replace(/[\s-]+/g, "_");
  if (["owner", "admin", "superadmin", "super_admin"].includes(role)) return "super_admin";
  if (["operation", "operations", "manager", "supervisor"].includes(role)) return "operations";
  if (["office", "operator", "office_operator"].includes(role)) return "office_operator";
  if (["project_manager", "projects"].includes(role)) return "project_manager";
  if (["finance", "accounting"].includes(role)) return "finance";
  if (["warehouse", "inventory"].includes(role)) return "warehouse";
  if (role === "sales") return "sales";
  if (["technician", "tech"].includes(role)) return "technician";
  if (["auditor", "readonly", "read_only"].includes(role)) return "auditor";
  return null;
}

function setCors(request, response) {
  const origin = request.get("origin") || "*";
  response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Max-Age", "3600");
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
}

async function requireActor(request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.get("authorization") || "");
  if (!match) throw fail("unauthenticated", "Sign in to DEMAC ERP.", 401);
  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1], true);
  } catch {
    throw fail("unauthenticated", "Your DEMAC ERP session expired. Sign in again.", 401);
  }
  const profileSnapshot = await db.collection("users").doc(decoded.uid).get();
  if (!profileSnapshot.exists) throw fail("not-provisioned", "This account is not provisioned for DEMAC ERP.", 403);
  const profile = profileSnapshot.data() || {};
  if (profile.active !== true) throw fail("inactive", "This DEMAC ERP account is inactive.", 403);
  const role = normalizeRole(profile.role);
  if (!role) throw fail("invalid-role", "This account does not have a recognized DEMAC ERP role.", 403);
  return {
    uid: decoded.uid,
    name: cleanText(profile.name || profile.displayName || decoded.name || decoded.email || "DEMAC User", 160),
    role,
    staffId: cleanText(profile.staffId, 160) || null,
  };
}

function isManager(actor) {
  return MANAGER_ROLES.has(actor.role);
}

function requireManager(actor) {
  if (!isManager(actor)) throw fail("manager-required", "Only authorized DEMAC managers may assign or administer tasks.", 403);
}

function requireAutomationManager(actor) {
  if (actor.role !== "super_admin") throw fail("admin-required", "Only the DEMAC owner / super admin may change Task Tracker automation rules.", 403);
}

function requireTaskExecutor(actor, task) {
  if (isManager(actor)) return;
  if (actor.role !== "office_operator" || !actor.staffId || actor.staffId !== task.assigneeStaffId) {
    throw fail("task-forbidden", "You may only execute tasks assigned to your own operator profile.", 403);
  }
}

async function loadSettings() {
  const snapshot = await SETTINGS_REF.get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  return {
    id: "task-tracker",
    backendEnabled: data.backendEnabled === true,
    enabled: data.enabled === true,
    dailySummaryEnabled: data.dailySummaryEnabled !== false,
    dailySummaryTime: /^\d{2}:\d{2}$/.test(String(data.dailySummaryTime || "")) ? String(data.dailySummaryTime) : "08:00",
    twentyFourHoursBefore: data.twentyFourHoursBefore !== false,
    threeHoursBefore: data.threeHoursBefore !== false,
    oneHourBefore: data.oneHourBefore !== false,
    deadlineAlert: data.deadlineAlert !== false,
    overdueReminders: data.overdueReminders !== false,
    overdueIntervalHours: Math.max(1, Number(data.overdueIntervalHours || 12)),
    escalateOverdue: data.escalateOverdue !== false,
    escalateAfterHours: Math.max(1, Number(data.escalateAfterHours || 24)),
    updatedAt: data.updatedAt || null,
    updatedByUserId: data.updatedByUserId || null,
    updatedByName: data.updatedByName || null,
  };
}

async function requireBackendEnabled() {
  const settings = await loadSettings();
  if (!settings.backendEnabled) {
    throw fail("task-tracker-not-active", "Task Tracker persistence is not activated yet. No data was changed.", 503);
  }
  return settings;
}

function isoNow() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function deterministicId(prefix, value, length = 24) {
  const digest = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
  return `${prefix}-${digest}`;
}

function taskNumberFromId(id) {
  const suffix = crypto.createHash("sha256").update(id).digest("hex").slice(0, 6).toUpperCase();
  return `TSK-${suffix}`;
}

function normalizeChecklist(value, taskId) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item, index) => {
    if (typeof item === "string") {
      const label = cleanText(item, 500);
      return label ? { id: `${taskId}-item-${index + 1}`, label, completed: false } : null;
    }
    const label = cleanText(item?.label, 500);
    if (!label) return null;
    const normalized = {
      id: cleanText(item?.id, 180) || `${taskId}-item-${index + 1}`,
      label,
      completed: item?.completed === true,
    };
    if (normalized.completed) {
      const completedAt = cleanText(item?.completedAt, 100);
      const completedByUserId = cleanText(item?.completedByUserId, 180);
      if (completedAt) normalized.completedAt = completedAt;
      if (completedByUserId) normalized.completedByUserId = completedByUserId;
    }
    return normalized;
  }).filter(Boolean);
}

function defaultReminderPolicy(value = {}) {
  return {
    dailySummary: value.dailySummary !== false,
    twentyFourHoursBefore: value.twentyFourHoursBefore !== false,
    threeHoursBefore: value.threeHoursBefore !== false,
    oneHourBefore: value.oneHourBefore !== false,
    deadlineAlert: value.deadlineAlert !== false,
    overdueReminders: value.overdueReminders !== false,
    overdueIntervalHours: Math.max(1, Number(value.overdueIntervalHours || 12)),
  };
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function serializeRecord(data) {
  if (!data || typeof data !== "object") return data;
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value.toDate === "function") result[key] = value.toDate().toISOString();
    else if (Array.isArray(value)) result[key] = value.map((item) => serializeRecord(item));
    else if (value && typeof value === "object") result[key] = serializeRecord(value);
    else result[key] = value;
  }
  return result;
}

function profileDisplayName(profile, fallbackId) {
  const direct = cleanText(profile?.name || profile?.displayName, 160);
  const parts = cleanText(`${profile?.firstName || ""} ${profile?.lastName || ""}`, 160);
  return direct || parts || cleanText(fallbackId, 160) || "DEMAC staff";
}

async function activeAssignees() {
  const snapshot = await db.collection("staffProfiles").get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((profile) => profile.active !== false)
    .map((profile) => ({
      staffId: profile.id,
      name: profileDisplayName(profile, profile.id),
      phone: normalizeArubaPhone(profile.phone || profile.mobile) || undefined,
      role: cleanText(profile.role, 80) || undefined,
      employeeType: cleanText(profile.employeeType, 80) || undefined,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function visibleTasks(actor) {
  let query = db.collection(TASK_COLLECTION);
  if (!isManager(actor)) {
    if (!actor.staffId) return [];
    query = query.where("assigneeStaffId", "==", actor.staffId);
  }
  const snapshot = await query.limit(1000).get();
  return snapshot.docs.map((document) => serializeRecord({ id: document.id, ...document.data() }));
}

async function workspace(actor) {
  const settings = await loadSettings();
  const [tasks, assignees, eventsSnapshot] = await Promise.all([
    visibleTasks(actor),
    isManager(actor) ? activeAssignees() : Promise.resolve([]),
    db.collection(EVENT_COLLECTION).orderBy("at", "desc").limit(2000).get(),
  ]);
  const ids = new Set(tasks.map((task) => task.id));
  const events = eventsSnapshot.docs
    .map((document) => serializeRecord({ id: document.id, ...document.data() }))
    .filter((event) => ids.has(event.taskId));
  return {
    tasks,
    events,
    assignees,
    automation: settings,
    liveDataAvailable: settings.backendEnabled,
    dataAccessMessage: settings.backendEnabled ? undefined : "Task Tracker is in safe preview mode. Server-side persistence remains disabled until activation is approved.",
  };
}

async function taskById(taskId) {
  const id = cleanText(taskId, 180);
  if (!id) throw fail("task-required", "Task id is required.");
  const snapshot = await db.collection(TASK_COLLECTION).doc(id).get();
  if (!snapshot.exists) throw fail("task-not-found", "This task no longer exists.", 404);
  return serializeRecord({ id: snapshot.id, ...snapshot.data() });
}

function newEvent({ taskId, type, actor, message = null, metadata = null }) {
  return {
    id: randomId("task-event"),
    taskId,
    type,
    at: isoNow(),
    actorUserId: actor.uid,
    actorName: actor.name,
    message,
    metadata,
  };
}

async function createTask(actor, payload) {
  requireManager(actor);
  await requireBackendEnabled();
  const requestId = cleanText(payload.requestId, 180);
  if (!requestId) throw fail("request-id-required", "Task creation requires a request id. Refresh and retry.", 409);
  const title = cleanText(payload.title, 300);
  if (!title) throw fail("title-required", "Task title is required.");
  const assigneeId = cleanText(payload.assigneeStaffId, 180);
  if (!assigneeId) throw fail("assignee-required", "Choose an assignee.");
  const assigneeSnapshot = await db.collection("staffProfiles").doc(assigneeId).get();
  if (!assigneeSnapshot.exists || assigneeSnapshot.data()?.active === false) throw fail("assignee-not-found", "The selected staff profile is not active.");
  const assignee = assigneeSnapshot.data() || {};
  const dueAt = new Date(payload.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw fail("deadline-invalid", "Choose a valid task deadline.");
  const priority = TASK_PRIORITIES.has(payload.priority) ? payload.priority : "normal";
  const completionRequirement = COMPLETION_REQUIREMENTS.has(payload.completionRequirement) ? payload.completionRequirement : "none";
  const id = deterministicId("task", `${actor.uid}|${requestId}`, 28);
  const ref = db.collection(TASK_COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists) return serializeRecord({ id: existing.id, ...existing.data() });
  const at = isoNow();
  const task = {
    id,
    requestId,
    taskNumber: taskNumberFromId(id),
    title,
    description: cleanText(payload.description, 10000),
    category: cleanText(payload.category, 120) || null,
    priority,
    status: "pending",
    assigneeStaffId: assigneeId,
    assigneeNameSnapshot: profileDisplayName(assignee, assigneeId),
    assigneePhoneSnapshot: normalizeArubaPhone(assignee.phone || assignee.mobile) || null,
    dueAt: dueAt.toISOString(),
    checklist: normalizeChecklist(payload.checklist, id),
    attachments: [],
    completionRequirement,
    reminderPolicy: defaultReminderPolicy(payload.reminderPolicy),
    createdAt: at,
    createdByUserId: actor.uid,
    createdByName: actor.name,
    updatedAt: at,
    updatedByUserId: actor.uid,
    updatedByName: actor.name,
    version: 1,
  };
  const event = newEvent({ taskId: id, type: "created", actor, message: `Task assigned to ${task.assigneeNameSnapshot}.` });
  const batch = db.batch();
  batch.create(ref, task);
  batch.set(db.collection(EVENT_COLLECTION).doc(event.id), event);
  try {
    await batch.commit();
    return task;
  } catch (error) {
    const after = await ref.get().catch(() => null);
    if (after?.exists) return serializeRecord({ id: after.id, ...after.data() });
    throw error;
  }
}

function completionBlocked(task) {
  if (task.completionRequirement === "checklist_required" && (task.checklist || []).some((item) => !item.completed)) {
    return "Complete every checklist item before closing this task.";
  }
  if (task.completionRequirement === "attachment_required" && !(task.attachments || []).length) {
    return "Attach the required evidence before closing this task.";
  }
  return null;
}

function allowedTransition(from, to) {
  if (from === to) return true;
  if (["completed", "cancelled"].includes(from)) return false;
  return TASK_STATUSES.has(to);
}

async function mutateTask(actor, payload, mutation) {
  await requireBackendEnabled();
  const taskId = cleanText(payload.taskId, 180);
  if (!taskId) throw fail("task-required", "Task id is required.");
  const expectedVersion = Number(payload.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw fail("version-required", "Refresh the task before changing it. A current task version is required.", 409);
  }
  const ref = db.collection(TASK_COLLECTION).doc(taskId);
  let result;
  let event;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw fail("task-not-found", "This task no longer exists.", 404);
    const task = { id: snapshot.id, ...snapshot.data() };
    requireTaskExecutor(actor, task);
    if (Number(task.version || 1) !== expectedVersion) throw fail("version-conflict", "This task changed while you were viewing it. Refresh and retry.", 409);
    const output = mutation(task);
    const at = isoNow();
    const patch = {
      ...output.patch,
      updatedAt: at,
      updatedByUserId: actor.uid,
      updatedByName: actor.name,
      version: Number(task.version || 1) + 1,
    };
    result = serializeRecord({ ...task, ...patch });
    event = newEvent({ taskId, type: output.eventType, actor, message: output.message, metadata: output.metadata });
    transaction.set(ref, patch, { merge: true });
    transaction.set(db.collection(EVENT_COLLECTION).doc(event.id), event);
  });
  return result;
}

async function acknowledge(actor, payload) {
  return mutateTask(actor, payload, (task) => ({
    patch: task.acknowledgedAt ? {} : { acknowledgedAt: isoNow(), acknowledgedByUserId: actor.uid },
    eventType: "acknowledged",
    message: "Task acknowledged.",
  }));
}

async function updateStatus(actor, payload) {
  const nextStatus = cleanText(payload.status, 40);
  if (!TASK_STATUSES.has(nextStatus)) throw fail("status-invalid", "Choose a valid task status.");
  return mutateTask(actor, payload, (task) => {
    if (!allowedTransition(task.status, nextStatus)) throw fail("status-terminal", `Task cannot transition from ${task.status} to ${nextStatus}.`, 409);
    if (nextStatus === "completed") {
      const blocker = completionBlocked(task);
      if (blocker) throw fail("completion-blocked", blocker, 409);
    }
    const patch = { status: nextStatus };
    if (nextStatus === "completed") Object.assign(patch, { completedAt: isoNow(), completedByUserId: actor.uid });
    if (nextStatus === "cancelled") Object.assign(patch, { cancelledAt: isoNow(), cancelledByUserId: actor.uid });
    return {
      patch,
      eventType: nextStatus === "completed" ? "completed" : nextStatus === "cancelled" ? "cancelled" : "status_changed",
      message: `Status changed from ${task.status} to ${nextStatus}.`,
      metadata: { from: task.status, to: nextStatus },
    };
  });
}

async function updateChecklist(actor, payload) {
  return mutateTask(actor, payload, (task) => {
    const at = isoNow();
    const checklist = normalizeChecklist(payload.checklist, task.id).map((item) => {
      const next = { id: item.id, label: item.label, completed: item.completed };
      if (item.completed) {
        next.completedAt = item.completedAt || at;
        next.completedByUserId = item.completedByUserId || actor.uid;
      }
      return next;
    });
    return { patch: { checklist }, eventType: "checklist_updated" };
  });
}

async function addComment(actor, payload) {
  await requireBackendEnabled();
  const task = await taskById(payload.taskId);
  requireTaskExecutor(actor, task);
  const message = cleanText(payload.message, 4000);
  if (!message) throw fail("comment-required", "Write a comment first.");
  const event = newEvent({ taskId: task.id, type: "comment_added", actor, message });
  await db.collection(EVENT_COLLECTION).doc(event.id).set(event);
  return event;
}

async function requestUpdate(actor, payload) {
  requireManager(actor);
  await requireBackendEnabled();
  const task = await taskById(payload.taskId);
  if (["completed", "cancelled"].includes(task.status)) throw fail("task-terminal", "This task is already closed.", 409);
  const staffSnapshot = await db.collection("staffProfiles").doc(task.assigneeStaffId).get();
  const staff = staffSnapshot.exists ? staffSnapshot.data() || {} : {};
  const to = normalizeArubaPhone(staff.phone || staff.mobile || task.assigneePhoneSnapshot);
  if (!to) throw fail("assignee-phone-missing", `${task.assigneeNameSnapshot} does not have a WhatsApp phone number on the canonical staff profile.`, 409);
  const queueId = deterministicId("task-update", `${actor.uid}|${task.id}|${task.version}`, 32);
  const due = new Intl.DateTimeFormat("en-AW", { timeZone: "America/Aruba", dateStyle: "medium", timeStyle: "short" }).format(new Date(task.dueAt));
  const text = `Hi ${task.assigneeNameSnapshot}, an update was requested for ${task.taskNumber} – ${task.title}. Please update the task status in DEMAC ERP. Deadline: ${due}.`;
  const queueRef = db.collection(OUTBOUND_QUEUE_COLLECTION).doc(queueId);
  const eventRef = db.collection(EVENT_COLLECTION).doc(deterministicId("task-event", queueId, 32));
  let created = false;
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(queueRef);
    if (existing.exists) return;
    created = true;
    transaction.set(queueRef, {
      id: queueId,
      provider: "wacli",
      status: "queued",
      type: "text",
      to,
      text,
      taskId: task.id,
      taskNumber: task.taskNumber,
      reason: "update_request",
      source: "task-tracker-api",
      createdByUserId: actor.uid,
      createdByName: actor.name,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(eventRef, {
      id: eventRef.id,
      taskId: task.id,
      type: "update_requested",
      at: isoNow(),
      actorUserId: actor.uid,
      actorName: actor.name,
      message: text,
      metadata: { queueId },
    });
  });
  return { queueId, created };
}

async function saveAutomation(actor, payload) {
  requireAutomationManager(actor);
  await requireBackendEnabled();
  const current = await loadSettings();
  const patch = {
    enabled: payload.enabled === true,
    dailySummaryEnabled: payload.dailySummaryEnabled !== false,
    dailySummaryTime: /^\d{2}:\d{2}$/.test(String(payload.dailySummaryTime || "")) ? String(payload.dailySummaryTime) : "08:00",
    twentyFourHoursBefore: payload.twentyFourHoursBefore !== false,
    threeHoursBefore: payload.threeHoursBefore !== false,
    oneHourBefore: payload.oneHourBefore !== false,
    deadlineAlert: payload.deadlineAlert !== false,
    overdueReminders: payload.overdueReminders !== false,
    overdueIntervalHours: Math.max(1, Number(payload.overdueIntervalHours || 12)),
    escalateOverdue: payload.escalateOverdue !== false,
    escalateAfterHours: Math.max(1, Number(payload.escalateAfterHours || 24)),
    backendEnabled: current.backendEnabled,
    updatedAt: isoNow(),
    updatedByUserId: actor.uid,
    updatedByName: actor.name,
  };
  await SETTINGS_REF.set(patch, { merge: true });
  return { id: "task-tracker", ...patch };
}

async function handleAction(actor, action, payload) {
  if (action === "workspace.load") return workspace(actor);
  if (action === "task.create") return createTask(actor, payload);
  if (action === "task.acknowledge") return acknowledge(actor, payload);
  if (action === "task.status") return updateStatus(actor, payload);
  if (action === "task.checklist") return updateChecklist(actor, payload);
  if (action === "comment.add") return addComment(actor, payload);
  if (action === "reminder.request") return requestUpdate(actor, payload);
  if (action === "automation.save") return saveAutomation(actor, payload);
  throw fail("unknown-action", "Unknown Task Tracker action.", 404);
}

exports.taskTrackerApi = onRequest(
  { region: REGION, memory: "256MiB", timeoutSeconds: 120 },
  async (request, response) => {
    setCors(request, response);
    if (request.method === "OPTIONS") return response.status(204).send("");
    if (request.method !== "POST") return response.status(405).json({ ok: false, code: "method", message: "Use POST." });
    try {
      const actor = await requireActor(request);
      if (!["super_admin", "operations", "office_operator", "project_manager"].includes(actor.role)) {
        throw fail("task-tracker-forbidden", "Your ERP role does not have Task Tracker access.", 403);
      }
      const body = request.body && typeof request.body === "object" ? request.body : {};
      const action = cleanText(body.action, 80);
      const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
      const result = await handleAction(actor, action, payload);
      return response.status(200).json({ ok: true, result });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) logger.error("Task Tracker API request failed.", error);
      return response.status(status).json({
        ok: false,
        code: status < 500 ? error.code || "request-failed" : "service-unavailable",
        message: status < 500 ? error.message : "Task Tracker could not complete this request. No change has been reported as saved.",
      });
    }
  },
);

module.exports._taskTrackerTest = {
  allowedTransition,
  completionBlocked,
  deterministicId,
  normalizeChecklist,
  normalizeRole,
};
