const crypto = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const {
  CUSTOMER_AGENT_RUNTIME_VERSION,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_REASONING_EFFORT,
  createCustomerAgentRuntime,
} = require("./demacCustomerAgentRuntimeV1");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const customerAgentRuntime = createCustomerAgentRuntime({ db });

// Transitional endpoint credential. The secret name is preserved until all
// callers use the Communication Center/server bridge and this public draft
// endpoint can be retired without a credential migration outage.
const agentAccessToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const PRIMARY_MODEL = process.env.DEMAC_CUSTOMER_AGENT_MODEL || DEFAULT_PRIMARY_MODEL;
const FALLBACK_MODEL = process.env.DEMAC_CUSTOMER_AGENT_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
const REASONING_EFFORT = process.env.DEMAC_CUSTOMER_AGENT_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;

const RUNTIME = Object.freeze({
  functionName: "whatsappCopilotDraft",
  source: "demac-customer-agent-runtime-v1+booking-authority",
  version: CUSTOMER_AGENT_RUNTIME_VERSION,
  architecture: "single-agent-tool-loop+erp-tools+booking-authority",
  bookingAuthority: true,
  toolCount: customerAgentRuntime.toolDefinitions.length - 1,
});

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
    runtimeVersion: CUSTOMER_AGENT_RUNTIME_VERSION,
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
      functionName: RUNTIME.functionName,
      runtimeVersion: RUNTIME.version,
      architecture: RUNTIME.architecture,
      bookingAuthority: RUNTIME.bookingAuthority,
      businessToolCount: RUNTIME.toolCount,
      model: PRIMARY_MODEL,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      reasoningEffort: REASONING_EFFORT,
      openAiConfigured: Boolean(openAiApiKey.value()),
    });
    return;
  }

  try {
    const payload = await customerAgentRuntime.runTurn({
      rawBody: request.body || {},
      apiKey: openAiApiKey.value(),
      company: String(request.body?.company || "DEMAC Professional Cooling Solutions"),
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
module.exports.attachRuntime = attachRuntime;
