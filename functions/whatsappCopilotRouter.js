const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const { whatsappCopilotDraft: schedulingDraft } = require("./whatsappCopilot");
const { resolveKnowledgeReply } = require("./whatsappCopilotKnowledge");

const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

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

exports.whatsappCopilotDraft = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 90,
    secrets: [openAiApiKey, extensionToken],
  },
  async (request, response) => {
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
        source: "openai+erp-unified-router",
        model: "gpt-5-mini",
        openAiConfigured: Boolean(openAiApiKey.value()),
        erpSchedulingConfigured: true,
        erpKnowledgeConfigured: true,
      });
      return;
    }

    try {
      const knowledge = await resolveKnowledgeReply(request.body || {});
      if (knowledge.route === "knowledge") {
        response.status(200).json(knowledge.payload);
        return;
      }
    } catch (error) {
      // A knowledge lookup failure must not silently turn a direct question into a scheduling answer.
      response.status(500).json({
        error: `No se pudo consultar la base unificada de conocimiento: ${error?.message || error}`,
      });
      return;
    }

    await schedulingDraft(request, response);
  },
);
