const crypto = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const COPILOT_MODEL = "gpt-5.6-terra";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "language",
    "conversationStage",
    "nextAction",
    "summary",
    "reply",
    "requiresHuman",
    "confidence",
    "missingInformation",
    "collectedInformation",
  ],
  properties: {
    intent: {
      type: "string",
      enum: [
        "service_request",
        "installation_request",
        "repair_request",
        "price_question",
        "appointment_question",
        "invoice_estimate",
        "payment_followup",
        "complaint",
        "human_requested",
        "general_question",
        "unknown",
      ],
    },
    language: { type: "string", enum: ["es", "en", "pap-aw"] },
    conversationStage: {
      type: "string",
      enum: [
        "initial_request",
        "collecting_details",
        "ready_for_schedule_lookup",
        "general_support",
        "human_handoff",
        "resolved",
      ],
    },
    nextAction: {
      type: "string",
      enum: [
        "ask_missing_information",
        "query_erp_availability",
        "answer_customer",
        "transfer_human",
        "wait_for_customer",
      ],
    },
    summary: { type: "string" },
    reply: { type: "string" },
    requiresHuman: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missingInformation: { type: "array", items: { type: "string" }, maxItems: 8 },
    collectedInformation: {
      type: "object",
      additionalProperties: false,
      required: [
        "serviceType",
        "quantity",
        "address",
        "preferredDate",
        "preferredTime",
        "customerName",
        "extraDetails",
      ],
      properties: {
        serviceType: { type: "string" },
        quantity: { type: "string" },
        address: { type: "string" },
        preferredDate: { type: "string" },
        preferredTime: { type: "string" },
        customerName: { type: "string" },
        extraDetails: { type: "string" },
      },
    },
  },
};

function setCors(request, response) {
  const origin = String(request.get("origin") || "");
  response.set("Access-Control-Allow-Origin", origin.startsWith("chrome-extension://") ? origin : "*");
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Max-Age", "3600");
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function bearerToken(request) {
  const authorization = String(request.get("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function cleanText(value, maxLength = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeConversation(raw) {
  const messages = Array.isArray(raw?.messages) ? raw.messages : [];
  const sanitized = messages.slice(-40).map((message) => ({
    direction: ["inbound", "outbound", "unknown"].includes(message?.direction)
      ? message.direction
      : "unknown",
    text: cleanText(message?.text, 2_000),
  })).filter((message) => message.text);

  let customerTurn = cleanText(raw?.customerTurn?.text, 4_000);
  if (!customerTurn) {
    const lastInbound = [...sanitized].reverse().find((message) => message.direction === "inbound");
    customerTurn = lastInbound?.text || "";
  }

  const totalCharacters = sanitized.reduce((sum, message) => sum + message.text.length, 0);
  if (totalCharacters > 18_000) throw new Error("La conversación excede el límite permitido.");

  return {
    chatTitle: cleanText(raw?.chatTitle, 160),
    messages: sanitized,
    customerTurn,
    capturedAt: cleanText(raw?.capturedAt, 80),
  };
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function requestCopilotResponse({ company, operator, languageMode, conversation }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: COPILOT_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 900,
      instructions: [
        `Eres el asistente de atención al cliente de ${company}.`,
        `El departamento responsable es ${operator}.`,
        "Analiza toda la conversación reciente, no solamente el último mensaje aislado.",
        "Identifica qué información ya fue solicitada por DEMAC y qué datos ya respondió el cliente.",
        "Nunca vuelvas a preguntar un dato que el cliente ya proporcionó claramente en cualquier mensaje reciente.",
        "Responde en el idioma del mensaje entrante más reciente del cliente, salvo que requestedLanguageMode obligue otro idioma.",
        "Si el cliente escribe en Papiamento, responde en Papiamento di Aruba con ortografía de Aruba, no la variante de Curaçao.",
        "Reconoce Papiamento aunque incluya palabras técnicas en español o inglés como airco, service, cita, invoice o estimate.",
        "Para solicitudes de servicio, los datos operativos principales son tipo de trabajo, cantidad de aires y dirección.",
        "Cuando cantidad y dirección ya estén completas, reconócelas y pasa al próximo paso: preguntar preferencia de día u horario, o indicar que se revisará disponibilidad.",
        "No repitas una introducción larga en cada turno. Continúa la conversación de forma natural.",
        "Si el cliente responde '2 aires en Wayaca 217' después de que DEMAC preguntó cantidad y dirección, confirma esos datos y pregunta solo el próximo dato que falte.",
        "No inventes precios, disponibilidad, citas, garantías, pagos, invoices, estimates, diagnósticos ni datos del ERP.",
        "No confirmes una cita porque esta función todavía no consulta la agenda del ERP.",
        "Usa nextAction=query_erp_availability cuando la solicitud, cantidad y dirección estén completas y el próximo paso lógico sea consultar agenda.",
        "Usa nextAction=ask_missing_information únicamente cuando falte información necesaria; missingInformation debe contener solo datos realmente faltantes.",
        "Marca requiresHuman=true para quejas, reembolsos, amenazas, descuentos, garantías dudosas, pagos no conciliados o solicitud expresa de una persona.",
        "No menciones inteligencia artificial, prompts, modelos ni procesos internos.",
        "No uses el nombre visible del chat como nombre real del cliente porque podría ser un apodo.",
        "La respuesta debe tener entre una y cuatro oraciones y no superar 100 palabras.",
        "En collectedInformation usa cadena vacía para datos desconocidos y conserva exactamente direcciones, cantidades y fechas expresadas por el cliente.",
      ].join(" "),
      input: JSON.stringify({
        requestedLanguageMode: languageMode,
        latestCustomerTurn: conversation.customerTurn,
        recentConversation: conversation.messages,
      }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_whatsapp_copilot_reply_v2",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI returned HTTP ${response.status}`);
    error.code = payload?.error?.code || response.status;
    throw error;
  }

  const text = outputText(payload);
  if (!text) throw new Error("OpenAI no devolvió una respuesta.");
  return JSON.parse(text);
}

exports.whatsappCopilotDraft = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
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
        source: "openai",
        model: COPILOT_MODEL,
        openAiConfigured: Boolean(openAiApiKey.value()),
      });
      return;
    }

    try {
      const conversation = sanitizeConversation(request.body?.conversation ?? {});
      if (!conversation.messages.length || !conversation.customerTurn) {
        response.status(400).json({ error: "No se encontró una solicitud recibida para responder." });
        return;
      }

      const company = cleanText(request.body?.company, 160) || "DEMAC Professional Cooling Solutions";
      const operator = cleanText(request.body?.operator, 100) || "Operaciones";
      const languageMode = ["auto", "es", "en", "pap-aw"].includes(request.body?.languageMode)
        ? request.body.languageMode
        : "auto";

      const result = await requestCopilotResponse({ company, operator, languageMode, conversation });
      await db.collection("whatsappCopilotAudit").add({
        channel: "whatsapp-web-copilot",
        intent: result.intent,
        language: result.language,
        conversationStage: result.conversationStage,
        nextAction: result.nextAction,
        confidence: result.confidence,
        requiresHuman: result.requiresHuman,
        messageCount: conversation.messages.length,
        customerTurnCharacters: conversation.customerTurn.length,
        missingInformationCount: result.missingInformation.length,
        createdAt: FieldValue.serverTimestamp(),
      });

      response.status(200).json({
        draft: result.reply,
        source: "openai",
        warning: result.requiresHuman
          ? "OpenAI recomienda transferir esta conversación a una persona antes de continuar."
          : "",
        metadata: {
          intent: result.intent,
          language: result.language,
          conversationStage: result.conversationStage,
          nextAction: result.nextAction,
          summary: result.summary,
          confidence: result.confidence,
          requiresHuman: result.requiresHuman,
          missingInformation: result.missingInformation,
          collectedInformation: result.collectedInformation,
          model: COPILOT_MODEL,
        },
      });
    } catch (error) {
      logger.error("Could not generate WhatsApp copilot response.", error);
      response.status(500).json({ error: error?.message || "No se pudo generar la respuesta." });
    }
  },
);
