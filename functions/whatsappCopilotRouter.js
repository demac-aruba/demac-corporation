const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const {
  AGENT_VERSION,
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  REASONING_EFFORT,
  runAgentTurn,
} = require("./whatsappCopilotAgentV30");

const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

// Runtime version 18 is intentionally retained so the installed v0.5.0 extension
// can verify the public endpoint. flowVersion/agentVersion identify the new AI-first core.
const RUNTIME = {
  functionName: "whatsappCopilotDraft",
  source: "openai-native-conversation-agent-v30+erp-tools",
  version: 18,
  flowVersion: AGENT_VERSION,
  agentVersion: AGENT_VERSION,
  architecture: "ai-first-native-messages+erp-tools",
};

const FUNCTION_OPTIONS = {
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 90,
  secrets: [openAiApiKey, extensionToken],
};

function setCors(request, response) {
  const origin = String(request.get("origin") || "");
  response.set("Access-Control-Allow-Origin", origin.startsWith("chrome-extension://") ? origin : "*");
  response.set("Vary", "Origin");
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
    currentTurnPolicy: "ai-semantic-v30",
    conversationFlowVersion: AGENT_VERSION,
    agentVersion: AGENT_VERSION,
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
  if (!safeEqual(bearerToken(request), extensionToken.value())) {
    response.status(401).json({ error: "Token de extensión inválido o ausente." });
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
      architecture: RUNTIME.architecture,
      functionName: RUNTIME.functionName,
      currentTurnPolicy: "ai-semantic-v30",
    });
    return;
  }

  try {
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
