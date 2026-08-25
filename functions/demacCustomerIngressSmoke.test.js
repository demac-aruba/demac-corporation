const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) {
  initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });
}

const { conversationIngressState } = require("./whatsappWacliGateway");
const { wacliCanonicalIdentity } = require("./wacliCommunicationBoundary");
const {
  buildRuntimeBody,
  outcomeConversationPatch,
} = require("./demacCustomerAgentCommunication");
const {
  FINAL_TOOL_NAME,
  createCustomerAgentRuntime,
} = require("./demacCustomerAgentRuntimeV1");

class FakeDb {
  collection() { return {}; }
}

function finalCall(args, callId = "call-final") {
  return {
    type: "function_call",
    name: FINAL_TOOL_NAME,
    call_id: callId,
    arguments: JSON.stringify(args),
  };
}

function createSmokeRuntime(finalArgs, recordedOutcomes) {
  return createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: {
      definitions: [],
      invoke: async () => { throw new Error("Smoke scenario should not invoke business tools."); },
    },
    modelClient: async () => ({ output: [finalCall(finalArgs)] }),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async (payload) => { recordedOutcomes.push(payload); },
    primaryModel: "smoke-model",
    fallbackModel: "",
  });
}

function inboundFixture({
  text,
  messageId = "wamid-smoke-1",
  chat = "2975600000@s.whatsapp.net",
  communicationAccountId = "demac-wa-primary",
}) {
  const ingress = conversationIngressState({ current: {}, exists: false, inbound: true });
  const identity = wacliCanonicalIdentity({ communicationAccountId, chat, providerMessageId: messageId });
  assert.ok(identity.conversationId, "smoke fixture requires canonical account-scoped conversation identity");
  assert.ok(identity.messageId, "smoke fixture requires canonical account-scoped message identity");
  const conversation = {
    conversationId: identity.conversationId,
    communicationAccountId,
    remoteConversationId: identity.remoteConversationId,
    provider: "wacli",
    phone: "2975600000",
    chatJid: chat,
    externalChatId: chat,
    customer: "Smoke Test Customer",
    queue: ingress.queue,
    status: ingress.status,
    aiDisposition: ingress.aiDisposition,
    owner: ingress.owner,
    ownerUserId: ingress.ownerUserId,
    ownershipVersion: 0,
    customerInputVersion: 1,
    recentMessages: [],
  };
  const inboundMessage = {
    id: identity.messageId,
    messageId: identity.messageId,
    providerMessageId: messageId,
    conversationId: identity.conversationId,
    communicationAccountId,
    remoteConversationId: identity.remoteConversationId,
    provider: "wacli",
    direction: "inbound",
    chat,
    phone: "2975600000",
    chatName: "Smoke Test Customer",
    customerInputVersion: 1,
    text,
  };
  return {
    ingress,
    identity,
    rawBody: buildRuntimeBody({
      conversationId: identity.conversationId,
      conversation,
      inboundMessage,
      provider: "wacli",
    }),
  };
}

test("smoke: routine inbound stays AI-owned from canonical wacli ingress through customer reply", async () => {
  const { ingress, identity, rawBody } = inboundFixture({ text: "Buenas, necesito información sobre servicio." });
  assert.equal(ingress.queue, "general");
  assert.equal(ingress.aiDisposition, "ai_active");
  assert.equal(ingress.ownerUserId, null);
  assert.equal(rawBody.conversationId, identity.conversationId);
  assert.equal(rawBody.communicationAccountId, "demac-wa-primary");
  assert.equal(rawBody.expectedOwnershipVersion, 0);
  assert.equal(rawBody.customerInputVersion, 1);
  assert.equal(rawBody.inboundMessageId, identity.messageId);

  const recorded = [];
  const runtime = createSmokeRuntime({
    message: "Claro. ¿Cuántos aires necesita atender?",
    outcome: "reply",
    language: "es",
    requiresHuman: false,
    appointmentId: "",
    handoffQueue: "",
    handoffReason: "",
  }, recorded);

  const result = await runtime.runTurn({ rawBody, apiKey: "smoke" });
  const patch = outcomeConversationPatch(result);

  assert.equal(result.metadata.outcome, "reply");
  assert.equal(result.metadata.requiresHuman, false);
  assert.equal(patch.aiDisposition, "ai_active");
  assert.equal(patch.status, "waiting_customer");
  assert.equal(Object.hasOwn(patch, "queue"), false, "routine replies must not overwrite the current semantic queue");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, "reply");
});

test("smoke: payment dispute enters general but Customer Agent requests finance handoff without fabricating human ownership", async () => {
  const { ingress, rawBody } = inboundFixture({
    text: "No reconozco este pago en mi factura y quiero que una persona lo revise.",
    messageId: "wamid-smoke-finance",
  });

  assert.equal(ingress.queue, "general", "transport must not classify payment language");
  assert.equal(ingress.aiDisposition, "ai_active");

  const recorded = [];
  const runtime = createSmokeRuntime({
    message: "Entiendo. Voy a pasar esta conversación a un miembro de nuestro equipo para revisar el pago.",
    outcome: "handoff",
    language: "es",
    requiresHuman: true,
    appointmentId: "",
    handoffQueue: "finance",
    handoffReason: "Customer disputes a payment shown on the invoice and requested human review.",
  }, recorded);

  const result = await runtime.runTurn({ rawBody, apiKey: "smoke" });
  const patch = outcomeConversationPatch(result);

  assert.equal(result.metadata.outcome, "handoff");
  assert.equal(result.metadata.handoffQueue, "finance");
  assert.equal(patch.aiDisposition, "handoff_pending");
  assert.equal(patch.status, "escalated");
  assert.equal(patch.queue, "finance");
  assert.equal(patch.routeReason, "Customer disputes a payment shown on the invoice and requested human review.");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].handoffQueue, "finance");
  assert.equal(recorded[0].requiresHuman, true);
});
