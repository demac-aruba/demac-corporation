const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const {
  BOOKING_CORE_VERSION,
} = require("./whatsappCopilotBookingRuntimeV1");
const {
  CONFIRMATION_GUARD_VERSION,
  tryResolveConfirmedAppointment,
} = require("./whatsappCopilotConfirmationGuardV32");
const {
  AGENT_VERSION,
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  REASONING_EFFORT,
  runAgentTurn,
} = require("./whatsappCopilotAgentV30");

// Transitional access token for the current internal agent endpoint.
// Keep the deployed secret name until Communication Center becomes the sole caller.
const agentAccessToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

// AI handles language/intent; Booking Core v1 owns the current canonical
// offer -> selection -> booking state until Booking Authority replaces it.
const RUNTIME = {
  functionName: "whatsappCopilotDraft",
  source: "openai-native-conversation-agent-v31+booking-core-v1+confirmation-guard-v32+erp-tools",
  version: 18,
  flowVersion: AGENT_VERSION,
  agentVersion: AGENT_VERSION,
  confirmationGuardVersion: CONFIRMATION_GUARD_VERSION,
  bookingCoreVersion: BOOKING_CORE_VERSION,
  architecture: "ai-first-native-messages+canonical-booking-session+erp-tools",
};

const FUNCTION_OPTIONS = {
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 90,
  secrets: [openAiApiKey, agentAccessToken],
};

function setCors(_request, response) {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Max-Age", "3600");
}

function bearerToken(request) {
  const authorization = String(request.get("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function attachRuntime(payload) {
  const body = payload && typeof payload === "object" ? payload : { draft: String(payload || "") };
  body.runtime = {
    ...RUNTIME,
    model: body?.metadata?.model || PRIMARY_MODEL,
    fallbackUsed: Boolean(body?.metadata?.fallbackUsed),
  };
  body.metadata = {
    ...(body.metadata || {}),
    currentTurnPolicy: "ai-semantic-v31+booking-core-v1+confirmation-guard-v32",
    conversationFlowVersion: AGENT_VERSION,
    agentVersion: AGENT_VERSION,
    confirmationGuardVersion: CONFIRMATION_GUARD_VERSION,
    bookingCoreVersion: BOOKING_CORE_VERSION,
    architecture: RUNTIME.architecture,
  };
  return body;
}

exports.whatsappCopilotDraft = onRequest(FUNCTION_OPTIONS, async (request, response) => {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "POST") {
    response.set("Allow", "POST, OPTIONS");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!safeEqual(bearerToken(request), agentAccessToken.value())) {
    response.status(401).json({ error: "Token de acceso del agente inválido o ausente." });
    return;
  }

  if (request.body?.mode === "health") {
    response.status(200).json({
      ok: true,
      source: RUNTIME.source,
      model: PRIMARY_MODEL,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      reasoningEffort: REASONING_EFFORT,
      openAiConfigured: Boolean(openAiApiKey.value()),
      erpSchedulingConfigured: true,
      erpKnowledgeConfigured: true,
      conversationPolicyVersion: RUNTIME.version,
      conversationFlowVersion: RUNTIME.flowVersion,
      agentVersion: RUNTIME.agentVersion,
      confirmationGuardVersion: RUNTIME.confirmationGuardVersion,
      bookingCoreVersion: RUNTIME.bookingCoreVersion,
      architecture: RUNTIME.architecture,
      functionName: RUNTIME.functionName,
      currentTurnPolicy: "ai-semantic-v31+booking-core-v1+confirmation-guard-v32",
    });
    return;
  }

  try {
    // Once the ERP has already offered concrete slots, accepting one of those
    // slots is a transaction state transition, not a creative-language task.
    const confirmed = await tryResolveConfirmedAppointment(request.body || {});
    if (confirmed) {
      response.status(200).json(attachRuntime(confirmed));
      return;
    }

    const payload = await runAgentTurn({
      rawBody: request.body || {},
      apiKey: openAiApiKey.value(),
      company: String(request.body?.company || "DEMAC Professional Cooling Solutions"),
      operator: String(request.body?.operator || "Operaciones"),
    });
    response.status(200).json(attachRuntime(payload));
  } catch (error) {
    response.status(500).json({
      error: `No se pudo procesar el agente conversacional de DEMAC: ${error?.message || error}`,
      runtime: {
        ...RUNTIME,
        route: "error",
      },
    });
  }
});

module.exports.RUNTIME = RUNTIME;
