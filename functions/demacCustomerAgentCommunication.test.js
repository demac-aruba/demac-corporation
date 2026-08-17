const test = require("node:test");
const assert = require("node:assert/strict");

const {
  automaticReplySupported,
  buildRuntimeBody,
  communicationMessageToRuntime,
  conversationIdentity,
  outboundDocumentId,
  outcomeConversationPatch,
  queueDocumentId,
  shouldRunAgent,
  whatsappMessageToRuntime,
} = require("./demacCustomerAgentCommunication");

test("automatic replies are explicitly enabled only for the current wacli sender", () => {
  assert.equal(automaticReplySupported("wacli"), true);
  assert.equal(automaticReplySupported("WACLI"), true);
  assert.equal(automaticReplySupported("meta"), false);
  assert.equal(automaticReplySupported(""), false);
});

test("agent runs only for explicitly AI-owned unclaimed conversations", () => {
  assert.equal(shouldRunAgent({ aiDisposition: "ai_active" }), true);
  assert.equal(shouldRunAgent({ aiDisposition: "human_active" }), false);
  assert.equal(shouldRunAgent({ aiDisposition: "ai_active", ownerUserId: "operator-1" }), false);
  assert.equal(shouldRunAgent({ aiDisposition: "ai_active", lockedByUserId: "operator-1" }), false);
  assert.equal(shouldRunAgent({}), false);
});

test("conversation identity prefers stable WhatsApp chat/JID", () => {
  assert.equal(conversationIdentity({ chat: "2975600000@s.whatsapp.net", phone: "2975600000" }), "2975600000@s.whatsapp.net");
  assert.equal(conversationIdentity({ conversationId: "conv-1", phone: "2975600000" }), "conv-1");
  assert.equal(conversationIdentity({ phone: "2975600000" }), "2975600000");
});

test("queue and outbound IDs are deterministic and distinct", () => {
  const queue1 = queueDocumentId("conv-1", "msg-1");
  const queue2 = queueDocumentId("conv-1", "msg-1");
  const outbound1 = outboundDocumentId("conv-1", "msg-1");
  const outbound2 = outboundDocumentId("conv-1", "msg-1");
  assert.equal(queue1, queue2);
  assert.equal(outbound1, outbound2);
  assert.notEqual(queue1, outbound1);
  assert.match(queue1, /^CAQ-[A-F0-9]{40}$/);
  assert.match(outbound1, /^AI-[A-F0-9]{40}$/);
});

test("communication messages map to native runtime directions", () => {
  assert.deepEqual(communicationMessageToRuntime({ id: "m1", role: "customer", text: "Hola" }), {
    id: "m1", direction: "inbound", text: "Hola",
  });
  assert.deepEqual(communicationMessageToRuntime({ id: "m2", role: "operator", text: "Buenas" }), {
    id: "m2", direction: "outbound", text: "Buenas",
  });
  assert.deepEqual(communicationMessageToRuntime({ id: "m3", role: "ai", text: "Claro" }), {
    id: "m3", direction: "outbound", text: "Claro",
  });
  assert.equal(communicationMessageToRuntime({ id: "m4", role: "internal_note", text: "private" }), null);
});

test("raw WhatsApp message mapping preserves provider message id", () => {
  assert.deepEqual(whatsappMessageToRuntime({ messageId: "wamid-1", direction: "inbound", text: "Necesito servicio" }), {
    id: "wamid-1", direction: "inbound", text: "Necesito servicio",
  });
});

test("runtime body appends current inbound when conversation write is racing", () => {
  const body = buildRuntimeBody({
    conversationId: "2975600000@s.whatsapp.net",
    provider: "wacli",
    conversation: {
      phone: "2975600000",
      chatJid: "2975600000@s.whatsapp.net",
      customer: "Richard",
      recentMessages: [
        { id: "m0", role: "operator", text: "Buenas tardes" },
      ],
    },
    inboundMessage: {
      messageId: "m1",
      direction: "inbound",
      text: "Necesito servicio para dos aires",
    },
  });
  assert.equal(body.conversationId, "2975600000@s.whatsapp.net");
  assert.equal(body.inboundMessageId, "m1");
  assert.deepEqual(body.conversation.messages, [
    { id: "m0", direction: "outbound", text: "Buenas tardes" },
    { id: "m1", direction: "inbound", text: "Necesito servicio para dos aires" },
  ]);
  assert.equal(body.conversation.customerTurn.text, "Necesito servicio para dos aires");
});

test("normal agent result returns conversation to waiting_customer under AI ownership", () => {
  const patch = outcomeConversationPatch({
    metadata: { outcome: "reply", requiresHuman: false, appointmentId: "" },
  });
  assert.equal(patch.aiDisposition, "ai_active");
  assert.equal(patch.status, "waiting_customer");
  assert.equal(patch.agentLastOutcome, "reply");
});

test("handoff result transfers conversation to human exception ownership", () => {
  const patch = outcomeConversationPatch({
    metadata: { outcome: "handoff", requiresHuman: true, appointmentId: "APT-1" },
  });
  assert.equal(patch.aiDisposition, "human_active");
  assert.equal(patch.status, "escalated");
  assert.equal(patch.queue, "manager");
  assert.equal(patch.agentLastAppointmentId, "APT-1");
});
