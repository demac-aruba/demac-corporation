const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const { whatsappCopilotDraft: schedulingDraft } = require("./whatsappCopilot");
const { resolveKnowledgeReply } = require("./whatsappCopilotKnowledge");
const {
  formatNaturalCustomerReply,
  immediateReply,
  isAvailabilityTurn,
  latestCustomerText,
} = require("./whatsappCopilotConversationPolicy");

// COPILOT_CONVERSATION_RULES_V15_ROUTER: runtime policy is already materialized.
const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");
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

function schedulingCapture() {
  const state = {
    statusCode: 200,
    body: undefined,
    responseType: "json",
  };
  const capture = {
    set() { return capture; },
    status(code) {
      state.statusCode = Number(code) || 200;
      return capture;
    },
    json(body) {
      state.body = body;
      state.responseType = "json";
      return capture;
    },
    send(body) {
      state.body = body;
      state.responseType = "send";
      return capture;
    },
  };
  return { capture, state };
}

async function runSchedulingDraft(request) {
  const { capture, state } = schedulingCapture();
  await schedulingDraft(request, capture);
  if (state.body === undefined) throw new Error("El motor de agenda terminó sin generar una respuesta.");
  return state;
}

function runtimeMetadata(runtime) {
  return {
    functionName: runtime.functionName,
    source: runtime.source,
    version: runtime.version,
  };
}

function sendCaptured(response, captured, runtime) {
  const body = captured.body;
  if (body && typeof body === "object" && typeof body.draft === "string") {
    body.draft = formatNaturalCustomerReply(body.draft, body?.metadata?.language || "es");
  }
  if (body && typeof body === "object") body.runtime = runtimeMetadata(runtime);
  const outgoing = response.status(captured.statusCode);
  if (captured.responseType === "send") outgoing.send(body);
  else outgoing.json(body);
}

function createCopilotEndpoint(runtime) {
  // Important: every exported Firebase function must get its own onRequest object.
  // Aliasing one onRequest object under two export names makes Firebase discover
  // only one endpoint, which caused `No function matches the filter` for V17.
  return onRequest(FUNCTION_OPTIONS, async (request, response) => {
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
        source: runtime.source,
        model: "gpt-5-mini",
        openAiConfigured: Boolean(openAiApiKey.value()),
        erpSchedulingConfigured: true,
        erpKnowledgeConfigured: true,
        conversationPolicyVersion: runtime.version,
        functionName: runtime.functionName,
      });
      return;
    }

    try {
      const conversation = request.body?.conversation || {};
      const immediate = immediateReply({
        conversation,
        languageMode: request.body?.languageMode || "auto",
      });
      if (immediate) {
        immediate.runtime = runtimeMetadata(runtime);
        response.status(200).json(immediate);
        return;
      }

      const latest = latestCustomerText(conversation);
      if (isAvailabilityTurn(latest)) {
        const captured = await runSchedulingDraft(request);
        sendCaptured(response, captured, runtime);
        return;
      }

      const knowledge = await resolveKnowledgeReply(request.body || {});
      if (knowledge.route === "knowledge") {
        knowledge.payload.draft = formatNaturalCustomerReply(
          knowledge.payload.draft,
          knowledge.payload?.metadata?.language || "es",
        );
        knowledge.payload.runtime = runtimeMetadata(runtime);
        response.status(200).json(knowledge.payload);
        return;
      }

      const captured = await runSchedulingDraft(request);
      sendCaptured(response, captured, runtime);
    } catch (error) {
      response.status(500).json({
        error: `No se pudo procesar el flujo unificado del Copilot: ${error?.message || error}`,
        runtime: runtimeMetadata(runtime),
      });
    }
  });
}

exports.whatsappCopilotDraft = createCopilotEndpoint({
  functionName: "whatsappCopilotDraft",
  source: "openai+erp-unified-router-v17-compatible",
  version: 17,
});

exports.whatsappCopilotDraftV17 = createCopilotEndpoint({
  functionName: "whatsappCopilotDraftV17",
  source: "openai+erp-unified-router-v17",
  version: 17,
});
