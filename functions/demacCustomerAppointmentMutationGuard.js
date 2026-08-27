const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  hashKey,
} = require("./bookingAuthorityCore");
const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
  activeAccountDecision,
} = require("./demacCommunicationIdentity");
const { communicationEpochDecision, positiveEpoch, nonNegativeEpoch } = require("./demacCustomerTurn");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaBusinessActionDecision,
  mayaSenderOwnershipDecision,
} = require("./demacCustomerAgentReplyPolicy");

const MAYA_APPOINTMENT_MUTATION_ACTIONS = new Set([
  "cancel_appointment",
  "reschedule_appointment",
]);
const MAYA_APPOINTMENT_WORKFLOWS = new Set(["cancellation", "reschedule"]);
const MAYA_APPOINTMENT_WORKFLOW_STATES = new Set(["APPOINTMENT_MATCHED", "AWAITING_CUSTOMER_DECISION"]);
const ACTION_WORKFLOW = Object.freeze({
  cancel_appointment: "cancellation",
  reschedule_appointment: "reschedule",
});
const CUSTOMER_AGENT_QUEUE_COLLECTION = "customerAgentInboundQueue";
const MAYA_MUTATION_RECEIPT_COLLECTION = "customerAgentMutationReceipts";

function mutationContextIdentity(context = {}) {
  return {
    conversationId: cleanText(context.conversationId || context.conversationKey, 300),
    inboundMessageId: cleanText(context.inboundMessageId || context.messageId, 300),
  };
}

function denied(reason, details = {}) {
  return { allowed: false, reason: cleanText(reason, 160) || "maya-mutation-not-authorized", ...details };
}

function appointmentWorkflowContextFromConversation(conversation = {}, inboundMessageId = "") {
  const insight = conversation.mayaInsight && typeof conversation.mayaInsight === "object"
    ? conversation.mayaInsight
    : {};
  const observedMessageId = cleanText(conversation.mayaLastObservedMessageId, 300);
  const expectedMessageId = cleanText(inboundMessageId, 300);
  const workflow = cleanText(insight.intent, 80).toLowerCase();
  const appointmentId = cleanText(insight.appointmentId, 180);
  const caseId = cleanText(insight.caseId || conversation.mayaCaseId, 180);
  const caseState = cleanText(insight.caseState, 80);
  if (!expectedMessageId || observedMessageId !== expectedMessageId) {
    return { valid: false, reason: "appointment-workflow-not-current" };
  }
  if (!MAYA_APPOINTMENT_WORKFLOWS.has(workflow)) {
    return { valid: false, reason: "appointment-workflow-not-authorized" };
  }
  if (!appointmentId || !caseId || !MAYA_APPOINTMENT_WORKFLOW_STATES.has(caseState)) {
    return { valid: false, reason: "appointment-workflow-context-incomplete" };
  }
  if (cleanText(conversation.mayaAttentionReason, 180)) {
    return { valid: false, reason: "appointment-workflow-requires-human-attention" };
  }
  return {
    valid: true,
    workflow,
    appointmentId,
    caseId,
    caseState,
  };
}

function normalizedWorkLine(line = {}) {
  return {
    presetId: cleanText(line.presetId || line.serviceType, 120),
    serviceId: cleanText(line.serviceId, 120),
    quantity: Number(line.quantity || 0),
    manualDurationMinutes: Number(line.manualDurationMinutes || 0),
  };
}

function workLinesSignature(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return "";
  return JSON.stringify(lines
    .map(normalizedWorkLine)
    .filter((line) => line.presetId && Number.isInteger(line.quantity) && line.quantity > 0)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function rescheduleScopeDecision(appointment = {}, offer = {}) {
  const request = offer?.request && typeof offer.request === "object" ? offer.request : {};
  if (
    cleanText(appointment.customerId, 160) !== cleanText(request.customerId, 160)
    || cleanText(appointment.propertyId, 160) !== cleanText(request.propertyId, 160)
  ) {
    return denied("reschedule-customer-property-changed");
  }
  const currentWork = workLinesSignature(appointment.workLines);
  const offeredWork = workLinesSignature(request.workLines);
  if (!currentWork || !offeredWork || currentWork !== offeredWork) {
    return denied("reschedule-workload-changed");
  }
  return { allowed: true, reason: "reschedule-scope-preserved" };
}

async function loadCurrentAppointmentWorkflowContext({ db, context = {} } = {}) {
  const identity = mutationContextIdentity(context);
  if (!identity.conversationId || !identity.inboundMessageId) {
    return { success: false, error: { code: "appointment_workflow_context_missing", reason: "missing-turn-identity" } };
  }
  const conversationSnapshot = await db.collection("communicationConversations").doc(identity.conversationId).get();
  if (!conversationSnapshot.exists) {
    return { success: false, error: { code: "appointment_workflow_context_missing", reason: "conversation-missing" } };
  }
  const workflowContext = appointmentWorkflowContextFromConversation(conversationSnapshot.data() || {}, identity.inboundMessageId);
  if (!workflowContext.valid) {
    return { success: false, error: { code: "appointment_workflow_context_missing", reason: workflowContext.reason } };
  }
  const appointmentSnapshot = await db.collection("appointments").doc(workflowContext.appointmentId).get();
  if (!appointmentSnapshot.exists) {
    return { success: false, error: { code: "appointment_workflow_context_missing", reason: "appointment-missing" } };
  }
  const appointment = { id: appointmentSnapshot.id, ...appointmentSnapshot.data() };
  return {
    success: true,
    workflow: workflowContext.workflow,
    caseId: workflowContext.caseId,
    appointmentId: workflowContext.appointmentId,
    appointment,
  };
}

function mutationReceiptIdentity(action, args = {}, context = {}) {
  const normalizedAction = cleanText(action, 80).toLowerCase();
  const identity = mutationContextIdentity(context);
  const appointmentId = cleanText(args.appointmentId, 180);
  const offerId = cleanText(args.offerId, 180);
  const offerVersion = Number.isSafeInteger(Number(args.offerVersion)) ? Number(args.offerVersion) : 0;
  const optionId = cleanText(args.optionId, 180);
  const material = {
    action: normalizedAction,
    conversationId: identity.conversationId,
    inboundMessageId: identity.inboundMessageId,
    appointmentId,
    offerId,
    offerVersion,
    optionId,
  };
  return {
    id: `MAM-${hashKey(`${identity.conversationId}|${identity.inboundMessageId}|${normalizedAction}`, 40).toUpperCase()}`,
    requestFingerprint: hashKey(JSON.stringify(material), 40),
    ...material,
    reason: cleanText(args.reason, 500),
    note: cleanText(args.note, 1_500),
  };
}

function mutationReplayDecision({ receipt = {}, expected = {}, appointment = {} } = {}) {
  if (!receipt || cleanText(receipt.status, 40) !== "committed") return { allowed: false, reason: "mutation-receipt-not-committed" };
  if (cleanText(receipt.requestFingerprint, 80) !== cleanText(expected.requestFingerprint, 80)) {
    return { allowed: false, reason: "mutation-idempotency-conflict" };
  }
  const appointmentId = cleanText(appointment.appointmentId || appointment.id, 180);
  if (!appointmentId || appointmentId !== cleanText(expected.appointmentId, 180)) {
    return { allowed: false, reason: "mutation-replay-appointment-changed" };
  }
  if (expected.action === "cancel_appointment") {
    const status = cleanText(appointment.status, 40).toLowerCase();
    if (!["cancelled", "canceled", "cancelada"].includes(status)) {
      return { allowed: false, reason: "mutation-replay-state-changed" };
    }
    return { allowed: true, replayed: true, action: expected.action };
  }
  if (expected.action === "reschedule_appointment") {
    if (
      cleanText(appointment.offerId, 180) !== expected.offerId
      || Number(appointment.offerVersion || 0) !== expected.offerVersion
      || cleanText(appointment.selectedOptionId, 180) !== expected.optionId
      || cleanText(appointment.lastScheduleChangeKind, 80) !== "customer_reschedule"
    ) {
      return { allowed: false, reason: "mutation-replay-state-changed" };
    }
    return { allowed: true, replayed: true, action: expected.action };
  }
  return { allowed: false, reason: "mutation-replay-action-invalid" };
}

async function loadMutationEpochReceipt({ db, transaction, conversationId, inboundMessageId } = {}) {
  const query = db.collection(CUSTOMER_AGENT_QUEUE_COLLECTION)
    .where("conversationId", "==", conversationId)
    .where("messageId", "==", inboundMessageId)
    .limit(2);
  const snapshot = await transaction.get(query);
  const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
  if (docs.length !== 1) {
    return {
      valid: false,
      reason: docs.length > 1 ? "ambiguous-customer-agent-queue-receipt" : "customer-agent-queue-receipt-missing",
    };
  }
  const receipt = docs[0].data() || {};
  const communicationAccountId = cleanText(receipt.communicationAccountId, 180).toLowerCase();
  const expectedOwnershipVersion = nonNegativeEpoch(receipt.expectedOwnershipVersion);
  const expectedCustomerInputVersion = positiveEpoch(receipt.expectedCustomerInputVersion || receipt.customerInputVersion);
  if (!communicationAccountId) return { valid: false, reason: "queue-receipt-missing-communication-account" };
  if (expectedOwnershipVersion === null) return { valid: false, reason: "queue-receipt-missing-ownership-version" };
  if (expectedCustomerInputVersion === null) return { valid: false, reason: "queue-receipt-missing-customer-input-version" };
  return {
    valid: true,
    communicationAccountId,
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
  };
}

async function mayaAppointmentMutationDecisionInTransaction({
  db,
  transaction,
  action,
  context = {},
} = {}) {
  const normalizedAction = cleanText(action, 80).toLowerCase();
  if (!MAYA_APPOINTMENT_MUTATION_ACTIONS.has(normalizedAction)) {
    return denied("business-action-not-authorized");
  }
  if (!db || typeof db.collection !== "function" || !transaction || typeof transaction.get !== "function") {
    return denied("transactional-authorization-required");
  }

  const identity = mutationContextIdentity(context);
  if (!identity.conversationId) return denied("missing-conversation-identity");
  if (!identity.inboundMessageId) return denied("missing-inbound-message-identity");

  const epochReceipt = await loadMutationEpochReceipt({
    db,
    transaction,
    conversationId: identity.conversationId,
    inboundMessageId: identity.inboundMessageId,
  });
  if (!epochReceipt.valid) return denied(epochReceipt.reason);

  const conversationRef = db.collection("communicationConversations").doc(identity.conversationId);
  const mayaSettingsRef = db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT);
  const communicationSettingsRef = db.collection(COMMUNICATION_SETTINGS_COLLECTION).doc(COMMUNICATION_SETTINGS_DOCUMENT);
  const [conversationSnapshot, mayaSettingsSnapshot, communicationSettingsSnapshot] = await Promise.all([
    transaction.get(conversationRef),
    transaction.get(mayaSettingsRef),
    transaction.get(communicationSettingsRef),
  ]);

  if (!conversationSnapshot.exists) return denied("conversation-missing");
  const conversation = conversationSnapshot.data() || {};
  const currentAccount = cleanText(conversation.communicationAccountId, 180).toLowerCase();
  if (!currentAccount || currentAccount !== epochReceipt.communicationAccountId) {
    return denied("communication-account-changed");
  }

  const workflowContext = appointmentWorkflowContextFromConversation(conversation, identity.inboundMessageId);
  if (!workflowContext.valid) return denied(workflowContext.reason);
  const expectedWorkflow = ACTION_WORKFLOW[normalizedAction] || "";
  if (workflowContext.workflow !== expectedWorkflow) return denied("appointment-workflow-action-mismatch");
  const requestedAppointmentId = cleanText(context.requestedAppointmentId, 180);
  if (!requestedAppointmentId) return denied("requested-appointment-id-missing");
  if (requestedAppointmentId !== workflowContext.appointmentId) {
    return denied("appointment-workflow-context-mismatch");
  }

  const accountDecision = activeAccountDecision({
    conversation,
    settings: communicationSettingsSnapshot.exists ? communicationSettingsSnapshot.data() || {} : {},
  });
  if (!accountDecision.allowed) return denied(accountDecision.reason);

  const ownershipDecision = mayaSenderOwnershipDecision({ conversation });
  if (!ownershipDecision.allowed) return denied(ownershipDecision.reason);

  const epochDecision = communicationEpochDecision({
    conversation,
    expectedOwnershipVersion: epochReceipt.expectedOwnershipVersion,
    expectedCustomerInputVersion: epochReceipt.expectedCustomerInputVersion,
  });
  if (!epochDecision.allowed) return denied(epochDecision.reason);

  const actionDecision = mayaBusinessActionDecision({
    action: normalizedAction,
    settings: mayaSettingsSnapshot.exists ? mayaSettingsSnapshot.data() || {} : {},
    ownershipAllowed: true,
  });
  if (!actionDecision.allowed) return denied(actionDecision.reason);

  if (normalizedAction === "reschedule_appointment") {
    const requestedOfferId = cleanText(context.requestedOfferId, 180);
    if (!requestedOfferId) return denied("requested-reschedule-offer-missing");
    const [appointmentSnapshot, offerSnapshot] = await Promise.all([
      transaction.get(db.collection("appointments").doc(requestedAppointmentId)),
      transaction.get(db.collection("bookingOffers").doc(requestedOfferId)),
    ]);
    if (!appointmentSnapshot.exists) return denied("requested-appointment-missing");
    if (!offerSnapshot.exists) return denied("requested-reschedule-offer-missing");
    const scopeDecision = rescheduleScopeDecision(
      { id: appointmentSnapshot.id, ...appointmentSnapshot.data() },
      { id: offerSnapshot.id, ...offerSnapshot.data() },
    );
    if (!scopeDecision.allowed) return scopeDecision;
  }

  return {
    allowed: true,
    reason: actionDecision.reason,
    communicationAccountId: epochReceipt.communicationAccountId,
    ownershipVersion: epochDecision.ownershipVersion,
    customerInputVersion: epochDecision.customerInputVersion,
    workflow: workflowContext.workflow,
    appointmentId: workflowContext.appointmentId,
    caseId: workflowContext.caseId,
  };
}

function mutationAuthorizationError(action, decision = {}) {
  return new BookingAuthorityError(
    BOOKING_ERROR_CODES.INVALID_REQUEST,
    "Maya is not authorized to commit this appointment change.",
    {
      action: cleanText(action, 80),
      authorizationReason: cleanText(decision.reason, 160) || "maya-mutation-not-authorized",
    },
  );
}

function createMayaGuardedBookingDb({ db, action, context = {}, mutationReceipt = null } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible transactional db is required.");
  }
  const normalizedAction = cleanText(action, 80).toLowerCase();
  return {
    collection: db.collection.bind(db),
    runTransaction: (callback) => db.runTransaction(async (transaction) => {
      const decision = await mayaAppointmentMutationDecisionInTransaction({
        db,
        transaction,
        action: normalizedAction,
        context,
      });
      if (!decision.allowed) throw mutationAuthorizationError(normalizedAction, decision);

      let receiptRef = null;
      if (mutationReceipt?.id && mutationReceipt?.requestFingerprint) {
        receiptRef = db.collection(MAYA_MUTATION_RECEIPT_COLLECTION).doc(mutationReceipt.id);
        const existingReceipt = await transaction.get(receiptRef);
        if (existingReceipt.exists) {
          const stored = existingReceipt.data() || {};
          if (cleanText(stored.requestFingerprint, 80) !== cleanText(mutationReceipt.requestFingerprint, 80)) {
            throw new BookingAuthorityError(
              BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              "The same Maya customer turn cannot be reused for a different appointment mutation.",
              { receiptId: mutationReceipt.id, mayaMutationReplay: false },
            );
          }
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This Maya appointment mutation was already committed.",
            { receiptId: mutationReceipt.id, mayaMutationReplay: true },
          );
        }
      }

      const result = await callback(transaction);
      if (receiptRef) {
        transaction.set(receiptRef, {
          ...mutationReceipt,
          status: "committed",
          communicationAccountId: decision.communicationAccountId,
          workflow: decision.workflow,
          caseId: decision.caseId,
          committedAtIso: new Date().toISOString(),
        });
      }
      return result;
    }),
  };
}

module.exports = {
  ACTION_WORKFLOW,
  CUSTOMER_AGENT_QUEUE_COLLECTION,
  MAYA_APPOINTMENT_MUTATION_ACTIONS,
  MAYA_APPOINTMENT_WORKFLOWS,
  MAYA_APPOINTMENT_WORKFLOW_STATES,
  MAYA_MUTATION_RECEIPT_COLLECTION,
  appointmentWorkflowContextFromConversation,
  createMayaGuardedBookingDb,
  loadCurrentAppointmentWorkflowContext,
  loadMutationEpochReceipt,
  mayaAppointmentMutationDecisionInTransaction,
  mutationAuthorizationError,
  mutationContextIdentity,
  mutationReceiptIdentity,
  mutationReplayDecision,
  normalizedWorkLine,
  rescheduleScopeDecision,
  workLinesSignature,
};
