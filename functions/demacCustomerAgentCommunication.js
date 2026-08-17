const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { createCustomerAgentRuntime, HANDOFF_QUEUES } = require("./demacCustomerAgentRuntimeV1");
const { sessionIdentity } = require("./demacCustomerConversationState");
const { cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { cleanCustomerFacingMessage } = require("./demacCustomerMessageFormatting");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const AGENT_QUEUE_COLLECTION = "customerAgentInboundQueue";
const AGENT_LOCK_COLLECTION = "customerAgentConversationLocks";
const LEASE_MS = 2 * 60 * 1000;
const MAX_PROCESSING_ATTEMPTS = 5;

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function conversationIdentity(message = {}) {
  return cleanText(message.chat || message.conversationId || message.phone, 300);
}

function queueDocumentId(conversationId, messageId) {
  return `CAQ-${hashId(`${conversationId}|${messageId}`, 40).toUpperCase()}`;
}

function outboundDocumentId(conversationId, messageId) {
  return `AI-${hashId(`${conversationId}|${messageId}|outbound`, 40).toUpperCase()}`;
}

function automaticReplySupported(provider) {
  return cleanText(provider, 40).toLowerCase() === "wacli";
}

function shouldRunAgent(conversation = {}) {
  if (conversation.aiDisposition === "human_active") return false;
  if (conversation.ownerUserId || conversation.lockedByUserId) return false;
  return conversation.aiDisposition === "ai_active";
}

async function communicationOwnershipGuard({ context = {} } = {}) {
  const conversationId = safeDocumentId(context.conversationId || context.contactJid || context.contactPhone);
  if (!conversationId || conversationId === "unknown") {
    return { allowed: false, code: "missing_conversation_identity", reason: "Communication Center conversation identity is missing." };
  }
  const snapshot = await db.collection("communicationConversations").doc(conversationId).get();
  if (!snapshot.exists) {
    return { allowed: false, code: "conversation_missing", reason: "Communication Center conversation no longer exists." };
  }
  const conversation = snapshot.data() || {};
  if (!shouldRunAgent(conversation)) {
    return { allowed: false, code: "human_takeover", reason: "A DEMAC operator owns this conversation now." };
  }
  return { allowed: true };
}

const customerAgentRuntime = createCustomerAgentRuntime({
  db,
  executionGuard: communicationOwnershipGuard,
});

function communicationMessageToRuntime(message = {}) {
  const role = cleanText(message.role, 40);
  const direction = role === "customer" ? "inbound" : role === "operator" || role === "ai" ? "outbound" : "";
  const text = cleanText(message.text || message.mediaCaption || message.reactionEmoji, 4_000);
  if (!direction || !text) return null;
  return {
    id: cleanText(message.id, 300),
    direction,
    text,
  };
}

function whatsappMessageToRuntime(message = {}) {
  const direction = message.direction === "inbound" ? "inbound" : message.direction === "outbound" ? "outbound" : "";
  const text = cleanText(message.text || message.mediaCaption || message.reactionEmoji, 4_000);
  if (!direction || !text) return null;
  return {
    id: cleanText(message.messageId || message.id, 300),
    direction,
    text,
  };
}

function buildRuntimeBody({ conversationId, conversation = {}, inboundMessage = {}, provider = "wacli" }) {
  const inbound = whatsappMessageToRuntime(inboundMessage);
  const messages = (Array.isArray(conversation.recentMessages) ? conversation.recentMessages : [])
    .map(communicationMessageToRuntime)
    .filter(Boolean);
  if (inbound && !messages.some((message) => message.id === inbound.id)) messages.push(inbound);
  const normalizedMessages = messages.slice(-40);
  const latestInbound = inbound || [...normalizedMessages].reverse().find((message) => message.direction === "inbound");
  return {
    provider,
    channel: "whatsapp",
    conversationId,
    inboundMessageId: latestInbound?.id || cleanText(inboundMessage.messageId, 300),
    conversation: {
      id: conversationId,
      conversationId,
      provider,
      contactPhone: cleanText(conversation.phone || inboundMessage.phone, 80),
      contactJid: cleanText(conversation.chatJid || conversation.externalChatId || inboundMessage.chat, 180),
      chatTitle: cleanText(conversation.customer || inboundMessage.chatName, 180),
      messages: normalizedMessages,
      customerTurn: {
        id: latestInbound?.id || "",
        text: latestInbound?.text || "",
      },
    },
  };
}

function semanticHandoffQueue(value) {
  const queue = cleanText(value, 80);
  return HANDOFF_QUEUES.includes(queue) ? queue : "manager";
}

function outcomeConversationPatch(result = {}) {
  const requiresHuman = result.metadata?.requiresHuman === true || result.metadata?.outcome === "handoff";
  const appointmentId = cleanText(result.metadata?.appointmentId, 180);
  if (requiresHuman) {
    const handoffQueue = semanticHandoffQueue(result.metadata?.handoffQueue);
    const handoffReason = cleanText(result.metadata?.handoffReason, 500)
      || "DEMAC Customer Agent requested human review without a structured reason.";
    return {
      aiDisposition: "human_active",
      status: "escalated",
      queue: handoffQueue,
      routeReason: handoffReason,
      agentLastOutcome: cleanText(result.metadata?.outcome, 80) || "handoff",
      agentLastAppointmentId: appointmentId || null,
      agentLastHandoffQueue: handoffQueue,
      agentLastHandoffReason: handoffReason,
    };
  }
  return {
    aiDisposition: "ai_active",
    status: "waiting_customer",
    agentLastOutcome: cleanText(result.metadata?.outcome, 80) || "reply",
    agentLastAppointmentId: appointmentId || null,
    agentLastHandoffQueue: null,
    agentLastHandoffReason: null,
  };
}

async function enqueueInbound({ messageId, message, reactivate = false }) {
  const conversationId = safeDocumentId(conversationIdentity(message));
  if (!conversationId || conversationId === "unknown") return null;
  const queueId = queueDocumentId(conversationId, messageId);
  const ref = db.collection(AGENT_QUEUE_COLLECTION).doc(queueId);
  const snapshot = await ref.get();
  const currentStatus = snapshot.exists ? cleanText(snapshot.data()?.status, 40) : "";
  const terminalStatuses = ["processed", "coalesced", "skipped_provider"];
  if (terminalStatuses.includes(currentStatus) || (currentStatus === "skipped_human" && !reactivate)) {
    return { ref, queueId, conversationId, completed: true };
  }
  await ref.set({
    id: queueId,
    conversationId,
    provider: cleanText(message.provider, 40) || "wacli",
    messageId,
    chat: cleanText(message.chat, 300),
    status: "queued",
    attempts: Number(snapshot.data()?.attempts || 0),
    reactivated: reactivate || snapshot.data()?.reactivated === true,
    queuedAt: snapshot.data()?.queuedAt || FieldValue.serverTimestamp(),
    queuedAtIso: snapshot.data()?.queuedAtIso || new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ref, queueId, conversationId, completed: false };
}

async function acquireLease(conversationId, ownerId) {
  const ref = db.collection(AGENT_LOCK_COLLECTION).doc(safeDocumentId(conversationId));
  const now = Date.now();
  let acquired = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const leaseUntil = Date.parse(String(current.leaseUntilIso || ""));
    const active = Number.isFinite(leaseUntil) && leaseUntil > now && current.ownerId !== ownerId;
    if (active) return;
    acquired = true;
    transaction.set(ref, {
      conversationId,
      ownerId,
      leaseUntilIso: new Date(now + LEASE_MS).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { acquired, ref };
}

async function releaseLease(ref, ownerId) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) return;
    transaction.set(ref, {
      ownerId: "",
      leaseUntilIso: new Date(0).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function pendingQueue(conversationId) {
  const snapshot = await db.collection(AGENT_QUEUE_COLLECTION).where("conversationId", "==", conversationId).get();
  return snapshot.docs
    .map((doc) => ({ ref: doc.ref, id: doc.id, ...doc.data() }))
    .filter((item) => item.status === "queued")
    .sort((left, right) => {
      const leftTime = timestampMillis(left.queuedAt) || Date.parse(left.queuedAtIso || "") || 0;
      const rightTime = timestampMillis(right.queuedAt) || Date.parse(right.queuedAtIso || "") || 0;
      return leftTime - rightTime || String(left.messageId).localeCompare(String(right.messageId));
    });
}

async function markOlderAsCoalesced(items, selected) {
  const older = items.filter((item) => item.id !== selected.id);
  if (!older.length) return;
  const batch = db.batch();
  older.forEach((item) => batch.set(item.ref, {
    status: "coalesced",
    coalescedIntoMessageId: selected.messageId,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true }));
  await batch.commit();
}

async function ensureAgentSessionActive(conversationId, provider) {
  const identity = sessionIdentity({ provider, conversationId });
  if (!identity) return;
  await db.collection("customerAgentSessions").doc(identity.sessionId).set({
    status: "AI_ACTIVE",
    requiresHuman: false,
    handoffQueue: "",
    handoffReason: "",
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
  }, { merge: true });
}

async function queueAgentReply({ conversationId, conversation, inboundMessageId, result, provider }) {
  if (!automaticReplySupported(provider)) {
    throw new Error(`Automatic customer-agent replies are not enabled for provider ${cleanText(provider, 40) || "unknown"}.`);
  }
  const text = cleanCustomerFacingMessage(result.draft, 3_000);
  if (!text) return { queued: false, reason: "empty-draft" };
  const id = outboundDocumentId(conversationId, inboundMessageId);
  const ref = db.collection("whatsappOutboundQueue").doc(id);
  const conversationRef = db.collection("communicationConversations").doc(conversationId);
  let outcome = { queued: false, id, reason: "not-created" };

  await db.runTransaction(async (transaction) => {
    const [conversationSnapshot, existing] = await Promise.all([
      transaction.get(conversationRef),
      transaction.get(ref),
    ]);
    if (existing.exists) {
      outcome = { queued: true, id, existing: true };
      return;
    }
    if (!conversationSnapshot.exists || !shouldRunAgent(conversationSnapshot.data() || {})) {
      outcome = { queued: false, id, reason: "human-takeover" };
      return;
    }
    const currentConversation = conversationSnapshot.data() || {};
    const to = cleanText(
      currentConversation.chatJid
        || currentConversation.externalChatId
        || currentConversation.phone
        || conversation.chatJid
        || conversation.externalChatId
        || conversation.phone,
      300,
    );
    if (!to) throw new Error("Customer Agent cannot reply because the conversation has no WhatsApp recipient.");
    transaction.set(ref, {
      id,
      provider: "wacli",
      status: "queued",
      type: "text",
      to,
      text,
      conversationId,
      sourceInboundMessageId: inboundMessageId,
      createdByUserId: "demac-customer-agent",
      createdByName: "Maya",
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });
    outcome = { queued: true, id, existing: false };
  });

  return outcome;
}

async function processLatestQueued(conversationId, leaseOwnerId) {
  const pending = await pendingQueue(conversationId);
  if (!pending.length) return { processed: false, reason: "no-pending-message" };
  const selected = pending[pending.length - 1];
  await markOlderAsCoalesced(pending, selected);

  const conversationRef = db.collection("communicationConversations").doc(conversationId);
  const [conversationSnapshot, messageSnapshot] = await Promise.all([
    conversationRef.get(),
    db.collection("whatsappMessages").doc(safeDocumentId(selected.messageId)).get(),
  ]);
  if (!conversationSnapshot.exists) {
    const notReady = new Error("Communication Center conversation is not materialized yet; retry this event.");
    notReady.code = "conversation_not_ready";
    throw notReady;
  }
  const conversation = conversationSnapshot.data() || {};
  const inboundMessage = messageSnapshot.exists ? { id: messageSnapshot.id, ...messageSnapshot.data() } : {};

  if (!shouldRunAgent(conversation)) {
    await selected.ref.set({
      status: "skipped_human",
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "human-active" };
  }

  const attempts = Number(selected.attempts || 0) + 1;
  await selected.ref.set({
    status: "processing",
    attempts,
    leaseOwnerId,
    processingStartedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await ensureAgentSessionActive(conversationId, selected.provider || "wacli");

  const rawBody = buildRuntimeBody({
    conversationId,
    conversation,
    inboundMessage,
    provider: selected.provider || "wacli",
  });
  const result = await customerAgentRuntime.runTurn({
    rawBody,
    apiKey: openAiApiKey.value(),
    company: "DEMAC Professional Cooling Solutions",
  });

  if (result.metadata?.ownershipChanged === true) {
    await selected.ref.set({
      status: "skipped_human",
      discardReason: cleanText(result.metadata?.ownershipCode, 120) || "human-takeover",
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "human-takeover-during-agent-turn" };
  }

  const newer = (await pendingQueue(conversationId)).filter((item) => item.messageId !== selected.messageId);
  if (newer.length) {
    const latest = newer[newer.length - 1];
    await selected.ref.set({
      status: "coalesced",
      coalescedIntoMessageId: latest.messageId,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "newer-message-arrived", newerMessageId: latest.messageId };
  }

  const reply = await queueAgentReply({
    conversationId,
    conversation,
    inboundMessageId: selected.messageId,
    result,
    provider: selected.provider || "wacli",
  });
  if (!reply.queued && reply.reason === "human-takeover") {
    await selected.ref.set({
      status: "skipped_human",
      discardReason: "human-takeover-before-outbound-commit",
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "human-takeover-before-outbound-commit" };
  }

  await conversationRef.set({
    ...outcomeConversationPatch(result),
    agentLastInboundMessageId: selected.messageId,
    agentLastProcessedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await selected.ref.set({
    status: "processed",
    outcome: cleanText(result.metadata?.outcome, 80),
    appointmentId: cleanText(result.metadata?.appointmentId, 180),
    handoffQueue: cleanText(result.metadata?.handoffQueue, 80),
    handoffReason: cleanText(result.metadata?.handoffReason, 500),
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return {
    processed: true,
    outcome: result.metadata?.outcome || "reply",
    handoffQueue: cleanText(result.metadata?.handoffQueue, 80),
  };
}

async function processQueueEvent({ messageId, message, reactivate = false }) {
  if (!message || message.direction !== "inbound") return { ignored: true, reason: "not-inbound" };
  if (!cleanText(message.text || message.mediaCaption || message.reactionEmoji, 4_000)) {
    return { ignored: true, reason: "no-customer-content" };
  }
  if (!automaticReplySupported(message.provider || "wacli")) {
    return { ignored: true, reason: "provider-not-enabled" };
  }
  const queued = await enqueueInbound({ messageId, message, reactivate });
  if (!queued || queued.completed) return { ignored: true, reason: queued?.completed ? "already-completed" : "no-conversation" };

  const leaseOwnerId = `${queued.queueId}:${Date.now()}`;
  const lease = await acquireLease(queued.conversationId, leaseOwnerId);
  if (!lease.acquired) {
    const busy = new Error("Customer Agent conversation lease is busy; retry this event.");
    busy.code = "agent_conversation_busy";
    throw busy;
  }

  try {
    return await processLatestQueued(queued.conversationId, leaseOwnerId);
  } catch (error) {
    const snapshot = await queued.ref.get();
    const attempts = Number(snapshot.data()?.attempts || 0);
    if (attempts >= MAX_PROCESSING_ATTEMPTS) {
      await queued.ref.set({
        status: "failed",
        errorMessage: cleanText(error?.message || error, 500),
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await db.collection("communicationConversations").doc(queued.conversationId).set({
        aiDisposition: "human_active",
        status: "escalated",
        queue: "manager",
        routeReason: "Customer Agent failed repeatedly and requires human review.",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.error("Customer Agent message processing failed permanently after retries.", error);
      return { processed: false, reason: "failed-after-retries" };
    }
    await queued.ref.set({
      status: "queued",
      errorMessage: cleanText(error?.message || error, 500),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  } finally {
    await releaseLease(lease.ref, leaseOwnerId).catch(() => undefined);
  }
}

function latestCustomerMessage(conversation = {}) {
  return [...(Array.isArray(conversation.recentMessages) ? conversation.recentMessages : [])]
    .reverse()
    .find((message) => message?.role === "customer" && cleanText(message.text || message.mediaCaption || message.reactionEmoji, 4_000)) || null;
}

async function reactivateConversation(conversationId, conversation = {}) {
  if (!shouldRunAgent(conversation)) return { ignored: true, reason: "not-ai-owned" };
  const latest = latestCustomerMessage(conversation);
  if (!latest?.id) return { ignored: true, reason: "no-pending-customer-message" };

  const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(latest.id));
  const snapshot = await messageRef.get();
  const provider = cleanText(conversation.provider || latest.provider, 40) || "wacli";
  const message = snapshot.exists
    ? { id: snapshot.id, ...snapshot.data() }
    : {
      id: latest.id,
      messageId: latest.id,
      provider,
      direction: "inbound",
      chat: cleanText(conversation.chatJid || conversation.externalChatId || conversationId, 300),
      conversationId,
      phone: cleanText(conversation.phone, 80),
      text: cleanText(latest.text || latest.mediaCaption || latest.reactionEmoji, 4_000),
    };

  return processQueueEvent({
    messageId: cleanText(message.messageId || message.id || latest.id, 300),
    message,
    reactivate: true,
  });
}

exports.processCustomerAgentInbound = onDocumentCreated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const message = { id: snapshot.id, ...snapshot.data() };
    await processQueueEvent({
      messageId: cleanText(message.messageId || snapshot.id, 300),
      message,
    });
  },
);

exports.processCustomerAgentReactivation = onDocumentUpdated(
  {
    document: "communicationConversations/{conversationId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.aiDisposition === "ai_active" || after.aiDisposition !== "ai_active") return;
    if (after.ownerUserId || after.lockedByUserId) return;
    await ensureAgentSessionActive(event.params.conversationId, cleanText(after.provider, 40) || "wacli");
    await reactivateConversation(event.params.conversationId, after);
  },
);

module.exports.AGENT_LOCK_COLLECTION = AGENT_LOCK_COLLECTION;
module.exports.AGENT_QUEUE_COLLECTION = AGENT_QUEUE_COLLECTION;
module.exports.LEASE_MS = LEASE_MS;
module.exports.MAX_PROCESSING_ATTEMPTS = MAX_PROCESSING_ATTEMPTS;
module.exports.automaticReplySupported = automaticReplySupported;
module.exports.buildRuntimeBody = buildRuntimeBody;
module.exports.communicationMessageToRuntime = communicationMessageToRuntime;
module.exports.communicationOwnershipGuard = communicationOwnershipGuard;
module.exports.conversationIdentity = conversationIdentity;
module.exports.latestCustomerMessage = latestCustomerMessage;
module.exports.outboundDocumentId = outboundDocumentId;
module.exports.outcomeConversationPatch = outcomeConversationPatch;
module.exports.processQueueEvent = processQueueEvent;
module.exports.queueDocumentId = queueDocumentId;
module.exports.reactivateConversation = reactivateConversation;
module.exports.semanticHandoffQueue = semanticHandoffQueue;
module.exports.shouldRunAgent = shouldRunAgent;
module.exports.whatsappMessageToRuntime = whatsappMessageToRuntime;
