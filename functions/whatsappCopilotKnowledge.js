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
const {
  formatDurationReply,
  formatPriceReply,
  resolvePricingContext,
} = require("./demacServicePricingRules");
const {
  formatNaturalCustomerReply,
  isAvailabilityTurn,
  isKnowledgeRejectionTurn,
  latestCustomerText,
} = require("./whatsappCopilotConversationPolicy");

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

function normalizedQuestion(value) {
  return normalizeText(value)
    .replace(/[!¡?¿.,;:()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectQuestionKind(value) {
  const text = normalizedQuestion(value);
  if (!text || isKnowledgeRejectionTurn(value)) return "";

  if (/\b(cuanto tiempo|cuanto dura|cuantas horas|se demora|tarda|durara|how long|how many hours|duration of|cuanto tempo|tempo e servicio ta dura)\b/.test(text)
    || /^(duracion|duration|tempo)$/.test(text)) return "duration";
  if (/\b(cuanto cuesta|cuanto sale|que precio|cual es el precio|precio de|precios|mismo precio|igual precio|varia el precio|precio varia|price of|prices|same price|price vary|how much|cost of|cuanto ta costa|prijs di|mesun prijs|prijs ta varia|prijsnan)\b/.test(text)
    || /^(precio|price|cost|prijs)$/.test(text)) return "price";
  if (/\b(que incluye|what is included|what does .* include|incluye el servicio|kiko ta inclui)\b/.test(text)) return "service_includes";
  if (/\b(garantia|warranty)\b/.test(text)) return "warranty";
  if (/\b(metodo de pago|formas de pago|como puedo pagar|aceptan transferencia|pagar en efectivo|payment method|how can i pay|bank transfer|cash payment|con mi por paga|transferencia|cash)\b/.test(text)) return "payment";
  if (/\b(area de servicio|hasta donde|service area|donde trabajan|unda boso ta traha)\b/.test(text)) return "service_area";
  if (/\b(cancelar|cancelacion|reprogramar|cambiar la cita|reschedule|cancel)\b/.test(text)) return "cancellation_reschedule";
  if (/\b(que debo hacer antes|preparar antes|preparation|antes del servicio)\b/.test(text)) return "preparation";
  if (/\b(cada cuanto|frecuencia|how often|maintenance frequency)\b/.test(text)) return "maintenance_frequency";
  if (/\b(emergencia|emergency|urgente|urgent)\b/.test(text)) return "emergency_service";
  if (/\b(invoice|factura|estimate|estimado|cotizacion|quotation)\b/.test(text)) return "invoice_estimate";
  if (/\b(que hacen|como funciona el servicio|what do you do|how does .* work|informacion del servicio)\b/.test(text)) return "service_info";
  return "";
}

function isSchedulingTurn(value) {
  const text = normalizedQuestion(value);
  if (!text) return true;
  if (isAvailabilityTurn(value)) return true;
  if (isKnowledgeRejectionTurn(value)) return true;
  return /\b(opcion 1|opcion 2|opcion uno|opcion dos|la primera|la segunda|ese horario|esa hora|puedo despues|puedo antes|disponible despues|disponible antes|quiero cita|agendar|reservar|que me puedes ofrecer|otro dia|otra hora|a las \d{1,2})\b/.test(text)
    && !detectQuestionKind(text);
}

function looksLikeQuestion(value) {
  const text = normalizedQuestion(value);
  if (!text || isKnowledgeRejectionTurn(value)) return false;
  return String(value || "").includes("?")
    || /^(que|cuanto|como|cuando|donde|cual|puedo|tienen|tiene|how|what|when|where|which|do you|can you|is there|con|kiko|unda|ki ora)\b/.test(text)
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
  if (/\b(con ta|cua|kiko|unda|cuanto tempo|prijs|mi kier|bo por|bon dia|bon tardi)\b/.test(text)) return "pap-aw";
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
  if (language === "en") return perUnit
    ? `A standard service takes approximately ${display} hour${hours === 1 ? "" : "s"} per AC unit.`
    : `The service takes approximately ${display} hour${hours === 1 ? "" : "s"}.`;
  if (language === "pap-aw") return perUnit
    ? `Un servicio standard ta dura aproximadamente ${display} ora pa cada airco.`
    : `E servicio ta dura aproximadamente ${display} ora.`;
  return perUnit
    ? `Un servicio estándar dura aproximadamente ${display} hora${hours === 1 ? "" : "s"} por aire.`
    : `El servicio dura aproximadamente ${display} hora${hours === 1 ? "" : "s"}.`;
}

function tokens(value) {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 2));
}

function ruleScore(rule, latestText, detectedKind) {
  if (rule.active === false) return -1;
  const text = normalizeText(latestText);
  const triggers = Array.isArray(rule.triggerPhrases) ? rule.triggerPhrases : [];
  let relevance = 0;

  if (detectedKind && normalizeText(rule.intent) === normalizeText(detectedKind)) relevance += 220;
  for (const phrase of triggers) {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) continue;
    if (text.includes(normalizedPhrase)) relevance += 180 + normalizedPhrase.length;
    const phraseTokens = tokens(normalizedPhrase);
    const textTokens = tokens(text);
    let overlap = 0;
    for (const token of phraseTokens) if (textTokens.has(token)) overlap += 1;
    if (phraseTokens.size && overlap > 0) relevance += Math.round((overlap / phraseTokens.size) * 70);
  }

  // Priority is only a tie-breaker after the current turn actually matches.
  if (relevance <= 0) return -1;
  return relevance + Math.max(0, Math.min(100, Number(rule.priority || 0))) / 10;
}

function bestDeterministicRule(rules, latestText, detectedKind) {
  const ranked = rules
    .map((rule) => ({ rule, score: ruleScore(rule, latestText, detectedKind) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 60 ? ranked[0].rule : null;
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
  if (!openAiApiKey.value() || !rules.length || !looksLikeQuestion(latestText)) {
    return { route: "schedule", ruleId: "", confidence: 0 };
  }
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
        "Classify ONLY the customer's latest message.",
        "Ignore earlier questions when deciding the current intent.",
        "Choose route=rule only when an approved rule directly answers the latest message.",
        "Choose route=schedule for availability, appointment selection, appointment changes, ordinary service intake, greetings, corrections, or non-FAQ statements.",
        "Choose route=human for a genuine FAQ question that has no approved rule.",
        "Never select a rule merely because it has high priority.",
        "Never invent a ruleId.",
      ].join(" "),
      input: JSON.stringify({ latestCustomerText: latestText, confirmedFacts: facts, allowedRules }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_knowledge_rule_classifier_v18",
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
  if (!response.ok) return { route: "schedule", ruleId: "", confidence: 0 };
  const parsed = JSON.parse(outputText(payload) || "{}");
  if (parsed.route === "rule" && !rules.some((rule) => rule.id === parsed.ruleId)) {
    return { route: "human", ruleId: "", confidence: 0 };
  }
  if (parsed.route === "rule" && Number(parsed.confidence || 0) < 0.82) {
    return { route: "human", ruleId: "", confidence: Number(parsed.confidence || 0) };
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
  if (language === "en") return `The current price is Afl. ${amount.toFixed(2)}.`;
  if (language === "pap-aw") return `E prijs actual ta Afl. ${amount.toFixed(2)}.`;
  return `El precio actual es Afl. ${amount.toFixed(2)}.`;
}

function safeHumanAnswer(language) {
  if (language === "en") return "I want to give you the correct information. Our Operations team will review this question and reply shortly.";
  if (language === "pap-aw") return "Nos kier duna bo e informacion correcto. Nos team di Operacion lo revisa e pregunta y contesta bo pronto.";
  return "Queremos darle la información correcta. Nuestro equipo de Operaciones revisará esta pregunta y le responderá en breve.";
}

async function buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount, operationalRules, pricingRules, conversation, latestText }) {
  const source = cleanText(rule?.source, 80) || "manual";
  const intent = cleanText(rule?.intent, 80);
  if (source === "erp_duration" || intent === "duration") {
    const pricingContext = resolvePricingContext({ pricingRules, conversation, latestText, facts });
    const natural = formatDurationReply(pricingContext, language, parseQuantity(facts.quantity));
    if (natural) return natural;

    const quantity = parseQuantity(facts.quantity);
    if (!quantity) return durationText(preset.durationMinutesPerUnit, language, true);
    const allocations = distributeUnits(quantity, preset.durationMinutesPerUnit, activeVanCount, operationalRules, preset);
    const estimatedMinutes = allocations.length
      ? Math.max(...allocations.map((allocation) => allocation.quantity * preset.durationMinutesPerUnit))
      : quantity * preset.durationMinutesPerUnit;
    return durationText(estimatedMinutes, language);
  }

  const service = findService(services, preset, facts);
  if (source === "erp_service_description") {
    return valueForLanguage(service?.customerDescription || service?.description || service?.details, language);
  }
  // Price questions always use the dedicated ERP pricing matrix first. This avoids
  // a generic service record (for example Afl. 135) overriding BTU-specific rules.
  if (source === "erp_service_price" || intent === "price") {
    const pricingContext = resolvePricingContext({ pricingRules, conversation, latestText, facts });
    return formatPriceReply(pricingContext, language) || servicePriceText(service, language);
  }

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
  const inferredSource = kind === "duration"
    ? "erp_duration"
    : kind === "price"
      ? "erp_service_price"
      : "manual";
  return {
    draft: formatNaturalCustomerReply(draft, language),
    source: "erp-knowledge-rules-v18",
    warning: warning || "",
    metadata: {
      intent: kind || "knowledge_question",
      language,
      conversationStage: "answering_question",
      nextAction: requiresHuman ? "transfer_human" : "wait_for_customer",
      summary: "Se respondió la pregunta actual usando información autoritativa configurada en DEMAC.",
      confidence,
      requiresHuman: Boolean(requiresHuman),
      missingInformation: [],
      collectedInformation: facts,
      selectedOptionOrdinal: 0,
      customerConfirmedAppointment: false,
      knowledgeQuestionKind: kind,
      knowledgeRuleId: rule?.id || "",
      knowledgeSource: rule?.source || inferredSource,
      currentTurnPolicy: "authoritative",
    },
  };
}

async function resolveKnowledgeReply(body) {
  if (body?.commitAppointment === true) return { route: "schedule" };
  const conversation = body?.conversation || {};
  const latestText = latestCustomerText(conversation);
  if (!latestText || isSchedulingTurn(latestText) || isKnowledgeRejectionTurn(latestText)) return { route: "schedule" };

  const detectedKind = cleanText(body?.questionKind, 80) || detectQuestionKind(latestText);
  const currentLooksLikeQuestion = looksLikeQuestion(latestText);
  if (!detectedKind && !currentLooksLikeQuestion) return { route: "schedule" };

  const [presetSnapshot, operationalSnapshot, pricingSnapshot, servicesSnapshot, vansSnapshot, rulesSnapshot] = await Promise.all([
    db.collection("businessSettings").doc("appointment-work-presets").get(),
    db.collection("businessSettings").doc("company-operational-rules").get(),
    db.collection("businessSettings").doc("company-service-pricing-rules").get(),
    db.collection("services").get(),
    db.collection("vans").get(),
    db.collection("whatsappKnowledgeRules").where("active", "==", true).get(),
  ]);

  const presetSettings = presetSnapshot.exists ? presetSnapshot.data() : null;
  const operationalRules = operationalSnapshot.exists ? operationalSnapshot.data() : null;
  const pricingRules = pricingSnapshot.exists ? pricingSnapshot.data() : null;
  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const rules = rulesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const activeVanCount = Math.max(1, vansSnapshot.docs.filter((doc) => doc.data()?.active !== false).length);
  const facts = conversationFacts(conversation);
  const language = languageFromRequest(body, latestText);
  const analysis = {
    intent: facts.serviceType === "installation" ? "installation_request" : facts.serviceType === "repair" ? "repair_request" : "service_request",
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
  if (!rule && detectedKind === "price") {
    rule = { id: "system-price", intent: "price", source: "erp_service_price", active: true };
    kind = "price";
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

  const draft = await buildRuleAnswer({
    rule,
    language,
    preset,
    facts,
    services,
    activeVanCount,
    operationalRules,
    pricingRules,
    conversation,
    latestText,
  });
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
      response.status(200).json({ ok: true, source: "erp-knowledge-rules-v18", classifierModel: CLASSIFIER_MODEL });
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