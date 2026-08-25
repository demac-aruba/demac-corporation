const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { cleanText, hashId } = require("./bookingSchedulingPrimitives");

const COMMUNICATION_COMMAND_VERSION = 2;
const COMMUNICATION_COMMAND_ACTIONS = Object.freeze({
  CLAIM: "claim_conversation",
  ASSIGN: "assign_conversation",
  RETURN_TO_MAYA: "return_to_maya",
  CLOSE: "close_conversation",
  REOPEN: "reopen_conversation",
  UPDATE_STATUS: "update_status",
  MARK_READ: "mark_read",
  SEND_REPLY: "send_reply",
});
const COMMUNICATION_ROLES = new Set([
  "super_admin", "super-admin", "superadmin", "operations", "office_operator", "office", "admin", "owner", "supervisor", "sales",
]);
const MANAGER_ROLES = new Set(["super_admin", "super-admin", "superadmin", "operations", "admin", "owner", "supervisor"]);
const OWNERSHIP_ACTIONS = new Set([
  COMMUNICATION_COMMAND_ACTIONS.CLAIM,
  COMMUNICATION_COMMAND_ACTIONS.ASSIGN,
  COMMUNICATION_COMMAND_ACTIONS.RETURN_TO_MAYA,
  COMMUNICATION_COMMAND_ACTIONS.CLOSE,
  COMMUNICATION_COMMAND_ACTIONS.REOPEN,
]);
const VERSION_GUARDED_ACTIONS = new Set([
  ...OWNERSHIP_ACTIONS,
  COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS,
  COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY,
]);
const ALLOWED_STATUSES = new Set([
  "new", "assigned", "waiting_customer", "waiting_demac", "appointment_pending", "estimate_pending", "payment_pending", "escalated", "resolved", "closed",
]);
const TERMINAL_STATUSES = new Set(["resolved", "closed"]);
const ALLOWED_MEDIA_KINDS = new Set(["image", "video", "audio", "voice", "document"]);

class CommunicationCommandError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommunicationCommandError";
    this.code = code;
    this.details = details;
  }
}

function roleValue(value) {
  return cleanText(value, 80).toLowerCase();
}

function requestId(value) {
  const normalized = cleanText(value, 240);
  if (normalized.length < 8) throw new CommunicationCommandError("invalid_request_id", "A stable requestId of at least 8 characters is required.");
  return normalized;
}

function nextOwnershipVersion(conversation = {}) {
  const current = Number(conversation.ownershipVersion || 0);
  return Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
}

function ownershipActor(identity = {}) {
  return {
    id: cleanText(identity.uid, 160),
    name: cleanText(identity.name || identity.email, 180) || "DEMAC operator",
    role: roleValue(identity.role),
  };
}

function ownerMatches(conversation = {}, identity = {}) {
  return Boolean(identity.uid && cleanText(conversation.ownerUserId, 160) === cleanText(identity.uid, 160));
}

function requireOwnerOrManager(conversation, identity) {
  if (ownerMatches(conversation, identity) || MANAGER_ROLES.has(roleValue(identity.role))) return;
  throw new CommunicationCommandError("permission_denied", "This conversation is owned by another operator.");
}

function requireExpectedOwnershipVersion(conversation = {}, expected) {
  if (expected === undefined || expected === null || expected === "") return;
  const normalized = Number(expected);
  const current = Number(conversation.ownershipVersion || 0);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized !== current) {
    throw new CommunicationCommandError("ownership_version_changed", "Conversation ownership changed before this command could commit.", {
      expectedOwnershipVersion: normalized,
      currentOwnershipVersion: current,
    });
  }
}

function requireCommandOwnershipVersion(action, conversation = {}, expected) {
  if (VERSION_GUARDED_ACTIONS.has(action) && (expected === undefined || expected === null || expected === "")) {
    throw new CommunicationCommandError("ownership_version_required", "This communication command requires the current ownershipVersion.");
  }
  requireExpectedOwnershipVersion(conversation, expected);
}

function commandHistoryEntry({ action, commandRequestId, identity, now, fromVersion, toVersion }) {
  const actor = ownershipActor(identity);
  return {
    id: `COMM-CMD-${hashId(`${commandRequestId}|${action}`, 24).toUpperCase()}`,
    action,
    requestId: commandRequestId,
    at: now,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    fromOwnershipVersion: fromVersion,
    toOwnershipVersion: toVersion,
  };
}

function appendBoundedHistory(existing, entry, limit = 80) {
  const items = Array.isArray(existing) ? existing.filter((item) => item && item.id !== entry.id) : [];
  return [...items, entry].slice(-limit);
}

function appendRequestId(existing, value, limit = 80) {
  const items = Array.isArray(existing) ? existing.map((item) => cleanText(item, 240)).filter(Boolean) : [];
  return [...items.filter((item) => item !== value), value].slice(-limit);
}

function validateOutboundMedia(media) {
  if (!media) return null;
  if (typeof media !== "object") throw new CommunicationCommandError("invalid_media", "Outbound media must be an object.");
  const kind = cleanText(media.kind || media.type, 40).toLowerCase();
  const url = cleanText(media.url, 4_000);
  if (!ALLOWED_MEDIA_KINDS.has(kind) || !/^https:\/\//i.test(url)) {
    throw new CommunicationCommandError("invalid_media", "Outbound media kind and secure URL are required.");
  }
  return {
    kind,
    url,
    fileName: cleanText(media.fileName, 240) || null,
    mimeType: cleanText(media.mimeType, 160) || null,
    size: Number.isFinite(Number(media.size)) ? Number(media.size) : null,
  };
}

function normalizedExpectedOwnershipVersion(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function commandRequestFingerprint(action, data = {}) {
  const payload = {
    action: cleanText(action, 120),
    expectedOwnershipVersion: normalizedExpectedOwnershipVersion(data.expectedOwnershipVersion),
  };
  if (action === COMMUNICATION_COMMAND_ACTIONS.ASSIGN) {
    payload.targetUserId = cleanText(data.target?.userId, 160);
  } else if (action === COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS) {
    payload.status = cleanText(data.status, 80).toLowerCase();
  } else if (action === COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY) {
    payload.text = cleanText(data.text, 3_000);
    payload.media = validateOutboundMedia(data.media);
  }
  return hashId(JSON.stringify(payload), 48);
}

function appendCommandReceipt(existing, receipt, limit = 80) {
  const items = Array.isArray(existing)
    ? existing.filter((item) => item && cleanText(item.requestId, 240) !== receipt.requestId)
    : [];
  return [...items, receipt].slice(-limit);
}

function commandReceipt({ action, commandRequestId, fingerprint, ownershipVersion, queueId = "" }) {
  return {
    requestId: commandRequestId,
    action,
    fingerprint,
    ownershipVersion: Number(ownershipVersion || 0),
    queueId: cleanText(queueId, 300) || null,
  };
}

function findCommandReceipt(existing, commandRequestId) {
  if (!Array.isArray(existing)) return null;
  return existing.find((item) => cleanText(item?.requestId, 240) === commandRequestId) || null;
}

function buildOwnershipPatch({ action, conversation = {}, identity = {}, target = {}, now }) {
  const actor = ownershipActor(identity);
  if (!actor.id) throw new CommunicationCommandError("unauthenticated", "Authenticated user id is required.");

  if (action === COMMUNICATION_COMMAND_ACTIONS.CLAIM) {
    if (conversation.ownerUserId && !ownerMatches(conversation, identity) && !MANAGER_ROLES.has(actor.role)) {
      throw new CommunicationCommandError("conversation_already_owned", "This conversation is already owned by another operator.");
    }
    return {
      owner: actor.name,
      ownerUserId: actor.id,
      lockedBy: actor.name,
      lockedByUserId: actor.id,
      status: "assigned",
      aiDisposition: "human_active",
      unread: 0,
    };
  }
  if (action === COMMUNICATION_COMMAND_ACTIONS.ASSIGN) {
    if (!MANAGER_ROLES.has(actor.role)) throw new CommunicationCommandError("permission_denied", "Only an authorized manager can assign a conversation to another operator.");
    const targetId = cleanText(target.userId, 160);
    const targetName = cleanText(target.name, 180);
    if (!targetId || !targetName) throw new CommunicationCommandError("invalid_assignment", "Target operator id and canonical name are required.");
    return {
      owner: targetName,
      ownerUserId: targetId,
      lockedBy: targetName,
      lockedByUserId: targetId,
      status: "assigned",
      aiDisposition: "human_active",
    };
  }
  if (action === COMMUNICATION_COMMAND_ACTIONS.RETURN_TO_MAYA) {
    requireOwnerOrManager(conversation, identity);
    return {
      owner: null,
      ownerUserId: null,
      lockedBy: null,
      lockedByUserId: null,
      status: "waiting_demac",
      aiDisposition: "ai_active",
    };
  }
  if (action === COMMUNICATION_COMMAND_ACTIONS.CLOSE) {
    requireOwnerOrManager(conversation, identity);
    return {
      owner: null,
      ownerUserId: null,
      lockedBy: null,
      lockedByUserId: null,
      status: "resolved",
      aiDisposition: "ai_paused",
      unread: 0,
      resolvedAtIso: now,
    };
  }
  if (action === COMMUNICATION_COMMAND_ACTIONS.REOPEN) {
    return {
      owner: actor.name,
      ownerUserId: actor.id,
      lockedBy: actor.name,
      lockedByUserId: actor.id,
      status: "assigned",
      aiDisposition: "human_active",
      reopenedAtIso: now,
    };
  }
  throw new CommunicationCommandError("unsupported_ownership_action", "Unsupported conversation ownership action.", { action });
}

function outboundQueueId({ conversationId, communicationAccountId, commandRequestId }) {
  return `COMM-OUT-${hashId(`${communicationAccountId}|${conversationId}|${commandRequestId}`, 40).toUpperCase()}`;
}

function createCommunicationConversationAuthority({ db, verifyIdToken, clock = () => new Date() } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");

  async function authenticate(request) {
    const header = String(request?.headers?.authorization || request?.get?.("authorization") || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new CommunicationCommandError("unauthenticated", "Firebase authentication is required.");
    let decoded;
    try {
      decoded = await verifyIdToken(match[1].trim());
    } catch (cause) {
      const error = new CommunicationCommandError("unauthenticated", "The Firebase session is invalid or expired.");
      error.cause = cause;
      throw error;
    }
    const uid = cleanText(decoded?.uid || decoded?.sub, 160);
    if (!uid) throw new CommunicationCommandError("unauthenticated", "The authenticated user has no uid.");
    const profileSnapshot = await db.collection("users").doc(uid).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
    const role = roleValue(profile.role || decoded.role);
    if (!COMMUNICATION_ROLES.has(role) || profile.active === false) {
      throw new CommunicationCommandError("permission_denied", "This user is not allowed to control customer conversations.");
    }
    return {
      uid,
      role,
      name: cleanText(profile.name || decoded.name || decoded.email, 180),
      email: cleanText(decoded.email || profile.email, 180),
    };
  }

  async function execute({ action, data = {}, identity }) {
    const conversationId = cleanText(data.conversationId, 300);
    const commandRequestId = requestId(data.requestId);
    if (!conversationId || conversationId.includes("/")) throw new CommunicationCommandError("invalid_conversation", "A valid conversationId is required.");
    const conversationRef = db.collection("communicationConversations").doc(conversationId);
    const now = clock().toISOString();
    const fingerprint = commandRequestFingerprint(action, data);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(conversationRef);
      if (!snapshot.exists) throw new CommunicationCommandError("conversation_not_found", "Communication conversation was not found.");
      const current = snapshot.data() || {};
      const processedRequestIds = Array.isArray(current.commandRequestIds) ? current.commandRequestIds : [];
      const existingReceipt = findCommandReceipt(current.commandRequestReceipts, commandRequestId);
      if (existingReceipt) {
        if (cleanText(existingReceipt.fingerprint, 80) !== fingerprint || cleanText(existingReceipt.action, 120) !== action) {
          throw new CommunicationCommandError("request_id_conflict", "This requestId was already used for a different communication command.");
        }
        return {
          success: true,
          replayed: true,
          conversationId,
          ownershipVersion: Number(existingReceipt.ownershipVersion ?? current.ownershipVersion ?? 0),
          ...(existingReceipt.queueId ? { queueId: existingReceipt.queueId } : {}),
        };
      }
      if (processedRequestIds.includes(commandRequestId)) {
        throw new CommunicationCommandError("request_id_conflict", "This legacy requestId has no verifiable command fingerprint and cannot be replayed safely.");
      }
      requireCommandOwnershipVersion(action, current, data.expectedOwnershipVersion);

      if (OWNERSHIP_ACTIONS.has(action)) {
        const fromVersion = Number(current.ownershipVersion || 0);
        const toVersion = nextOwnershipVersion(current);
        const target = { ...(data.target || {}) };
        if (action === COMMUNICATION_COMMAND_ACTIONS.ASSIGN) {
          const targetId = cleanText(target.userId, 160);
          if (!targetId) throw new CommunicationCommandError("invalid_assignment", "Target operator id is required.");
          const targetSnapshot = await transaction.get(db.collection("users").doc(targetId));
          const targetProfile = targetSnapshot.exists ? targetSnapshot.data() || {} : {};
          const targetRole = roleValue(targetProfile.role);
          if (!targetSnapshot.exists || targetProfile.active === false || !COMMUNICATION_ROLES.has(targetRole)) {
            throw new CommunicationCommandError("invalid_assignment", "Target operator is missing, inactive, or not allowed to handle communications.");
          }
          target.name = cleanText(targetProfile.name || targetProfile.email, 180);
          if (!target.name) throw new CommunicationCommandError("invalid_assignment", "Target operator has no canonical display identity.");
        }
        const ownershipPatch = buildOwnershipPatch({ action, conversation: current, identity, target, now });
        const history = commandHistoryEntry({ action, commandRequestId, identity, now, fromVersion, toVersion });
        const receipt = commandReceipt({ action, commandRequestId, fingerprint, ownershipVersion: toVersion });
        transaction.set(conversationRef, {
          ...ownershipPatch,
          ownershipVersion: toVersion,
          commandRequestIds: appendRequestId(processedRequestIds, commandRequestId),
          commandRequestReceipts: appendCommandReceipt(current.commandRequestReceipts, receipt),
          ownershipHistory: appendBoundedHistory(current.ownershipHistory, history),
          lastOwnershipCommand: history,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: now,
        }, { merge: true });
        return { success: true, replayed: false, conversationId, ownershipVersion: toVersion };
      }

      if (action === COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS) {
        requireOwnerOrManager(current, identity);
        const status = cleanText(data.status, 80).toLowerCase();
        if (!ALLOWED_STATUSES.has(status)) throw new CommunicationCommandError("invalid_status", "Unsupported communication status.");
        if (TERMINAL_STATUSES.has(status)) {
          throw new CommunicationCommandError("status_transition_required", "Resolved/closed conversations must use the dedicated close conversation transition.");
        }
        const ownershipVersion = Number(current.ownershipVersion || 0);
        const receipt = commandReceipt({ action, commandRequestId, fingerprint, ownershipVersion });
        transaction.set(conversationRef, {
          status,
          commandRequestIds: appendRequestId(processedRequestIds, commandRequestId),
          commandRequestReceipts: appendCommandReceipt(current.commandRequestReceipts, receipt),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: now,
        }, { merge: true });
        return { success: true, replayed: false, conversationId, ownershipVersion };
      }

      if (action === COMMUNICATION_COMMAND_ACTIONS.MARK_READ) {
        const ownershipVersion = Number(current.ownershipVersion || 0);
        const receipt = commandReceipt({ action, commandRequestId, fingerprint, ownershipVersion });
        transaction.set(conversationRef, {
          unread: 0,
          commandRequestIds: appendRequestId(processedRequestIds, commandRequestId),
          commandRequestReceipts: appendCommandReceipt(current.commandRequestReceipts, receipt),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: now,
        }, { merge: true });
        return { success: true, replayed: false, conversationId, ownershipVersion };
      }

      if (action === COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY) {
        requireOwnerOrManager(current, identity);
        if (current.aiDisposition !== "human_active") {
          throw new CommunicationCommandError("sender_ownership_invalid", "Human reply requires active human conversation ownership.");
        }
        const communicationAccountId = cleanText(current.communicationAccountId, 180).toLowerCase();
        if (!communicationAccountId) {
          throw new CommunicationCommandError("missing_communication_account", "Conversation communicationAccountId is required before sending.");
        }
        const provider = cleanText(current.provider, 40).toLowerCase();
        if (provider !== "wacli") throw new CommunicationCommandError("provider_not_supported", "Free-form Communication Center replies currently require wacli.");
        const to = cleanText(current.chatJid || current.externalChatId || current.phone, 300);
        if (!to) throw new CommunicationCommandError("missing_recipient", "Conversation has no customer recipient.");
        const text = cleanText(data.text, 3_000);
        const media = validateOutboundMedia(data.media);
        if (!text && !media) throw new CommunicationCommandError("empty_reply", "Customer reply needs text or media.");
        const queueId = outboundQueueId({ conversationId, communicationAccountId, commandRequestId });
        const queueRef = db.collection("whatsappOutboundQueue").doc(queueId);
        const queueSnapshot = await transaction.get(queueRef);
        if (queueSnapshot.exists) {
          throw new CommunicationCommandError("outbound_queue_conflict", "The deterministic outbound queue id already exists without a matching command receipt.");
        }
        const ownershipVersion = Number(current.ownershipVersion || 0);
        const receipt = commandReceipt({ action, commandRequestId, fingerprint, ownershipVersion, queueId });
        transaction.set(queueRef, {
          id: queueId,
          provider: "wacli",
          communicationAccountId,
          outboundClass: "conversation_human",
          status: "queued",
          type: media?.kind || "text",
          to,
          text,
          media,
          conversationId,
          expectedOwnershipVersion: ownershipVersion,
          createdByUserId: cleanText(identity.uid, 160),
          createdByName: cleanText(identity.name || identity.email, 180),
          commandRequestId,
          createdAt: FieldValue.serverTimestamp(),
          createdAtIso: now,
        });
        transaction.set(conversationRef, {
          commandRequestIds: appendRequestId(processedRequestIds, commandRequestId),
          commandRequestReceipts: appendCommandReceipt(current.commandRequestReceipts, receipt),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: now,
        }, { merge: true });
        return {
          success: true,
          replayed: false,
          conversationId,
          queueId,
          ownershipVersion,
        };
      }

      throw new CommunicationCommandError("unsupported_action", "Unsupported communication command.", { action });
    });
  }

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    try {
      const identity = await authenticate(request);
      const action = cleanText(request.body?.action, 120);
      const result = await execute({ action, data: request.body?.data || {}, identity });
      return { status: 200, body: result };
    } catch (error) {
      const code = error?.code || "internal_error";
      const status = code === "unauthenticated" ? 401
        : code === "permission_denied" ? 403
          : code === "conversation_not_found" ? 404
            : code === "internal_error" ? 500
              : 409;
      return {
        status,
        body: {
          success: false,
          error: {
            code,
            message: cleanText(error?.message || error, 500) || "Unexpected communication command error.",
            details: error?.details || {},
          },
        },
      };
    }
  }

  return { authenticate, execute, handle, version: COMMUNICATION_COMMAND_VERSION };
}

let defaultAuthority;
function getDefaultAuthority() {
  if (!defaultAuthority) {
    defaultAuthority = createCommunicationConversationAuthority({
      db: getFirestore(),
      verifyIdToken: (token) => getAuth().verifyIdToken(token),
    });
  }
  return defaultAuthority;
}

exports.communicationConversationAuthority = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultAuthority().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.ALLOWED_STATUSES = ALLOWED_STATUSES;
module.exports.COMMUNICATION_COMMAND_ACTIONS = COMMUNICATION_COMMAND_ACTIONS;
module.exports.COMMUNICATION_COMMAND_VERSION = COMMUNICATION_COMMAND_VERSION;
module.exports.COMMUNICATION_ROLES = COMMUNICATION_ROLES;
module.exports.CommunicationCommandError = CommunicationCommandError;
module.exports.MANAGER_ROLES = MANAGER_ROLES;
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
module.exports.VERSION_GUARDED_ACTIONS = VERSION_GUARDED_ACTIONS;
module.exports.appendBoundedHistory = appendBoundedHistory;
module.exports.appendCommandReceipt = appendCommandReceipt;
module.exports.appendRequestId = appendRequestId;
module.exports.buildOwnershipPatch = buildOwnershipPatch;
module.exports.commandRequestFingerprint = commandRequestFingerprint;
module.exports.createCommunicationConversationAuthority = createCommunicationConversationAuthority;
module.exports.findCommandReceipt = findCommandReceipt;
module.exports.nextOwnershipVersion = nextOwnershipVersion;
module.exports.outboundQueueId = outboundQueueId;
module.exports.requireCommandOwnershipVersion = requireCommandOwnershipVersion;
module.exports.requireExpectedOwnershipVersion = requireExpectedOwnershipVersion;
