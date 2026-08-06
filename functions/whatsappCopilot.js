const crypto = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const papiamentoVocabulary = require("./data/papiamento-aruba-vocabulary-2009.json");
const { arubaDateParts } = require("./whatsappCopilotSchedulingCore");
const { orchestrateScheduling } = require("./whatsappCopilotScheduling");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const COPILOT_MODEL = "gpt-5-mini";
const PAPIAMENTO_WORDS = new Set((papiamentoVocabulary.words || []).map((word) => normalizeWord(word)).filter(Boolean));
const PAPIAMENTO_ALLOWED = new Set([
  "demac", "whatsapp", "erp", "btu", "hvac", "r32", "r410a", "r22", "vrf", "mini", "split",
  "inverter", "adina", "optima", "carrier", "innovair", "gree", "daikin", "mitsubishi", "firebase",
  "openai", "am", "pm",
]);

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
    "selectedOptionOrdinal",
    "customerConfirmedAppointment",
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
        "offering_appointments",
        "appointment_option_selected",
        "appointment_confirmed",
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
        "reserve_erp_appointment",
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
    selectedOptionOrdinal: { type: "integer", minimum: 0, maximum: 3 },
    customerConfirmedAppointment: { type: "boolean" },
    collectedInformation: {
      type: "object",
      additionalProperties: false,
      required: [
        "serviceType",
        "quantity",
        "address",
        "requestedDate",
        "requestedTime",
        "preferredDate",
        "preferredTime",
        "customerName",
        "extraDetails",
      ],
      properties: {
        serviceType: { type: "string" },
        quantity: { type: "string" },
        address: { type: "string" },
        requestedDate: { type: "string" },
        requestedTime: { type: "string" },
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

function normalizeWord(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, "")
    .trim();
}

function extractContactIdentity(messages, raw) {
  const explicitPhone = cleanText(raw?.contactPhone, 40).replace(/\D/g, "");
  const explicitJid = cleanText(raw?.contactJid, 120);
  if (explicitPhone) return { contactPhone: explicitPhone, contactJid: explicitJid };
  for (const message of messages) {
    if (message.direction !== "inbound") continue;
    const id = String(message.id || "");
    const match = id.match(/(?:^|_)(\d{7,20})@(c\.us|s\.whatsapp\.net)(?:_|$)/i);
    if (match) return { contactPhone: match[1], contactJid: `${match[1]}@${match[2]}` };
  }
  return { contactPhone: "", contactJid: explicitJid };
}

function sanitizeConversation(raw) {
  const messages = Array.isArray(raw?.messages) ? raw.messages : [];
  const sanitized = messages.slice(-40).map((message) => ({
    id: cleanText(message?.id, 220),
    direction: ["inbound", "outbound", "unknown"].includes(message?.direction)
      ? message.direction
      : "unknown",
    sender: cleanText(message?.sender, 160),
    text: cleanText(message?.text, 2_000),
  })).filter((message) => message.text);

  let customerTurn = cleanText(raw?.customerTurn?.text, 4_000);
  if (!customerTurn) {
    const lastInbound = [...sanitized].reverse().find((message) => message.direction === "inbound");
    customerTurn = lastInbound?.text || "";
  }

  const totalCharacters = sanitized.reduce((sum, message) => sum + message.text.length, 0);
  if (totalCharacters > 18_000) throw new Error("La conversación excede el límite permitido.");
  const identity = extractContactIdentity(sanitized, raw);

  return {
    chatTitle: cleanText(raw?.chatTitle, 160),
    messages: sanitized,
    customerTurn,
    contactPhone: identity.contactPhone,
    contactJid: identity.contactJid,
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

function schedulingReady(result) {
  const collected = result.collectedInformation || {};
  return Boolean(cleanText(collected.serviceType) && cleanText(collected.quantity) && cleanText(collected.address));
}

async function requestCopilotAnalysis({ company, operator, languageMode, conversation }) {
  const arubaNow = arubaDateParts();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: COPILOT_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 950,
      instructions: [
        `Eres el asistente de atención al cliente de ${company}.`,
        `El departamento responsable es ${operator}.`,
        `La fecha local actual en Aruba es ${arubaNow.date} y la hora local es ${arubaNow.time}.`,
        "Analiza toda la conversación reciente, no solamente el último mensaje aislado.",
        "Identifica qué información ya fue solicitada por DEMAC y qué datos ya respondió el cliente.",
        "Nunca vuelvas a preguntar un dato que el cliente ya proporcionó claramente.",
        "Responde en el idioma del mensaje entrante más reciente, salvo que requestedLanguageMode obligue otro idioma.",
        "Si el cliente escribe en Papiamento, usa Papiamento di Aruba con ortografía de Aruba, no la variante de Curaçao.",
        "Reconoce Papiamento aunque incluya términos técnicos en español o inglés como airco, service, cita, invoice o estimate.",
        "Para programar servicio o instalación, los datos indispensables son tipo de trabajo, cantidad de aires y dirección.",
        "DEMAC NO le pregunta al cliente qué día u hora desea cuando esos tres datos ya están completos.",
        "Cuando tipo de trabajo, cantidad y dirección estén completos, usa nextAction=query_erp_availability y conversationStage=ready_for_schedule_lookup.",
        "La agenda real y la ruta de las vans se consultan después de este análisis. Nunca inventes disponibilidad ni una fecha.",
        "Si el cliente menciona voluntariamente un día o una hora, consérvalo como restricción en requestedDate y requestedTime, pero no lo solicites.",
        "Normaliza requestedDate a YYYY-MM-DD cuando sea posible usando la fecha local de Aruba. Normaliza requestedTime a HH:mm de 24 horas cuando sea posible.",
        "Si DEMAC ya ofreció opciones numeradas y el cliente elige una, coloca selectedOptionOrdinal entre 1 y 3, customerConfirmedAppointment=true, conversationStage=appointment_option_selected y nextAction=reserve_erp_appointment.",
        "Ejemplos de confirmación: 'la primera', 'opción 2', 'sí, mañana a las 8:30', 'ese horario está bien'.",
        "Si el cliente solo pide otro día, no confirmes una cita; conserva ese día y usa query_erp_availability.",
        "Si el cliente responde '2 aires en Wayaca 217', quantity debe ser '2' y address debe ser 'Wayaca 217'; no incluyas la cantidad dentro de la dirección.",
        "No inventes precios, garantías, pagos, invoices, estimates, diagnósticos ni información del ERP.",
        "Marca requiresHuman=true para quejas, reembolsos, amenazas, descuentos, garantías dudosas, pagos no conciliados o solicitud expresa de una persona.",
        "No menciones inteligencia artificial, prompts, modelos ni procesos internos.",
        "No uses el nombre visible del chat como nombre real del cliente porque podría ser un apodo.",
        "Para respuestas no relacionadas con agenda, reply debe tener entre una y cuatro oraciones y no superar 100 palabras.",
        "Cuando la agenda deba consultarse, reply puede ser una frase breve de transición; el backend la reemplazará con opciones reales.",
        "En collectedInformation usa cadena vacía para datos desconocidos.",
      ].join(" "),
      input: JSON.stringify({
        requestedLanguageMode: languageMode,
        latestCustomerTurn: conversation.customerTurn,
        recentConversation: conversation.messages.map(({ direction, text }) => ({ direction, text })),
      }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_whatsapp_copilot_reply_v3",
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

function validatePapiamento(text) {
  const tokens = String(text ?? "")
    .split(/[^A-Za-zÀ-ÿ0-9ñÑ]+/)
    .map(normalizeWord)
    .filter((word) => word && !/^\d+$/.test(word));
  const unknown = [];
  const seen = new Set();
  for (const word of tokens) {
    if (word.length <= 1 || PAPIAMENTO_WORDS.has(word) || PAPIAMENTO_ALLOWED.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    unknown.push(word);
    if (unknown.length >= 20) break;
  }
  return {
    source: papiamentoVocabulary.source,
    orthographyVersion: papiamentoVocabulary.orthographyVersion,
    referenceSite: papiamentoVocabulary.referenceSite,
    unknownWords: unknown,
    passed: unknown.length === 0,
  };
}

function safeSchedulingReply(language) {
  if (language === "en") return "Thank you. I have the service details and our operations team is reviewing the ERP agenda and route before confirming the closest available options.";
  if (language === "pap-aw") return "Danki. Nos tin e datonan di e servicio y nos team di Operacion ta revisa agenda di ERP y e ruta prome cu nos confirma e opcionnan mas cercano.";
  return "Gracias. Ya tenemos los datos del servicio y nuestro equipo de Operaciones está revisando la agenda del ERP y la ruta antes de confirmar las opciones más cercanas.";
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
        source: "openai+erp",
        model: COPILOT_MODEL,
        openAiConfigured: Boolean(openAiApiKey.value()),
        erpSchedulingConfigured: true,
        papiamentoVocabulary: {
          source: papiamentoVocabulary.source,
          orthographyVersion: papiamentoVocabulary.orthographyVersion,
          wordCount: papiamentoVocabulary.wordCount,
        },
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

      const result = await requestCopilotAnalysis({ company, operator, languageMode, conversation });
      let draft = result.reply;
      let warning = result.requiresHuman
        ? "OpenAI recomienda transferir esta conversación a una persona antes de continuar."
        : "";
      let scheduling = null;
      const shouldSchedule = schedulingReady(result) && [
        "query_erp_availability",
        "reserve_erp_appointment",
      ].includes(result.nextAction);

      if (shouldSchedule && !result.requiresHuman) {
        try {
          scheduling = await orchestrateScheduling({
            db,
            request: {
              chatTitle: conversation.chatTitle,
              contactPhone: conversation.contactPhone,
              contactJid: conversation.contactJid,
              latestCustomerTurn: conversation.customerTurn,
            },
            analysis: result,
          });
          draft = scheduling.reply;
          if (scheduling.warning) warning = scheduling.warning;
          result.conversationStage = scheduling.action === "appointment_booked"
            ? "appointment_confirmed"
            : scheduling.action === "availability_offered"
              ? "offering_appointments"
              : "human_handoff";
          result.nextAction = scheduling.action === "appointment_booked"
            ? "wait_for_customer"
            : scheduling.action === "availability_offered"
              ? "wait_for_customer"
              : "transfer_human";
          result.requiresHuman = scheduling.action === "availability_unavailable";
        } catch (error) {
          logger.error("Could not query or reserve ERP availability.", error);
          draft = safeSchedulingReply(result.language);
          warning = `La agenda del ERP no pudo completar la consulta automática: ${error?.message || error}`;
          result.requiresHuman = true;
          result.conversationStage = "human_handoff";
          result.nextAction = "transfer_human";
        }
      }

      const papiamentoValidation = result.language === "pap-aw" ? validatePapiamento(draft) : null;
      if (papiamentoValidation?.unknownWords.length) {
        const vocabularyWarning = `Revisar ortografía Papiamento: ${papiamentoValidation.unknownWords.join(", ")}.`;
        warning = warning ? `${warning} ${vocabularyWarning}` : vocabularyWarning;
      }

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
        contactPhoneDetected: Boolean(conversation.contactPhone),
        missingInformationCount: result.missingInformation.length,
        schedulingAction: scheduling?.action ?? "not_requested",
        availabilityOptionCount: scheduling?.result?.options?.length ?? 0,
        primaryWorkOrderId: scheduling?.booking?.primaryWorkOrderId ?? "",
        papiamentoUnknownWordCount: papiamentoValidation?.unknownWords.length ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      });

      response.status(200).json({
        draft,
        source: scheduling ? "openai+erp" : "openai",
        warning,
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
          selectedOptionOrdinal: result.selectedOptionOrdinal,
          customerConfirmedAppointment: result.customerConfirmedAppointment,
          contactPhoneDetected: Boolean(conversation.contactPhone),
          model: COPILOT_MODEL,
          scheduling: scheduling?.metadata ?? null,
          papiamentoValidation,
        },
      });
    } catch (error) {
      logger.error("Could not generate WhatsApp copilot response.", error);
      response.status(500).json({ error: error?.message || "No se pudo generar la respuesta." });
    }
  },
);
