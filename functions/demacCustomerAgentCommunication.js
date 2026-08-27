const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { createCustomerAgentRuntime, HANDOFF_QUEUES } = require("./demacCustomerAgentRuntimeV1");
const { sessionIdentity, stableConversationIdentity } = require("./demacCustomerConversationState");
const {
  canonicalRuntimeMessage,
  communicationEpochDecision,
  customerSemanticContent,
  nonNegativeEpoch,
  positiveEpoch,
} = require("./demacCustomerTurn");
const { cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { cleanCustomerFacingMessage } = require("./demacCustomerMessageFormatting");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaReplyDecision,
  mayaSenderOwnershipDecision,
} = require("./demacCustomerAgentReplyPolicy");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
} = require("./demacCommunicationIdentity");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const AGENT_QUEUE_COLLECTION = "customerAgentInboundQueue";
const AGENT_LOCK_COLLECTION = "customerAgentConversationLocks";
const LEASE_MS = 2 * 60 * 1000;
const MAX_PROCESSING_ATTEMPTS = 5;
const REPLAYABLE_OUTBOUND_STATUSES = new Set(["queued", "processing", "sent"]);

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeAttemptCount(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function conversationIdentity(message = {}) {
  return stableConversationIdentity({ conversationId: message.conversationId });
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
  return mayaSenderOwnershipDecision({ conversation }).allowed;
}

async function communicationOwnershipGuard({ context = {} } = {}) {
  const conversationId = stableConversationIdentity(context);
  if (!conversationId) {
    return { allowed: false, code: "missing_conversation_identity", reason: "Canonical Communication Center conversation identity is missing." };
  }
  const snapshot = await db.collection("communicationConversations").doc(conversationId).get();
  if (!snapshot.exists) {
    return { allowed: false, code: "conversation_missing", reason: "Communication Center conversation no longer exists." };
  }
  const conversation = snapshot.data() || {};
  const expectedAccount = cleanText(context.communicationAccountId, 180).toLowerCase();
  const currentAccount = cleanText(conversation.communicationAccountId, 180).toLowerCase();
  if (!expectedAccount || !currentAccount) {
    return { allowed: false, code: "communication_account_missing", reason: "Communication account identity is missing for this autonomous turn." };
  }
  if (expectedAccount !== currentAccount) {
    return { allowed: false, code: "communication_account_changed", reason: "Communication account identity changed before this action." };
  }
  if (!shouldRunAgent(conversation)) {
    return { allowed: false, code: "human_takeover", reason: "A DEMAC operator owns or paused this conversation now." };
  }
  const epochDecision = communicationEpochDecision({
    conversation,
    expectedOwnershipVersion: context.expectedOwnershipVersion,
    expectedCustomerInputVersion: context.expectedCustomerInputVersion,
  });
  if (!epochDecision.allowed) {
    return {
      allowed: false,
      code: epochDecision.reason,
      reason: "Communication ownership or the current customer turn changed before this action.",
    };
  }
  return { allowed: true };
}

function communicationMessageToRuntime(message = {}) {
  return canonicalRuntimeMessage(message, 4_000);
}

function whatsappMessageToRuntime(message = {}) {
  return canonicalRuntimeMessage(message, 4_000);
}

function buildRuntimeBody({ conversationId, conversation = {}, inboundMessage = {}, provider = "wacli" }) {
  const canonicalConversationId = stableConversationIdentity({ conversationId });
  if (!canonicalConversationId) throw new Error("Customer Agent runtime requires a canonical Communication Center conversation ID.");
  const inbound = whatsappMessageToRuntime(inboundMessage);
  const messages = (Array.isArray(conversation.recentMessages) ? conversation.recentMessages : [])
    .map(communicationMessageToRuntime)
    .filter(Boolean);
  if (inbound && !messages.some((message) => message.id === inbound.id)) messages.push(inbound);
  const normalizedMessages = messages.slice(-40);
  const latestInbound = inbound || [...normalizedMessages].reverse().find((message) => message.direction === "inbound");
  const communicationAccountId = cleanText(conversation.communicationAccountId || inboundMessage.communicationAccountId, 180).toLowerCase();
  const customerInputVersion = positiveEpoch(latestInbound?.customerInputVersion)
    ?? positiveEpoch(inboundMessage.customerInputVersion);
  const ownershipVersion = nonNegativeEpoch(conversation.ownershipVersion);
  if (!communicationAccountId) throw new Error("Customer Agent runtime requires canonical communicationAccountId.");
  if (customerInputVersion === null) throw new Error("Customer Agent runtime requires a positive customerInputVersion.");
  if (ownershipVersion === null) throw new Error("Customer Agent runtime requires ownershipVersion.");
  return {
    provider,
    channel: "whatsapp",
    communicationAccountId,
    conversationId: canonicalConversationId,
    inboundMessageId: latestInbound?.id || cleanText(inboundMessage.messageId, 300),
    ownershipVersion,
    customerInputVersion,
    conversation: {
      id: canonicalConversationId,
      conversationId: canonicalConversationId,
      communicationAccountId,
      provider,
      contactPhone: cleanText(conversation.phone || inboundMessage.phone, 80),
      contactJid: cleanText(conversation.chatJid || conversation.externalChatId || inboundMessage.chat, 180),
      chatTitle: cleanText(conversation.customer || inboundMessage.chatName, 180),
      messages: normalizedMessages,
      customerTurn: {
        id: latestInbound?.id || "",
        text: latestInbound?.text || "",
        ownershipVersion,
        customerInputVersion,
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
      aiDisposition: "handoff_pending",
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

async function enqueueInbound({ messageId, message, reactivate = false }, database = db) {
  const conversationId = conversationIdentity(message);
  const messageInputVersion = positiveEpoch(message.customerInputVersion);
  if (!conversationId || messageInputVersion === null) return null;
  const queueId = queueDocumentId(conversationId, messageId);
  const ref = database.collection(AGENT_QUEUE_COLLECTION).doc(queueId);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let decision = { completed: false, processing: false };

  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const currentStatus = cleanText(current.status, 40);
    const terminalStatuses = ["processed", "coalesced", "skipped_provider", "skipped_policy", "failed"];
    if (terminalStatuses.includes(currentStatus) || (currentStatus === "skipped_human" && !reactivate)) {
      decision = { completed: true, processing: false };
      return;
    }
    if (currentStatus === "processing") {
      const startedAt = timestampMillis(current.processingStartedAt);
      if (startedAt && startedAt + LEASE_MS > now) {
        decision = { completed: true, processing: true };
        return;
      }
    }
    transaction.set(ref, {
      id: queueId,
      conversationId,
      communicationAccountId: cleanText(message.communicationAccountId, 180).toLowerCase() || current.communicationAccountId || "",
      provider: cleanText(message.provider, 40) || "wacli",
      messageId,
      customerInputVersion: messageInputVersion,
      status: "queued",
      attempts: safeAttemptCount(current.attempts),
      reactivated: reactivate || current.reactivated === true,
      queuedAt: current.queuedAt || FieldValue.serverTimestamp(),
      queuedAtIso: current.queuedAtIso || nowIso,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    decision = { completed: false, processing: false };
  });

  return { ref, queueId, conversationId, ...decision };
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
    .filter((item) => item.status === "queued" && positiveEpoch(item.customerInputVersion) !== null)
    .sort((left, right) => {
      const versionDelta = positiveEpoch(left.customerInputVersion) - positiveEpoch(right.customerInputVersion);
      if (versionDelta) return versionDelta;
      const leftTime = timestampMillis(left.queuedAt) || Date.parse(left.queuedAtIso || "") || 0;
      const rightTime = timestampMillis(right.queuedAt) || Date.parse(right.queuedAtIso || "") || 0;
      return leftTime - rightTime || String(left.messageId).localeCompare(String(right.messageId));
    });
}

async function markOlderAsCoalesced(items, selected) {
  const selectedVersion = positiveEpoch(selected.customerInputVersion);
  const older = items.filter((item) => item.id !== selected.id && positiveEpoch(item.customerInputVersion) <= selectedVersion);
  if (!older.length) return;
  const batch = db.batch();
  older.forEach((item) => batch.set(item.ref, {
    status: "coalesced",
    coalescedIntoMessageId: selected.messageId,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true }));
  await batch.commit();
}

async function ensureAgentSessionActive(conversationId, provider, communicationAccountId = "") {
  const identity = sessionIdentity({ communicationAccountId, channel: "whatsapp", provider, conversationId });
  if (!identity) throw new Error("Customer Agent session requires a canonical Communication Center conversation identity.");
  await db.collection("customerAgentSessions").doc(identity.sessionId).set({
    version: 3,
    ...(communicationAccountId ? { communicationAccountId: cleanText(communicationAccountId, 180).toLowerCase() } : {}),
    channel: "whatsapp",
    provider: identity.provider,
    conversationId: identity.conversation,
    status: "AI_ACTIVE",
    requiresHuman: false,
    handoffQueue: "",
    handoffReason: "",
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
  }, { merge: true });
}

function mayaOutboundReplayDecision({ existing = {}, expected = {} } = {}) {
  const status = cleanText(existing.status, 40).toLowerCase();
  const sameIntent = cleanText(existing.provider, 40).toLowerCase() === "wacli"
    && cleanText(existing.outboundClass, 80).toLowerCase() === "conversation_maya"
    && cleanText(existing.communicationAccountId, 180).toLowerCase() === cleanText(expected.communicationAccountId, 180).toLowerCase()
    && cleanText(existing.conversationId, 300) === cleanText(expected.conversationId, 300)
    && cleanText(existing.sourceInboundMessageId, 300) === cleanText(expected.sourceInboundMessageId, 300)
    && cleanText(existing.to, 300) === cleanText(expected.to, 300)
    && cleanText(existing.text, 3_000) === cleanText(expected.text, 3_000)
    && nonNegativeEpoch(existing.expectedOwnershipVersion) === nonNegativeEpoch(expected.expectedOwnershipVersion)
    && positiveEpoch(existing.expectedCustomerInputVersion) === positiveEpoch(expected.expectedCustomerInputVersion);
  if (!sameIntent) return { allowed: false, reason: "outbound-command-conflict" };
  if (status === "failed") return { allowed: false, reason: "outbound-terminal-failure" };
  if (!REPLAYABLE_OUTBOUND_STATUSES.has(status)) return { allowed: false, reason: "outbound-status-not-replayable" };
  return { allowed: true, reason: "matching-outbound-replay", status };
}

async function queueAgentReply({
  conversationId,
  inboundMessageId,
  result,
  provider,
  expectedOwnershipVersion,
  expectedCustomerInputVersion,
}) {
  if (!automaticReplySupported(provider)) {
    throw new Error(`Automatic customer-agent replies are not enabled for provider ${cleanText(provider, 40) || "unknown"}.`);
  }
  const text = cleanCustomerFacingMessage(result.draft, 3_000);
  if (!text) return { queued: false, reason: "empty-draft" };
  const id = outboundDocumentId(conversationId, inboundMessageId);
  const ref = db.collection("whatsappOutboundQueue").doc(id);
  const conversationRef = db.collection("communicationConversations").doc(conversationId);
  const settingsRef = db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT);
  const communicationSettingsRef = db.collection(COMMUNICATION_SETTINGS_COLLECTION).doc(COMMUNICATION_SETTINGS_DOCUMENT);
  let outcome = { queued: false, id, reason: "not-created" };

  await db.runTransaction(async (transaction) => {
    const [conversationSnapshot, existing, settingsSnapshot, communicationSettingsSnapshot] = await Promise.all([
      transaction.get(conversationRef),
      transaction.get(ref),
      transaction.get(settingsRef),
      transaction.get(communicationSettingsRef),
    ]);
    if (!conversationSnapshot.exists || !shouldRunAgent(conversationSnapshot.data() || {})) {
      outcome = { queued: false, id, reason: "human-takeover" };
      return;
    }
    const currentConversation = conversationSnapshot.data() || {};
    const communicationAccountId = cleanText(currentConversation.communicationAccountId, 180).toLowerCase();
    if (!communicationAccountId) {
      outcome = { queued: false, id, reason: "missing-communication-account-id" };
      return;
    }
    const epochDecision = communicationEpochDecision({
      conversation: currentConversation,
      expectedOwnershipVersion,
      expectedCustomerInputVersion,
    });
    if (!epochDecision.allowed) {
      outcome = { queued: false, id, reason: "stale-communication-epoch", epochReason: epochDecision.reason };
      return;
    }
    const replyDecision = mayaReplyDecision({
      conversation: currentConversation,
      settings: settingsSnapshot.exists ? settingsSnapshot.data() || {} : {},
      communicationSettings: communicationSettingsSnapshot.exists ? communicationSettingsSnapshot.data() || {} : {},
    });
    if (!replyDecision.allowed) {
      outcome = { queued: false, id, reason: replyDecision.reason, phone: replyDecision.phone || "" };
      return;
    }
    const to = cleanText(currentConversation.chatJid || currentConversation.externalChatId || currentConversation.phone, 300);
    if (!to) throw new Error("Customer Agent cannot reply because the canonical conversation has no WhatsApp recipient.");
    const expectedOutbound = {
      communicationAccountId,
      conversationId,
      sourceInboundMessageId: inboundMessageId,
      to,
      text,
      expectedOwnershipVersion: epochDecision.ownershipVersion,
      expectedCustomerInputVersion: epochDecision.customerInputVersion,
    };
    if (existing.exists) {
      const replayDecision = mayaOutboundReplayDecision({ existing: existing.data() || {}, expected: expectedOutbound });
      if (!replayDecision.allowed) {
        const error = new Error(`Existing Maya outbound cannot be reused safely: ${replayDecision.reason}.`);
        error.code = replayDecision.reason;
        throw error;
      }
    } else {
      transaction.set(ref, {
        id,
        provider: "wacli",
        communicationAccountId,
        outboundClass: "conversation_maya",
        status: "queued",
        type: "text",
        to,
        text,
        conversationId,
        sourceInboundMessageId: inboundMessageId,
        expectedOwnershipVersion: epochDecision.ownershipVersion,
        expectedCustomerInputVersion: epochDecision.customerInputVersion,
        createdByUserId: "demac-customer-agent",
        createdByName: "Maya",
        createdAt: FieldValue.serverTimestamp(),
        createdAtIso: new Date().toISOString(),
      });
    }
    transaction.set(conversationRef, {
      ...outcomeConversationPatch(result),
      agentLastInboundMessageId: inboundMessageId,
      agentLastProcessedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    outcome = { queued: true, id, existing: existing.exists };
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
    db.collection("whatsappMessages").doc(cleanText(selected.messageId, 300)).get(),
  ]);
  if (!conversationSnapshot.exists) {
    const notReady = new Error("Canonical Communication Center conversation is not materialized yet; retry this event.");
    notReady.code = "conversation_not_ready";
    throw notReady;
  }
  if (!messageSnapshot.exists) {
    const missing = new Error("Canonical inbound WhatsApp message is missing; autonomous processing cannot reconstruct it from phone/JID fallbacks.");
    missing.code = "canonical_message_missing";
    throw missing;
  }
  const conversation = conversationSnapshot.data() || {};
  const inboundMessage = { id: messageSnapshot.id, ...messageSnapshot.data() };
  const currentAccount = cleanText(conversation.communicationAccountId, 180).toLowerCase();
  const queuedAccount = cleanText(selected.communicationAccountId, 180).toLowerCase();
  if (!currentAccount || !queuedAccount || queuedAccount !== currentAccount) {
    await selected.ref.set({ status: "skipped_policy", discardReason: "communication-account-changed-or-missing", completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { processed: false, reason: "communication-account-changed-or-missing" };
  }
  if (!customerSemanticContent(inboundMessage, 4_000)) {
    await selected.ref.set({ status: "skipped_policy", discardReason: "no-canonical-customer-content", completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { processed: false, reason: "no-canonical-customer-content" };
  }
  const expectedOwnershipVersion = nonNegativeEpoch(conversation.ownershipVersion);
  const currentInputVersion = positiveEpoch(conversation.customerInputVersion);
  const queuedInputVersion = positiveEpoch(selected.customerInputVersion);
  const messageInputVersion = positiveEpoch(inboundMessage.customerInputVersion);
  if (
    expectedOwnershipVersion === null
    || currentInputVersion === null
    || queuedInputVersion === null
    || messageInputVersion === null
    || queuedInputVersion !== messageInputVersion
    || currentInputVersion !== messageInputVersion
  ) {
    await selected.ref.set({
      status: "coalesced",
      discardReason: "stale-or-invalid-customer-input-version",
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "stale-or-invalid-customer-input-version" };
  }
  if (!shouldRunAgent(conversation)) {
    await selected.ref.set({ status: "skipped_human", completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { processed: false, reason: "human-active" };
  }

  const attempts = safeAttemptCount(selected.attempts) + 1;
  await selected.ref.set({
    status: "processing",
    attempts,
    leaseOwnerId,
    expectedOwnershipVersion,
    expectedCustomerInputVersion: currentInputVersion,
    processingStartedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await ensureAgentSessionActive(conversationId, selected.provider || "wacli", currentAccount);

  const rawBody = buildRuntimeBody({
    conversationId,
    conversation,
    inboundMessage,
    provider: selected.provider || "wacli",
  });
  const turnRuntime = createCustomerAgentRuntime({
    db,
    executionGuard: ({ context = {} } = {}) => communicationOwnershipGuard({
      context: {
        ...context,
        communicationAccountId: currentAccount,
        expectedOwnershipVersion,
        expectedCustomerInputVersion: currentInputVersion,
      },
    }),
  });
  const result = await turnRuntime.runTurn({
    rawBody,
    apiKey: openAiApiKey.value(),
    company: "DEMAC Professional Cooling Solutions",
  });

  if (result.metadata?.ownershipChanged === true) {
    await selected.ref.set({
      status: result.metadata?.ownershipCode === "customer-input-version-changed" ? "coalesced" : "skipped_human",
      discardReason: cleanText(result.metadata?.ownershipCode, 120) || "communication-epoch-changed",
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "communication-epoch-changed-during-agent-turn" };
  }

  const newer = (await pendingQueue(conversationId))
    .filter((item) => positiveEpoch(item.customerInputVersion) > currentInputVersion);
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
    inboundMessageId: selected.messageId,
    result,
    provider: selected.provider || "wacli",
    expectedOwnershipVersion,
    expectedCustomerInputVersion: currentInputVersion,
  });
  if (!reply.queued && reply.reason === "human-takeover") {
    await selected.ref.set({ status: "skipped_human", discardReason: "human-takeover-before-outbound-commit", completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { processed: false, reason: "human-takeover-before-outbound-commit" };
  }
  if (!reply.queued && reply.reason === "stale-communication-epoch") {
    const customerStale = reply.epochReason === "customer-input-version-changed" || reply.epochReason === "current-customer-input-version-missing";
    await selected.ref.set({
      status: customerStale ? "coalesced" : "skipped_human",
      discardReason: `stale-communication-epoch:${reply.epochReason || "unknown"}`,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: "stale-communication-epoch-before-outbound-commit" };
  }
  if (!reply.queued && reply.reason !== "empty-draft") {
    await selected.ref.set({
      status: "skipped_policy",
      discardReason: `maya-reply-policy:${reply.reason}`,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await conversationRef.set({
      mayaMode: "observe_only",
      mayaAutoReplyAllowed: false,
      mayaAutoReplyDecisionReason: reply.reason,
      mayaAutoReplyPolicyCheckedAt: FieldValue.serverTimestamp(),
      mayaAutoReplyPolicyCheckedAtIso: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { processed: false, reason: `reply-policy-blocked:${reply.reason}` };
  }
  if (!reply.queued) throw new Error(`Customer Agent produced no outbound message: ${reply.reason || "unknown"}.`);

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
  if (!customerSemanticContent(message, 4_000)) return { ignored: true, reason: "no-customer-content" };
  if (positiveEpoch(message.customerInputVersion) === null) return { ignored: true, reason: "missing-customer-input-version" };
  if (!automaticReplySupported(message.provider || "wacli")) return { ignored: true, reason: "provider-not-enabled" };
  const queued = await enqueueInbound({ messageId, message, reactivate });
  if (!queued || queued.completed) {
    return { ignored: true, reason: queued?.processing ? "already-processing" : queued?.completed ? "already-completed" : "no-canonical-conversation" };
  }

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
    const attempts = safeAttemptCount(snapshot.data()?.attempts);
    if (attempts >= MAX_PROCESSING_ATTEMPTS) {
      await queued.ref.set({
        status: "failed",
        errorMessage: cleanText(error?.message || error, 500),
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await db.collection("communicationConversations").doc(queued.conversationId).set({
        aiDisposition: "handoff_pending",
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
    .find((message) => message?.role === "customer" && cleanText(message.id, 300)) || null;
}

async function reactivateConversation(conversationId, conversation = {}) {
  const canonicalConversationId = stableConversationIdentity({ conversationId });
  if (!canonicalConversationId) return { ignored: true, reason: "missing-canonical-conversation" };
  if (!shouldRunAgent(conversation)) return { ignored: true, reason: "not-ai-owned" };
  const latest = latestCustomerMessage(conversation);
  if (!latest?.id) return { ignored: true, reason: "no-pending-customer-message" };

  const messageRef = db.collection("whatsappMessages").doc(cleanText(latest.id, 300));
  const snapshot = await messageRef.get();
  if (!snapshot.exists) return { ignored: true, reason: "canonical-message-missing" };
  const message = { id: snapshot.id, ...snapshot.data() };
  if (stableConversationIdentity({ conversationId: message.conversationId }) !== canonicalConversationId) {
    return { ignored: true, reason: "canonical-message-conversation-mismatch" };
  }
  if (!customerSemanticContent(message, 4_000)) return { ignored: true, reason: "no-canonical-customer-content" };
  if (positiveEpoch(message.customerInputVersion) === null) return { ignored: true, reason: "missing-customer-input-version" };

  return processQueueEvent({
    messageId: cleanText(message.messageId || message.id, 300),
    message,
    reactivate: true,
  });
}

module.exports.AGENT_LOCK_COLLECTION = AGENT_LOCK_COLLECTION;
module.exports.AGENT_QUEUE_COLLECTION = AGENT_QUEUE_COLLECTION;
module.exports.LEASE_MS = LEASE_MS;
module.exports.MAX_PROCESSING_ATTEMPTS = MAX_PROCESSING_ATTEMPTS;
module.exports.automaticReplySupported = automaticReplySupported;
module.exports.buildRuntimeBody = buildRuntimeBody;
module.exports.communicationMessageToRuntime = communicationMessageToRuntime;
module.exports.communicationOwnershipGuard = communicationOwnershipGuard;
module.exports.conversationIdentity = conversationIdentity;
module.exports.enqueueInbound = enqueueInbound;
module.exports.ensureAgentSessionActive = ensureAgentSessionActive;
module.exports.latestCustomerMessage = latestCustomerMessage;
module.exports.mayaOutboundReplayDecision = mayaOutboundReplayDecision;
module.exports.outboundDocumentId = outboundDocumentId;
module.exports.outcomeConversationPatch = outcomeConversationPatch;
module.exports.pendingQueue = pendingQueue;
module.exports.processLatestQueued = processLatestQueued;
module.exports.processQueueEvent = processQueueEvent;
module.exports.queueAgentReply = queueAgentReply;
module.exports.queueDocumentId = queueDocumentId;
module.exports.reactivateConversation = reactivateConversation;
module.exports.safeAttemptCount = safeAttemptCount;
module.exports.semanticHandoffQueue = semanticHandoffQueue;
module.exports.shouldRunAgent = shouldRunAgent;
module.exports.whatsappMessageToRuntime = whatsappMessageToRuntime;
