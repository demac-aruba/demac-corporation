const crypto = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const {
  distributeUnits,
  parseQuantity,
  resolvePreset,
} = require("./whatsappCopilotAvailability");
const {
  cleanText,
  normalizeText,
} = require("./whatsappCopilotSchedulingCore");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const CLASSIFIER_MODEL = "gpt-5-mini";

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

function latestCustomerText(conversation) {
  const explicit = cleanText(conversation?.customerTurn?.text, 4_000);
  if (explicit) return explicit;
  return cleanText(
    [...(conversation?.messages || [])].reverse().find((item) => item?.direction === "inbound")?.text,
    4_000,
  );
}

function detectQuestionKind(value) {
  const text = normalizeText(value);
  if (/\b(cuanto tiempo|cuánto tiempo|cuanto dura|cuánto dura|durara|durará|how long|duration|duracion|duración|tempo ta dura)\b/.test(text)) return "duration";
  if (/\b(cuanto cuesta|cuánto cuesta|cuanto sale|cuánto sale|precio|price|cost|tarifa|costo|prijs)\b/.test(text)) return "price";
  if (/\b(que incluye|qué incluye|what is included|what does.*include|incluye el servicio|kiko ta inclui)\b/.test(text)) return "service_includes";
  if (/\b(garantia|garantía|warranty)\b/.test(text)) return "warranty";
  if (/\b(metodo de pago|método de pago|formas de pago|payment method|transferencia|cash|efectivo|tarjeta|card)\b/.test(text)) return "payment";
  if (/\b(area de servicio|área de servicio|hasta donde|service area|donde trabajan|unda boso ta traha)\b/.test(text)) return "service_area";
  if (/\b(cancelar|cancelacion|cancelación|reprogramar|cambiar la cita|reschedule|cancel)\b/.test(text)) return "cancellation_reschedule";
  if (/\b(que debo hacer antes|qué debo hacer antes|preparar|preparation|antes del servicio)\b/.test(text)) return "preparation";
  if (/\b(cada cuanto|cada cuánto|frecuencia|how often|maintenance frequency)\b/.test(text)) return "maintenance_frequency";
  if (/\b(emergencia|emergency|urgente|urgent)\b/.test(text)) return "emergency_service";
  if (/\b(invoice|factura|estimate|estimado|cotizacion|cotización|quotation)\b/.test(text)) return "invoice_estimate";
  if (/\b(que hacen|qué hacen|como funciona|cómo funciona|what do you do|how does.*work|informacion del servicio|información del servicio)\b/.test(text)) return "service_info";
  return "";
}

function isSchedulingTurn(value) {
  const text = normalizeText(value);
  if (!text) return true;
  return /\b(opcion 1|opcion 2|opcion uno|opcion dos|la primera|la segunda|ese horario|esa hora|puedo despues|puedo antes|disponible despues|disponible antes|quiero cita|agendar|reservar|que me puedes ofrecer|qué me puedes ofrecer|otro dia|otro día|otra hora)\b/.test(text)
    && !detectQuestionKind(text);
}

function looksLikeQuestion(value) {
  const text = normalizeText(value);
  return String(value || "").includes("?")
    || /^(que|qué|cuanto|cuánto|como|cómo|cuando|cuándo|donde|dónde|cual|cuál|puedo|tienen|tiene|how|what|when|where|which|do you|can you|is there|con|kiko|unda|ki ora)\b/.test(text)
    || Boolean(detectQuestionKind(text));
}

function conversationFacts(raw) {
  const confirmed = raw?.confirmedFacts && typeof raw.confirmedFacts === "object"
    ? raw.confirmedFacts
    : {};
  return {
    serviceType: cleanText(confirmed.serviceType, 120),
    quantity: cleanText(confirmed.quantity, 40),
    address: cleanText(confirmed.address, 180),
    requestedDate: cleanText(confirmed.requestedDate, 40),
    requestedTime: cleanText(confirmed.preferredTime || confirmed.requestedTime, 80),
    preferredDate: cleanText(confirmed.preferredDate, 40),
    preferredTime: cleanText(confirmed.preferredTime, 80),
    customerName: cleanText(confirmed.customerName, 120),
    extraDetails: "",
  };
}

function languageFromRequest(requestBody, latestText) {
  if (["es", "en", "pap-aw"].includes(requestBody?.languageMode)) return requestBody.languageMode;
  const text = normalizeText(latestText);
  if (/\b(how|what|when|where|which|price|cost|service|duration|warranty|payment|invoice|estimate)\b/.test(text)) return "en";
  if (/\b(con ta|cua|kiko|unda|cuanto tempo|prijs|servicio|airco|garantia)\b/.test(text)) return "pap-aw";
  return "es";
}

function valueForLanguage(value, language) {
  if (typeof value === "string") return cleanText(value, 2_000);
  if (!value || typeof value !== "object") return "";
  return cleanText(value[language] || value.es || value.en || value["pap-aw"] || "", 2_000);
}

function durationText(minutes, language, perUnit = false) {
  const hours = minutes / 60;
  const display = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".0", "");
  if (language === "en") {
    return perUnit
      ? `The estimated duration configured in our ERP is approximately ${display} hour${hours === 1 ? "" : "s"} per AC unit.`
      : `The estimated duration configured in our ERP is approximately ${display} hour${hours === 1 ? "" : "s"}.`;
  }
  if (language === "pap-aw") {
    return perUnit
      ? `E duracion estima cu ta configura den nos ERP ta aproximadamente ${display} ora pa cada airco.`
      : `E duracion estima cu ta configura den nos ERP ta aproximadamente ${display} ora.`;
  }
  return perUnit
    ? `La duración estimada configurada en nuestro ERP es de aproximadamente ${display} hora${hours === 1 ? "" : "s"} por cada aire.`
    : `La duración estimada configurada en nuestro ERP es de aproximadamente ${display} hora${hours === 1 ? "" : "s"}.`;
}

function tokens(value) {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 2));
}

function ruleScore(rule, latestText, detectedKind) {
  if (rule.active === false) return -1;
  const text = normalizeText(latestText);
  const triggers = Array.isArray(rule.triggerPhrases) ? rule.triggerPhrases : [];
  let score = Number(rule.priority || 0);
  if (detectedKind && normalizeText(rule.intent) === normalizeText(detectedKind)) score += 200;
  for (const phrase of triggers) {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) continue;
    if (text.includes(normalizedPhrase)) score += 160 + normalizedPhrase.length;
    const phraseTokens = tokens(normalizedPhrase);
    const textTokens = tokens(text);
    let overlap = 0;
    for (const token of phraseTokens) if (textTokens.has(token)) overlap += 1;
    if (phraseTokens.size) score += Math.round((overlap / phraseTokens.size) * 80);
  }
  return score;
}

function bestDeterministicRule(rules, latestText, detectedKind) {
  const ranked = rules
    .map((rule) => ({ rule, score: ruleScore(rule, latestText, detectedKind) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 70 ? ranked[0].rule : null;
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

async function classifyAgainstRules(latestText, facts, rules) {
  if (!openAiApiKey.value() || !rules.length) return { route: "human", ruleId: "", confidence: 0 };
  const allowedRules = rules.slice(0, 80).map((rule) => ({
    id: rule.id,
    title: cleanText(rule.title, 120),
    intent: cleanText(rule.intent, 80),
    triggerPhrases: Array.isArray(rule.triggerPhrases) ? rule.triggerPhrases.slice(0, 12) : [],
  }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 220,
      instructions: [
        "Clasifica el último mensaje del cliente de DEMAC.",
        "No redactes una respuesta para el cliente.",
        "Elige route=rule solamente cuando una regla aprobada responda directamente la pregunta.",
        "Elige route=schedule cuando el cliente selecciona, cambia o solicita una cita o disponibilidad.",
        "Elige route=human cuando es una pregunta real pero ninguna regla aprobada aplica.",
        "Nunca inventes un ruleId.",
      ].join(" "),
      input: JSON.stringify({ latestCustomerText: latestText, confirmedFacts: facts, allowedRules }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_knowledge_rule_classifier",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["route", "ruleId", "confidence"],
            properties: {
              route: { type: "string", enum: ["rule", "schedule", "human"] },
              ruleId: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { route: "human", ruleId: "", confidence: 0 };
  const parsed = JSON.parse(outputText(payload) || "{}");
  if (parsed.route === "rule" && !rules.some((rule) => rule.id === parsed.ruleId)) {
    return { route: "human", ruleId: "", confidence: 0 };
  }
  return parsed;
}

function findService(services, preset, facts) {
  const presetId = cleanText(preset?.id, 120);
  const label = normalizeText(preset?.label);
  const type = normalizeText(facts.serviceType);
  return services.find((service) => service.id === presetId)
    || services.find((service) => normalizeText(service.name) === label)
    || services.find((service) => normalizeText(`${service.name} ${service.category}`).includes(label))
    || services.find((service) => type && normalizeText(`${service.name} ${service.category}`).includes(type));
}

function servicePriceText(service, language) {
  const amount = [service?.customerPrice, service?.salePrice, service?.unitPrice, service?.basePrice, service?.price]
    .map(Number)
    .find((value) => Number.isFinite(value) && value >= 0);
  if (amount === undefined) return "";
  if (language === "en") return `The current price registered in our ERP is Afl. ${amount.toFixed(2)}.`;
  if (language === "pap-aw") return `E prijs actual registra den nos ERP ta Afl. ${amount.toFixed(2)}.`;
  return `El precio actual registrado en nuestro ERP es Afl. ${amount.toFixed(2)}.`;
}

function safeHumanAnswer(language) {
  if (language === "en") return "I want to give you the correct information. Our Operations team will review this question and reply shortly.";
  if (language === "pap-aw") return "Nos kier duna bo e informacion correcto. Nos team di Operacion lo revisa e pregunta y contesta bo pronto.";
  return "Queremos darle la información correcta. Nuestro equipo de Operaciones revisará esta pregunta y le responderá en breve.";
}

async function buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount }) {
  const source = cleanText(rule?.source, 80) || "manual";
  if (source === "erp_duration" || cleanText(rule?.intent, 80) === "duration") {
    const quantity = parseQuantity(facts.quantity);
    if (!quantity) return durationText(preset.durationMinutesPerUnit, language, true);
    const allocations = distributeUnits(quantity, preset.durationMinutesPerUnit, activeVanCount);
    const estimatedMinutes = allocations.length
      ? Math.max(...allocations.map((allocation) => allocation.quantity * preset.durationMinutesPerUnit))
      : quantity * preset.durationMinutesPerUnit;
    return durationText(estimatedMinutes, language);
  }

  const service = findService(services, preset, facts);
  if (source === "erp_service_description") {
    return valueForLanguage(
      service?.customerDescription || service?.description || service?.details,
      language,
    );
  }
  if (source === "erp_service_price") return servicePriceText(service, language);

  return valueForLanguage(
    rule?.answer || {
      es: rule?.answerEs,
      en: rule?.answerEn,
      "pap-aw": rule?.answerPapAw,
    },
    language,
  );
}

function responsePayload({ draft, language, facts, kind, rule, requiresHuman, warning, confidence = 1 }) {
  return {
    draft,
    source: "erp-knowledge-rules",
    warning: warning || "",
    metadata: {
      intent: kind === "price" ? "price_question" : "general_question",
      language,
      conversationStage: requiresHuman ? "human_handoff" : "general_support",
      nextAction: requiresHuman ? "transfer_human" : "wait_for_customer",
      summary: `Pregunta directa atendida por la regla ${rule?.id || kind || "sin-regla"}`,
      confidence,
      requiresHuman,
      missingInformation: [],
      collectedInformation: facts,
      selectedOptionOrdinal: 0,
      customerConfirmedAppointment: false,
      knowledgeQuestionKind: kind,
      knowledgeRuleId: rule?.id || "",
      knowledgeSource: rule?.source || (kind === "duration" ? "erp_duration" : "manual"),
    },
  };
}

async function resolveKnowledgeReply(body) {
  if (body?.commitAppointment === true) return { route: "schedule" };
  const conversation = body?.conversation || {};
  const latestText = latestCustomerText(conversation);
  if (!latestText || isSchedulingTurn(latestText)) return { route: "schedule" };

  const detectedKind = cleanText(body?.questionKind, 80) || detectQuestionKind(latestText);
  if (!detectedKind && !looksLikeQuestion(latestText)) return { route: "schedule" };

  const [presetSnapshot, servicesSnapshot, vansSnapshot, rulesSnapshot] = await Promise.all([
    db.collection("businessSettings").doc("appointment-work-presets").get(),
    db.collection("services").get(),
    db.collection("vans").get(),
    db.collection("whatsappKnowledgeRules").where("active", "==", true).get(),
  ]);

  const presetSettings = presetSnapshot.exists ? presetSnapshot.data() : null;
  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const rules = rulesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const activeVanCount = Math.max(1, vansSnapshot.docs.filter((doc) => doc.data()?.active !== false).length);
  const facts = conversationFacts(conversation);
  const language = languageFromRequest(body, latestText);
  const analysis = {
    intent: facts.serviceType === "installation" ? "installation_request" : "service_request",
    summary: `${facts.serviceType} ${facts.quantity}`,
    collectedInformation: facts,
  };
  const preset = resolvePreset(analysis, presetSettings);

  let rule = bestDeterministicRule(rules, latestText, detectedKind);
  let confidence = rule ? 0.98 : 0;
  let kind = detectedKind || cleanText(rule?.intent, 80);

  if (!rule && detectedKind === "duration") {
    rule = { id: "system-duration", intent: "duration", source: "erp_duration", active: true };
    kind = "duration";
    confidence = 1;
  }

  if (!rule) {
    const classified = await classifyAgainstRules(latestText, facts, rules);
    if (classified.route === "schedule") return { route: "schedule" };
    if (classified.route === "rule") {
      rule = rules.find((item) => item.id === classified.ruleId) || null;
      confidence = Number(classified.confidence || 0);
      kind = cleanText(rule?.intent, 80) || detectedKind;
    }
  }

  if (!rule) {
    return {
      route: "knowledge",
      payload: responsePayload({
        draft: safeHumanAnswer(language),
        language,
        facts,
        kind: detectedKind || "unknown_question",
        rule: null,
        requiresHuman: true,
        warning: "No existe una regla aprobada para esta pregunta en whatsappKnowledgeRules.",
        confidence: 0.5,
      }),
    };
  }

  const draft = await buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount });
  if (!draft) {
    return {
      route: "knowledge",
      payload: responsePayload({
        draft: safeHumanAnswer(language),
        language,
        facts,
        kind,
        rule,
        requiresHuman: true,
        warning: `La regla ${rule.id} no tiene una respuesta aprobada o el ERP no tiene el dato requerido.`,
        confidence,
      }),
    };
  }

  return {
    route: "knowledge",
    payload: responsePayload({
      draft,
      language,
      facts,
      kind,
      rule,
      requiresHuman: rule.requiresHuman === true,
      warning: rule.requiresHuman === true ? "La regla requiere revisión humana antes de enviar." : "",
      confidence,
    }),
  };
}

exports.whatsappCopilotKnowledge = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 45,
    secrets: [extensionToken, openAiApiKey],
  },
  async (request, response) => {
    setCors(request, response);
    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }
    if (request.method !== "POST") {
      response.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (!safeEqual(bearerToken(request), extensionToken.value())) {
      response.status(401).json({ error: "Token de extensión inválido o ausente." });
      return;
    }
    if (request.body?.mode === "health") {
      response.status(200).json({ ok: true, source: "erp-knowledge-rules", classifierModel: CLASSIFIER_MODEL });
      return;
    }

    try {
      const result = await resolveKnowledgeReply(request.body || {});
      if (result.route === "schedule") {
        response.status(409).json({ route: "schedule", error: "El mensaje corresponde al flujo de agenda." });
        return;
      }
      response.status(200).json(result.payload);
    } catch (error) {
      response.status(500).json({ error: error?.message || "No se pudo consultar la base unificada de reglas del ERP." });
    }
  },
);

module.exports.detectQuestionKind = detectQuestionKind;
module.exports.isSchedulingTurn = isSchedulingTurn;
module.exports.looksLikeQuestion = looksLikeQuestion;
module.exports.resolveKnowledgeReply = resolveKnowledgeReply;
module.exports.ruleScore = ruleScore;
