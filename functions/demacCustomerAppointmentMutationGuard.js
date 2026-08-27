const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
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
const CUSTOMER_AGENT_QUEUE_COLLECTION = "customerAgentInboundQueue";

function mutationContextIdentity(context = {}) {
  return {
    conversationId: cleanText(context.conversationId || context.conversationKey, 300),
    inboundMessageId: cleanText(context.inboundMessageId || context.messageId, 300),
  };
}

function denied(reason, details = {}) {
  return { allowed: false, reason: cleanText(reason, 160) || "maya-mutation-not-authorized", ...details };
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

  return {
    allowed: true,
    reason: actionDecision.reason,
    communicationAccountId: epochReceipt.communicationAccountId,
    ownershipVersion: epochDecision.ownershipVersion,
    customerInputVersion: epochDecision.customerInputVersion,
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

function createMayaGuardedBookingDb({ db, action, context = {} } = {}) {
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
      return callback(transaction);
    }),
  };
}

module.exports = {
  CUSTOMER_AGENT_QUEUE_COLLECTION,
  MAYA_APPOINTMENT_MUTATION_ACTIONS,
  createMayaGuardedBookingDb,
  loadMutationEpochReceipt,
  mayaAppointmentMutationDecisionInTransaction,
  mutationAuthorizationError,
  mutationContextIdentity,
};
