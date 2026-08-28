const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { getFunctions } = require("firebase-admin/functions");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onTaskDispatched } = require("firebase-functions/tasks");
const customerAgentCommunication = require("./demacCustomerAgentCommunication");
const customerObserverCommunication = require("./demacCustomerObserverCommunication");
const { resolveInboundParty } = require("./customerContactDirectory");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaObservationDecision,
  mayaReplyDecision,
} = require("./demacCustomerAgentReplyPolicy");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
} = require("./demacCommunicationIdentity");
const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  communicationEpochDecision,
  nonNegativeEpoch,
  positiveEpoch,
} = require("./demacCustomerTurn");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const DEFAULT_DEBOUNCE_MS = 12_000;
const MIN_DEBOUNCE_MS = 10_000;
const MAX_DEBOUNCE_MS = 15_000;
const TURN_TASK_FUNCTION = "processCustomerAgentTurnWakeup";
const DEFERRED_QUEUE_STATUSES = new Set(["deferred", "queued"]);
const AUTHORIZED_CASE_STATES = new Set(["APPOINTMENT_MATCHED", "AWAITING_CUSTOMER_DECISION"]);
const AUTHORIZED_CASE_WORKFLOWS = new Set(["cancellation", "reschedule"]);

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
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function configuredDebounceMs(settings = {}) {
  const value = Number(settings.debounceMs ?? settings.mayaDebounceMs);
  if (Number.isSafeInteger(value) && value >= MIN_DEBOUNCE_MS && value <= MAX_DEBOUNCE_MS) return value;
  return DEFAULT_DEBOUNCE_MS;
}

function inboundBaseTimestamp(message = {}, now = Date.now()) {
  return timestampMillis(
    message.firstReceivedAt
      || message.firstIngestedAt
      || message.firstSeenAt
      || message.receivedAt,
  ) || now;
}

function eligibleAtMillis({ message = {}, settings = {}, reactivate = false, now = Date.now() } = {}) {
  const base = reactivate ? now : inboundBaseTimestamp(message, now);
  return base + configuredDebounceMs(settings);
}

function queueEligibilityMillis(item = {}) {
  return timestampMillis(item.eligibleAt) || timestampMillis(item.eligibleAtIso);
}

function latestDeferredTurn(items = []) {
  return [...items]
    .filter((item) => DEFERRED_QUEUE_STATUSES.has(cleanText(item.status, 40)) && positiveEpoch(item.customerInputVersion) !== null)
    .sort((left, right) => {
      const versionDelta = positiveEpoch(left.customerInputVersion) - positiveEpoch(right.customerInputVersion);
      if (versionDelta) return versionDelta;
      const eligibilityDelta = queueEligibilityMillis(left) - queueEligibilityMillis(right);
      if (eligibilityDelta) return eligibilityDelta;
      return String(left.messageId || left.id).localeCompare(String(right.messageId || right.id));
    })
    .at(-1) || null;
}

function staleTurnStatus(epochReason = "") {
  return String(epochReason).includes("ownership") ? "skipped_human" : "coalesced";
}

function authorizedWorkflowFromObservation(observationResult = {}, partyResolution = {}) {
  if (partyResolution.status !== "existing" || partyResolution.ambiguous === true) return "";
  const observation = observationResult.observation || {};
  const caseResult = observationResult.caseResult || {};
  const workflow = cleanText(observation.intent, 80).toLowerCase();
  if (!AUTHORIZED_CASE_WORKFLOWS.has(workflow)) return "";
  if (caseResult.processed !== true || !cleanText(caseResult.appointmentId, 180)) return "";
  if (!AUTHORIZED_CASE_STATES.has(cleanText(caseResult.state, 80))) return "";
  if (cleanText(caseResult.attentionReason, 180)) return "";
  const partyClientId = cleanText(partyResolution.clientId, 180);
  const caseClientId = cleanText(caseResult.customerId, 180);
  if (!partyClientId || !caseClientId || partyClientId !== caseClientId) return "";
  return workflow;
}

function replyPolicyContext({ partyResolution = {}, observationResult = {} } = {}) {
  return {
    isNewContact: partyResolution.status === "new_contact" && partyResolution.isNewContact === true,
    authorizedWorkflow: authorizedWorkflowFromObservation(observationResult, partyResolution),
    partyResolution,
  };
}

function createCustomerTurnOrchestrator({
  database = db,
  taskQueue = null,
  observerProcessor = customerObserverCommunication.processObservedMessage,
  partyResolver = resolveInboundParty,
  agentCommunication = customerAgentCommunication,
  clock = () => Date.now(),
} = {}) {
  let resolvedTaskQueue = taskQueue;
  function queueClient() {
    if (!resolvedTaskQueue) resolvedTaskQueue = getFunctions(app).taskQueue(TURN_TASK_FUNCTION);
    return resolvedTaskQueue;
  }

  async function loadSettings() {
    const [settingsSnapshot, communicationSettingsSnapshot] = await Promise.all([
      database.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get(),
      database.collection(COMMUNICATION_SETTINGS_COLLECTION).doc(COMMUNICATION_SETTINGS_DOCUMENT).get(),
    ]);
    return {
      settings: settingsSnapshot.exists ? settingsSnapshot.data() || {} : {},
      communicationSettings: communicationSettingsSnapshot.exists ? communicationSettingsSnapshot.data() || {} : {},
    };
  }

  async function recordPolicyState({ conversationId, decision }) {
    if (!conversationId) return;
    try {
      await database.collection("communicationConversations").doc(safeDocumentId(conversationId)).set({
        mayaMode: decision.allowed ? "pilot_active" : "observe_only",
        mayaAutoReplyAllowed: decision.allowed,
        mayaAutoReplyDecisionReason: decision.reason,
        mayaAutoReplyPolicyCheckedAt: FieldValue.serverTimestamp(),
        mayaAutoReplyPolicyCheckedAtIso: new Date(clock()).toISOString(),
      }, { merge: true });
    } catch (error) {
      logger.warn("Could not persist Maya reply-policy state; canonical communication remains stored.", {
        conversationId,
        errorMessage: error?.message || String(error),
      });
    }
  }

  async function evaluateInboundPolicy(message = {}, policyContext = {}) {
    const { settings, communicationSettings } = await loadSettings();
    const conversationId = cleanText(message.conversationId, 300);
    if (!conversationId) {
      return {
        decision: { allowed: false, reason: "missing-canonical-conversation-id" },
        conversationId: "",
        conversation: {},
        settings,
        communicationSettings,
      };
    }
    const snapshot = await database.collection("communicationConversations").doc(conversationId).get();
    const conversation = snapshot.exists ? snapshot.data() || {} : {};
    const decision = mayaReplyDecision({
      message,
      conversation,
      settings,
      communicationSettings,
      isNewContact: policyContext.isNewContact === true,
      authorizedWorkflow: cleanText(policyContext.authorizedWorkflow, 80),
    });
    await recordPolicyState({ conversationId, decision });
    return { decision, conversationId, conversation, settings, communicationSettings };
  }

  async function observationPreflight(message = {}) {
    const { settings, communicationSettings } = await loadSettings();
    const conversationId = cleanText(message.conversationId, 300);
    if (!conversationId) return { allowed: false, reason: "missing-canonical-conversation-id", settings, communicationSettings, conversation: {} };
    const snapshot = await database.collection("communicationConversations").doc(conversationId).get();
    if (!snapshot.exists) return { allowed: false, reason: "canonical-conversation-not-materialized", settings, communicationSettings, conversation: {} };
    const conversation = snapshot.data() || {};
    const decision = mayaObservationDecision({ message, conversation, settings, communicationSettings });
    return { ...decision, settings, communicationSettings, conversation };
  }

  async function enqueueWake({ conversationId, messageId, customerInputVersion, ownershipVersion, eligibleAtMs }) {
    const delayMs = Math.max(0, eligibleAtMs - clock());
    await queueClient().enqueue({ conversationId, messageId, customerInputVersion, ownershipVersion }, {
      scheduleDelaySeconds: Math.ceil(delayMs / 1000),
      dispatchDeadlineSeconds: 120,
    });
    return { scheduled: true, delayMs };
  }

  async function scheduleInboundTurn({ messageId, message = {}, reactivate = false } = {}) {
    if (message.direction !== "inbound") return { scheduled: false, reason: "not-canonical-inbound" };
    const inputVersion = positiveEpoch(message.customerInputVersion);
    const conversationId = cleanText(message.conversationId, 300);
    if (!conversationId || inputVersion === null) return { scheduled: false, reason: "missing-turn-identity" };

    const preflight = await observationPreflight(message);
    if (!preflight.allowed) return { scheduled: false, reason: preflight.reason };
    const expectedOwnershipVersion = nonNegativeEpoch(preflight.conversation?.ownershipVersion);
    if (expectedOwnershipVersion === null) return { scheduled: false, reason: "missing-ownership-version" };
    const currentInputVersion = positiveEpoch(preflight.conversation?.customerInputVersion);
    if (currentInputVersion === null || currentInputVersion !== inputVersion) return { scheduled: false, reason: "stale-customer-turn-before-schedule" };

    const eligibleAtMs = eligibleAtMillis({ message, settings: preflight.settings, reactivate, now: clock() });
    const queued = await agentCommunication.enqueueInbound({ messageId, message, reactivate }, database);
    if (!queued || queued.completed) {
      return { scheduled: false, reason: queued?.processing ? "already-processing" : queued?.completed ? "already-completed" : "queue-not-created" };
    }
    await queued.ref.set({
      status: "deferred",
      expectedOwnershipVersion,
      expectedCustomerInputVersion: inputVersion,
      eligibleAt: Timestamp.fromMillis(eligibleAtMs),
      eligibleAtIso: new Date(eligibleAtMs).toISOString(),
      debounceMs: configuredDebounceMs(preflight.settings),
      deferredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await enqueueWake({ conversationId, messageId, customerInputVersion: inputVersion, ownershipVersion: expectedOwnershipVersion, eligibleAtMs });
    return { scheduled: true, conversationId, messageId, ownershipVersion: expectedOwnershipVersion, customerInputVersion: inputVersion, eligibleAtMs };
  }

  async function loadDeferredTurns(conversationId) {
    const snapshot = await database.collection(agentCommunication.AGENT_QUEUE_COLLECTION).where("conversationId", "==", conversationId).get();
    return snapshot.docs.map((doc) => ({ ref: doc.ref, id: doc.id, ...doc.data() }));
  }

  async function coalesceOlderDeferred(items, selected) {
    const selectedVersion = positiveEpoch(selected.customerInputVersion);
    const older = items.filter((item) => (
      item.id !== selected.id
      && DEFERRED_QUEUE_STATUSES.has(cleanText(item.status, 40))
      && positiveEpoch(item.customerInputVersion) !== null
      && positiveEpoch(item.customerInputVersion) < selectedVersion
    ));
    if (!older.length) return;
    const batch = database.batch();
    for (const item of older) {
      batch.set(item.ref, { status: "coalesced", coalescedIntoMessageId: selected.messageId, completedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }

  async function promoteIfEligible(selected, now) {
    let promoted = false;
    let reason = "unknown";
    await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(selected.ref);
      if (!snapshot.exists) { reason = "queue-item-missing"; return; }
      const current = { id: snapshot.id, ...snapshot.data() };
      if (!DEFERRED_QUEUE_STATUSES.has(cleanText(current.status, 40))) { reason = "queue-item-not-deferred"; return; }
      const eligibleAtMs = queueEligibilityMillis(current);
      if (!eligibleAtMs || eligibleAtMs > now) { reason = "turn-not-eligible-yet"; return; }
      transaction.set(selected.ref, { status: "queued", wakeupClaimedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      promoted = true;
      reason = "eligible";
    });
    return { promoted, reason };
  }

  async function suppressStaleTurn(selected, epochReason, phase) {
    const status = staleTurnStatus(epochReason);
    await selected.ref.set({ status, discardReason: `${phase}:${epochReason || "unknown"}`, completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { processed: false, reason: phase, epochReason, status };
  }

  async function wakeConversationTurn({ conversationId } = {}) {
    const canonicalConversationId = cleanText(conversationId, 300);
    if (!canonicalConversationId) return { processed: false, reason: "missing-canonical-conversation-id" };
    const items = await loadDeferredTurns(canonicalConversationId);
    const selected = latestDeferredTurn(items);
    if (!selected) return { processed: false, reason: "no-deferred-turn" };

    const now = clock();
    const selectedEligibleAt = queueEligibilityMillis(selected);
    if (!selectedEligibleAt) {
      await selected.ref.set({ status: "failed", errorMessage: "Deferred turn is missing eligibleAt.", completedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { processed: false, reason: "missing-eligible-at" };
    }
    const expectedOwnershipVersion = nonNegativeEpoch(selected.expectedOwnershipVersion);
    const expectedCustomerInputVersion = positiveEpoch(selected.expectedCustomerInputVersion || selected.customerInputVersion);
    if (expectedOwnershipVersion === null || expectedCustomerInputVersion === null) {
      await selected.ref.set({ status: "failed", errorMessage: "Deferred turn is missing communication epochs.", completedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { processed: false, reason: "missing-deferred-turn-epochs" };
    }
    if (selectedEligibleAt > now) {
      await enqueueWake({ conversationId: canonicalConversationId, messageId: selected.messageId, customerInputVersion: expectedCustomerInputVersion, ownershipVersion: expectedOwnershipVersion, eligibleAtMs: selectedEligibleAt });
      return { processed: false, deferred: true, reason: "turn-not-eligible-yet", eligibleAtMs: selectedEligibleAt };
    }

    const conversationRef = database.collection("communicationConversations").doc(canonicalConversationId);
    const conversationSnapshot = await conversationRef.get();
    if (!conversationSnapshot.exists) return { processed: false, reason: "canonical-conversation-not-materialized" };
    const initialEpoch = communicationEpochDecision({ conversation: conversationSnapshot.data() || {}, expectedOwnershipVersion, expectedCustomerInputVersion });
    if (!initialEpoch.allowed) return suppressStaleTurn(selected, initialEpoch.reason, "stale-communication-epoch-before-debounce-wakeup");

    const promotion = await promoteIfEligible(selected, now);
    if (!promotion.promoted) return { processed: false, deferred: promotion.reason === "turn-not-eligible-yet", reason: promotion.reason };
    await coalesceOlderDeferred(items, selected);

    const messageSnapshot = await database.collection("whatsappMessages").doc(cleanText(selected.messageId, 300)).get();
    if (!messageSnapshot.exists) throw new Error("Canonical customer message is missing at deferred turn wake-up.");
    const message = { id: messageSnapshot.id, ...messageSnapshot.data() };

    const observation = await observerProcessor({ messageId: messageSnapshot.id, message, expectedOwnershipVersion, expectedCustomerInputVersion });

    const currentConversationSnapshot = await conversationRef.get();
    if (!currentConversationSnapshot.exists) return { processed: false, reason: "canonical-conversation-not-materialized" };
    const currentConversation = currentConversationSnapshot.data() || {};
    const postObserverEpoch = communicationEpochDecision({ conversation: currentConversation, expectedOwnershipVersion, expectedCustomerInputVersion });
    if (!postObserverEpoch.allowed) return suppressStaleTurn(selected, postObserverEpoch.reason, "stale-communication-epoch-after-observer");
    if (!agentCommunication.shouldRunAgent(currentConversation)) {
      await selected.ref.set({ status: "skipped_human", discardReason: "human-active-after-observer", completedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { processed: false, observed: observation?.observed === true, reason: "human-active-after-observer" };
    }

    const partyResolution = await partyResolver(database, {
      clientId: cleanText(currentConversation.customerId || message.customerId, 180),
      phone: currentConversation.phone || message.phone,
      whatsapp: currentConversation.whatsapp || message.whatsapp || currentConversation.phone || message.phone,
    });
    const policyContext = replyPolicyContext({ partyResolution, observationResult: observation });
    const { decision } = await evaluateInboundPolicy(message, policyContext);
    if (!decision.allowed) {
      await selected.ref.set({
        status: "skipped_policy",
        discardReason: `maya-reply-policy:${decision.reason}`,
        partyResolutionStatus: cleanText(partyResolution.status, 40) || "unknown",
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { processed: false, observed: observation?.observed === true, reason: `reply-policy-blocked:${decision.reason}` };
    }

    return agentCommunication.processQueueEvent({ messageId: cleanText(message.messageId || message.id, 300), message });
  }

  async function scheduleConversationReactivation(conversationId, conversation = {}) {
    const canonicalConversationId = cleanText(conversationId, 300);
    if (!canonicalConversationId) return { scheduled: false, reason: "missing-canonical-conversation" };
    if (!agentCommunication.shouldRunAgent(conversation)) return { scheduled: false, reason: "not-ai-owned" };
    const latest = agentCommunication.latestCustomerMessage(conversation);
    if (!latest?.id) return { scheduled: false, reason: "no-pending-customer-message" };
    const snapshot = await database.collection("whatsappMessages").doc(cleanText(latest.id, 300)).get();
    if (!snapshot.exists) return { scheduled: false, reason: "canonical-message-missing" };
    const message = { id: snapshot.id, ...snapshot.data() };
    if (cleanText(message.conversationId, 300) !== canonicalConversationId) return { scheduled: false, reason: "canonical-message-conversation-mismatch" };
    return scheduleInboundTurn({ messageId: cleanText(message.messageId || message.id, 300), message, reactivate: true });
  }

  return {
    coalesceOlderDeferred,
    enqueueWake,
    evaluateInboundPolicy,
    loadDeferredTurns,
    loadSettings,
    observationPreflight,
    promoteIfEligible,
    recordPolicyState,
    scheduleConversationReactivation,
    scheduleInboundTurn,
    suppressStaleTurn,
    wakeConversationTurn,
  };
}

const orchestrator = createCustomerTurnOrchestrator();

exports.processCustomerAgentTurnWakeup = onTaskDispatched(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 180,
    secrets: [openAiApiKey],
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 5, maxBackoffSeconds: 60, maxDoublings: 3 },
    rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 20 },
  },
  async (request) => orchestrator.wakeConversationTurn(request.data || {}),
);

module.exports.AUTHORIZED_CASE_STATES = AUTHORIZED_CASE_STATES;
module.exports.AUTHORIZED_CASE_WORKFLOWS = AUTHORIZED_CASE_WORKFLOWS;
module.exports.DEFAULT_DEBOUNCE_MS = DEFAULT_DEBOUNCE_MS;
module.exports.MIN_DEBOUNCE_MS = MIN_DEBOUNCE_MS;
module.exports.MAX_DEBOUNCE_MS = MAX_DEBOUNCE_MS;
module.exports.TURN_TASK_FUNCTION = TURN_TASK_FUNCTION;
module.exports.authorizedWorkflowFromObservation = authorizedWorkflowFromObservation;
module.exports.configuredDebounceMs = configuredDebounceMs;
module.exports.createCustomerTurnOrchestrator = createCustomerTurnOrchestrator;
module.exports.eligibleAtMillis = eligibleAtMillis;
module.exports.inboundBaseTimestamp = inboundBaseTimestamp;
module.exports.latestDeferredTurn = latestDeferredTurn;
module.exports.queueEligibilityMillis = queueEligibilityMillis;
module.exports.replyPolicyContext = replyPolicyContext;
module.exports.staleTurnStatus = staleTurnStatus;
module.exports.timestampMillis = timestampMillis;
