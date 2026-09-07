const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  hashKey,
} = require("./bookingAuthorityCore");
const { FieldValue } = require("firebase-admin/firestore");
const { BOOKING_COLLECTIONS } = require("./bookingAuthorityFirestore");
const { cleanText } = require("./bookingSchedulingPrimitives");
const { DISPATCH_HOLD_CONFIDENCE } = require("./demacCommunicationCaseService");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
  activeAccountDecision,
} = require("./demacCommunicationIdentity");
const { communicationEpochDecision, positiveEpoch, nonNegativeEpoch } = require("./demacCustomerTurn");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  configuredAllowlist,
  mayaBusinessActionDecision,
  mayaReplyDecision,
  mayaSenderOwnershipDecision,
  resolveConversationPhone,
} = require("./demacCustomerAgentReplyPolicy");

const MAYA_APPOINTMENT_MUTATION_ACTIONS = new Set([
  "cancel_appointment",
  "reschedule_appointment",
]);
const MAYA_APPOINTMENT_WORKFLOWS = new Set(["cancellation", "reschedule"]);
const MAYA_APPOINTMENT_WORKFLOW_STATES = new Set(["APPOINTMENT_MATCHED"]);
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

// P0 uses this pending state after protecting dispatch, including when the
// customer has already explicitly requested cancellation. It is not itself
// permission to mutate. The canonical Case and appointment are checked below.
function heldCancellationContextReady(workflow, caseState, insight = {}) {
  return workflow === "cancellation"
    && caseState === "AWAITING_CUSTOMER_DECISION"
    && insight.dispatchHoldActive === true
    && Number.isFinite(insight.confidence)
    && insight.confidence >= DISPATCH_HOLD_CONFIDENCE;
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
  if (!appointmentId || !caseId || (!MAYA_APPOINTMENT_WORKFLOW_STATES.has(caseState)
    && !heldCancellationContextReady(workflow, caseState, insight))) {
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

function currentAppointmentCaseDecision({ caseRecord = {}, appointment = {}, workflowContext = {}, identity = {}, communicationAccountId = "" } = {}) {
  if (
    cleanText(caseRecord.communicationAccountId, 180).toLowerCase() !== communicationAccountId
    || cleanText(caseRecord.conversationId, 300) !== identity.conversationId
    || cleanText(caseRecord.lastSourceMessageId, 300) !== identity.inboundMessageId
    || cleanText(caseRecord.appointmentId, 180) !== workflowContext.appointmentId
    || cleanText(caseRecord.intent, 80) !== workflowContext.workflow
    || cleanText(caseRecord.state, 80) !== workflowContext.caseState
    || cleanText(caseRecord.caseType, 80) !== "appointment_change"
  ) return denied("canonical-appointment-case-mismatch");
  const customerId = cleanText(caseRecord.customerId, 160);
  if (!customerId || cleanText(appointment.customerId, 160) !== customerId) {
    return denied("appointment-case-customer-mismatch");
  }
  if (cleanText(caseRecord.attentionReason, 180)) return denied("canonical-case-requires-human-attention");
  if (!Number.isFinite(caseRecord.confidence) || caseRecord.confidence < DISPATCH_HOLD_CONFIDENCE) {
    return denied("appointment-case-confidence-insufficient");
  }
  if (!["confirmed", "scheduled"].includes(cleanText(appointment.status, 40).toLowerCase())) {
    return denied("appointment-not-open-for-customer-change");
  }
  const hold = appointment.dispatchHold || {};
  if (hold.active === true && cleanText(hold.caseId, 180) !== workflowContext.caseId) {
    return denied("appointment-held-by-another-case");
  }
  if (workflowContext.caseState === "AWAITING_CUSTOMER_DECISION"
    && (!heldCancellationContextReady(workflowContext.workflow, caseRecord.state, caseRecord)
      || hold.active !== true)) {
    return denied("held-cancellation-evidence-incomplete");
  }
  return { allowed: true, reason: "canonical-appointment-case-current" };
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
  const conversation = conversationSnapshot.data() || {};
  const workflowContext = appointmentWorkflowContextFromConversation(conversation, identity.inboundMessageId);
  if (!workflowContext.valid) {
    return { success: false, error: { code: "appointment_workflow_context_missing", reason: workflowContext.reason } };
  }
  const [appointmentSnapshot, caseSnapshot] = await Promise.all([
    db.collection("appointments").doc(workflowContext.appointmentId).get(),
    db.collection("communicationCases").doc(workflowContext.caseId).get(),
  ]);
  if (!appointmentSnapshot.exists || !caseSnapshot.exists) {
    return { success: false, error: { code: "appointment_workflow_context_missing", reason: "appointment-or-case-missing" } };
  }
  const appointment = { ...appointmentSnapshot.data(), id: appointmentSnapshot.id };
  const decision = currentAppointmentCaseDecision({
    caseRecord: caseSnapshot.data() || {},
    appointment,
    workflowContext,
    identity,
    communicationAccountId: cleanText(conversation.communicationAccountId, 180).toLowerCase(),
  });
  if (!decision.allowed) return { success: false, error: { code: "appointment_workflow_context_missing", reason: decision.reason } };
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

  const communicationSettings = communicationSettingsSnapshot.exists ? communicationSettingsSnapshot.data() || {} : {};
  const accountDecision = activeAccountDecision({ conversation, settings: communicationSettings });
  if (!accountDecision.allowed) return denied(accountDecision.reason);

  const ownershipDecision = mayaSenderOwnershipDecision({ conversation });
  if (!ownershipDecision.allowed) return denied(ownershipDecision.reason);

  const epochDecision = communicationEpochDecision({
    conversation,
    expectedOwnershipVersion: epochReceipt.expectedOwnershipVersion,
    expectedCustomerInputVersion: epochReceipt.expectedCustomerInputVersion,
  });
  if (!epochDecision.allowed) return denied(epochDecision.reason);

  const settings = mayaSettingsSnapshot.exists ? mayaSettingsSnapshot.data() || {} : {};
  const actionDecision = mayaBusinessActionDecision({ action: normalizedAction, settings, ownershipAllowed: true });
  if (!actionDecision.allowed) return denied(actionDecision.reason);

  // Re-read pilot permission inside the scheduling transaction, not only at
  // inbound/final-send time. Pilot exceptions must not bypass the selected list.
  const replyDecision = mayaReplyDecision({ conversation, settings, communicationSettings, authorizedWorkflow: workflowContext.workflow });
  if (!replyDecision.allowed) return denied(replyDecision.reason);
  const phone = resolveConversationPhone({ conversation });
  if (!configuredAllowlist(settings).includes(phone)) return denied("mutation-phone-not-allowlisted");

  const [appointmentSnapshot, caseSnapshot] = await Promise.all([
    transaction.get(db.collection("appointments").doc(requestedAppointmentId)),
    transaction.get(db.collection("communicationCases").doc(workflowContext.caseId)),
  ]);
  if (!appointmentSnapshot.exists) return denied("requested-appointment-missing");
  if (!caseSnapshot.exists) return denied("canonical-appointment-case-missing");
  const appointment = { ...appointmentSnapshot.data(), id: appointmentSnapshot.id };
  const caseDecision = currentAppointmentCaseDecision({
    caseRecord: caseSnapshot.data() || {},
    appointment,
    workflowContext,
    identity,
    communicationAccountId: currentAccount,
  });
  if (!caseDecision.allowed) return caseDecision;

  if (normalizedAction === "reschedule_appointment") {
    const requestedOfferId = cleanText(context.requestedOfferId, 180);
    if (!requestedOfferId) return denied("requested-reschedule-offer-missing");
    const offerSnapshot = await transaction.get(db.collection("bookingOffers").doc(requestedOfferId));
    if (!offerSnapshot.exists) return denied("requested-reschedule-offer-missing");
    const scopeDecision = rescheduleScopeDecision(appointment, { id: offerSnapshot.id, ...offerSnapshot.data() });
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

function canonicalReferenceIds(values) {
  if (!Array.isArray(values) || !values.length || values.some((id) => (
    typeof id !== "string" || !id || id !== cleanText(id, 180) || id.includes("/")
  ))) return null;
  return [...new Set(values)];
}

async function cancellationLinksDecisionInTransaction({ db, transaction, appointmentId }) {
  const snapshot = await transaction.get(db.collection(BOOKING_COLLECTIONS.appointments).doc(appointmentId));
  if (!snapshot.exists) return denied("requested-appointment-missing");
  const appointment = snapshot.data() || {};
  const workOrderIds = canonicalReferenceIds(appointment.workOrderIds);
  const lockIds = canonicalReferenceIds(appointment.capacityLockIds);
  if (!workOrderIds || !lockIds) return denied("cancellation-links-incomplete");
  const [orders, locks] = await Promise.all([
    Promise.all(workOrderIds.map((id) => transaction.get(db.collection(BOOKING_COLLECTIONS.workOrders).doc(id)))),
    Promise.all(lockIds.map((id) => transaction.get(db.collection(BOOKING_COLLECTIONS.capacityLocks).doc(id)))),
  ]);
  for (const orderSnapshot of orders) {
    if (!orderSnapshot.exists) return denied("cancellation-work-order-missing");
    const order = orderSnapshot.data() || {};
    if (cleanText(order.appointmentId, 180) !== appointmentId
      || cleanText(order.clientId, 160) !== cleanText(appointment.customerId, 160)
      || cleanText(order.propertyId, 160) !== cleanText(appointment.propertyId, 160)) {
      return denied("cancellation-work-order-link-mismatch");
    }
    // Booking Authority initializes future work as Confirmada. Unknown, started,
    // completed or externally changed work requires office review, not guessing.
    if (cleanText(order.status, 80).toLowerCase() !== "confirmada") {
      return denied("cancellation-work-order-not-confirmed");
    }
  }
  for (const lockSnapshot of locks) {
    const lock = lockSnapshot.exists ? lockSnapshot.data() || {} : {};
    if (!lockSnapshot.exists || lock.active !== true
      || cleanText(lock.appointmentId, 180) !== appointmentId
      || cleanText(lock.date, 20) !== cleanText(appointment.date, 20)) {
      return denied("cancellation-capacity-link-mismatch");
    }
  }
  return { allowed: true, reason: "cancellation-links-current" };
}

function createMayaGuardedBookingDb({ db, action, context = {}, mutationReceipt = null } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible transactional db is required.");
  }
  const normalizedAction = cleanText(action, 80).toLowerCase();
  const identity = mutationContextIdentity(context);
  const expectedReceipt = mutationReceiptIdentity(normalizedAction, mutationReceipt || {}, context);
  if (!mutationReceipt?.id || !mutationReceipt?.requestFingerprint
    || mutationReceipt.id !== expectedReceipt.id
    || mutationReceipt.requestFingerprint !== expectedReceipt.requestFingerprint
    || mutationReceipt.action !== normalizedAction
    || mutationReceipt.conversationId !== identity.conversationId
    || mutationReceipt.inboundMessageId !== identity.inboundMessageId
    || mutationReceipt.appointmentId !== cleanText(context.requestedAppointmentId, 180)
    || (normalizedAction === "reschedule_appointment" && mutationReceipt.offerId !== cleanText(context.requestedOfferId, 180))) {
    throw mutationAuthorizationError(normalizedAction, { reason: "canonical-mutation-receipt-required" });
  }
  return {
    collection: db.collection.bind(db),
    runTransaction: (callback) => db.runTransaction(async (transaction) => {
      // Read a completed execution receipt before mutable workflow state: a
      // concurrent retry may arrive after the first commit resolved the Case.
      const receiptRef = db.collection(MAYA_MUTATION_RECEIPT_COLLECTION).doc(mutationReceipt.id);
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
      const decision = await mayaAppointmentMutationDecisionInTransaction({ db, transaction, action: normalizedAction, context });
      if (!decision.allowed) throw mutationAuthorizationError(normalizedAction, decision);
      if (normalizedAction === "cancel_appointment") {
        const links = await cancellationLinksDecisionInTransaction({ db, transaction, appointmentId: decision.appointmentId });
        if (!links.allowed) throw mutationAuthorizationError(normalizedAction, links);
      }

      const result = await callback(transaction);
      const proof = mutationReplayDecision({
        receipt: { ...mutationReceipt, status: "committed" },
        expected: mutationReceipt,
        appointment: result?.appointment || {},
      });
      if (result?.success !== true || !proof.allowed) {
        throw mutationAuthorizationError(normalizedAction, { reason: "canonical-lifecycle-proof-missing" });
      }
      const nowIso = new Date().toISOString();
      transaction.set(receiptRef, {
        ...mutationReceipt,
        status: "committed",
        communicationAccountId: decision.communicationAccountId,
        workflow: decision.workflow,
        caseId: decision.caseId,
        committedAtIso: nowIso,
      });
      transaction.set(db.collection("communicationCases").doc(decision.caseId), {
        state: normalizedAction === "cancel_appointment" ? "RESOLVED_CANCELLED" : "RESOLVED_RESCHEDULED",
        dispatchHoldActive: false,
        attentionRequired: false,
        attentionReason: null,
        resolution: {
          action: normalizedAction,
          appointmentId: decision.appointmentId,
          sourceMessageId: mutationContextIdentity(context).inboundMessageId,
          mutationReceiptId: mutationReceipt.id,
        },
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedAtIso: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: nowIso,
      }, { merge: true });
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
  cancellationLinksDecisionInTransaction,
  createMayaGuardedBookingDb,
  currentAppointmentCaseDecision,
  heldCancellationContextReady,
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
