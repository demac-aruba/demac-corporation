const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRuntimeBody } = require("./demacCustomerAgentCommunication");
const {
  FINAL_RESPONSE_TOOL,
  FINAL_TOOL_NAME,
  createCustomerAgentRuntime,
  runtimeInstructions,
} = require("./demacCustomerAgentRuntimeV1");
const { mayaReplyDecision } = require("./demacCustomerAgentReplyPolicy");
const { canonicalVoiceRuntimeMessage } = require("./demacCustomerTurn");
const { OBSERVATION_TOOL, observationFromResponse, observerInstructions } = require("./demacCustomerObserver");

const ACCOUNT_ID = "demac-wa-corporate";
const CONVERSATION_ID = "COMM-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const PHONE = "2975642625";
const JID = `${PHONE}@s.whatsapp.net`;

function functionCall(name, args, callId = `call-${name}`) {
  return { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) };
}

function voiceTranscript(text = "Mi kier haci un cita pa mañan.") {
  return canonicalVoiceRuntimeMessage({
    id: "MSG-PAP-VOICE-1",
    messageId: "MSG-PAP-VOICE-1",
    conversationId: CONVERSATION_ID,
    communicationAccountId: ACCOUNT_ID,
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: JID,
    chat: JID,
    phone: PHONE,
    direction: "inbound",
    mediaType: "audio",
    text: "[Audio]",
    customerInputVersion: 4,
    transcriptionStatus: "completed",
    rawTranscript: text,
    transcript: text,
  });
}

function pilotSettings() {
  return {
    enabled: true,
    observationEnabled: true,
    autoReplyEnabled: true,
    replyMode: "pilot",
    autoReplyAllowlist: [],
    newContactAutoReplyEnabled: true,
    cancellationAutoReplyEnabled: true,
    rescheduleAutoReplyEnabled: true,
  };
}

test("P0 #16: Aruba Papiamento remains a first-class pap-aw language contract across Observer and Customer Runtime", () => {
  assert.match(observerInstructions(), /Aruba Papiamento is pap-aw, not Curaçao Papiamentu/);
  const languageEnum = FINAL_RESPONSE_TOOL.parameters.properties.language.enum;
  assert.deepEqual(languageEnum, ["es", "en", "pap-aw"]);
  assert.match(runtimeInstructions({ state: { session: {} }, context: {} }), /Papiamento di Aruba/);

  const parsed = observationFromResponse({ output: [functionCall(OBSERVATION_TOOL.name, {
    intent: "booking_request",
    confidence: 0.98,
    language: "pap-aw",
    summary: "Cliente kier haci un cita pa mañan.",
    requiresAttention: false,
    dispatchRisk: false,
    reasonAlreadyProvided: false,
    reason: "",
    appointmentReference: "",
    requestedDate: "",
    requestedTime: "",
    criticalValueAmbiguous: false,
  })] });
  assert.equal(parsed.language, "pap-aw");
});

test("P0 #25: completed Papiamento voice preserves the exact Aruba transcript and never substitutes the audio placeholder", () => {
  const text = "Mi kier cancela mi cita pa mañan.";
  const runtimeMessage = voiceTranscript(text);
  assert.ok(runtimeMessage);
  assert.equal(runtimeMessage.text, text);
  assert.equal(runtimeMessage.rawTranscript, text);
  assert.equal(runtimeMessage.mayaInputModality, "voice_transcript");
  assert.notEqual(runtimeMessage.text, "[Audio]");
});

test("P0 #26: a genuinely new contact can start booking by voice through the same governed runtime and verified appointment contract", async () => {
  const runtimeMessage = voiceTranscript();
  assert.ok(runtimeMessage);

  const reply = mayaReplyDecision({
    message: runtimeMessage,
    conversation: {
      id: CONVERSATION_ID,
      conversationId: CONVERSATION_ID,
      communicationAccountId: ACCOUNT_ID,
      provider: "wacli",
      channel: "whatsapp",
      remoteConversationId: JID,
      phone: PHONE,
      aiDisposition: "ai_active",
    },
    settings: pilotSettings(),
    communicationSettings: { communicationAccountId: ACCOUNT_ID },
    isNewContact: true,
    authorizedWorkflow: "",
  });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "new-contact-pilot");

  const body = buildRuntimeBody({
    conversationId: CONVERSATION_ID,
    provider: "wacli",
    conversation: {
      id: CONVERSATION_ID,
      conversationId: CONVERSATION_ID,
      communicationAccountId: ACCOUNT_ID,
      provider: "wacli",
      channel: "whatsapp",
      phone: PHONE,
      chatJid: JID,
      ownershipVersion: 3,
      customerInputVersion: 4,
      recentMessages: [],
    },
    inboundMessage: runtimeMessage,
  });
  assert.equal(body.conversation.customerTurn.text, "Mi kier haci un cita pa mañan.");
  assert.equal(body.customerInputVersion, 4);

  const toolCalls = [];
  const responses = [
    { output: [functionCall("create_appointment", { offerId: "OFR-VOICE", offerVersion: 1, optionId: "opt-1" })] },
    { output: [functionCall(FINAL_TOOL_NAME, {
      message: "Perfecto. Bo cita ta confirma.",
      outcome: "appointment_confirmed",
      language: "pap-aw",
      requiresHuman: false,
      appointmentId: "APT-VOICE",
      handoffQueue: "",
      handoffReason: "",
    }, "call-final")] },
  ];
  const runtime = createCustomerAgentRuntime({
    db: { collection() { return {}; } },
    registry: {
      definitions: [{
        type: "function",
        name: "create_appointment",
        description: "book",
        strict: true,
        parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
      }],
      async invoke(name, args) {
        toolCalls.push({ name, args });
        if (name === "create_appointment") {
          return { success: true, appointmentId: "APT-VOICE", workOrderIds: ["WO-VOICE"] };
        }
        throw new Error(`Unexpected tool ${name}`);
      },
    },
    modelClient: async () => responses.shift(),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE", language: "pap-aw" }, activeOffer: { id: "OFR-VOICE" } }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });

  const result = await runtime.runTurn({ rawBody: body, apiKey: "test" });
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "create_appointment");
  assert.equal(result.metadata.outcome, "appointment_confirmed");
  assert.equal(result.metadata.appointmentId, "APT-VOICE");
  assert.equal(result.metadata.appointmentCreated, true);
  assert.equal(result.metadata.language, "pap-aw");
});
