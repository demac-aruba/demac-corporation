const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { orchestrateScheduling } = require("./whatsappCopilotScheduling");
const { resolveKnowledgeReply } = require("./whatsappCopilotKnowledge");
const { sanitizeRequestBody } = require("./whatsappCopilotSessionContextV20");
const {
  arubaDateParts,
  cleanText,
  hashId,
  normalizeText,
} = require("./whatsappCopilotSchedulingCore");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const AGENT_VERSION = 31;
const PRIMARY_MODEL = "gpt-5.1";
const FALLBACK_MODEL = "gpt-5-mini";
const REASONING_EFFORT = "medium";
const MEMORY_MESSAGE_ID = "__demac_copilot_memory__";

const KNOWLEDGE_KINDS = [
  "",
  "duration",
  "price",
  "service_includes",
  "warranty",
  "payment",
  "service_area",
  "cancellation_reschedule",
  "preparation",
  "maintenance_frequency",
  "emergency_service",
  "invoice_estimate",
  "service_info",
];

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "language",
    "action",
    "serviceType",
    "quantity",
    "address",
    "requestedDate",
    "requestedTime",
    "timePreference",
    "knowledgeKind",
    "selectedOptionOrdinal",
    "customerConfirmedAppointment",
    "requiresHuman",
    "confidence",
    "reply",
    "summary",
    "missingInformation",
  ],
  properties: {
    language: { type: "string", enum: ["es", "en", "pap-aw"] },
    action: {
      type: "string",
      enum: ["reply", "check_availability", "book_appointment", "answer_knowledge", "handoff"],
    },
    serviceType: { type: "string", enum: ["", "service", "installation", "repair"] },
    quantity: { type: "integer", minimum: 0, maximum: 40 },
    address: { type: "string" },
    requestedDate: { type: "string" },
    requestedTime: { type: "string" },
    timePreference: { type: "string" },
    knowledgeKind: { type: "string", enum: KNOWLEDGE_KINDS },
    selectedOptionOrdinal: { type: "integer", minimum: 0, maximum: 3 },
    customerConfirmedAppointment: { type: "boolean" },
    requiresHuman: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reply: { type: "string" },
    summary: { type: "string" },
    missingInformation: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
};

function normalizedConversation(rawBody) {
  const sanitized = sanitizeRequestBody(rawBody || {});
  const conversation = sanitized?.conversation || {};
  const messages = (Array.isArray(conversation.messages) ? conversation.messages : [])
    .filter((message) => message?.text && message?.id !== MEMORY_MESSAGE_ID)
    .slice(-30);
  const latestInbound = [...messages].reverse().find((message) => message.direction === "inbound");
  return {
    body: sanitized,
    conversation: {
      ...conversation,
      messages,
      customerTurn: {
        ...(conversation.customerTurn || {}),
        text: cleanText(conversation.customerTurn?.text || latestInbound?.text, 4_000),
      },
    },
  };
}

function inputMessages(conversation) {
  const items = [];
  for (const message of conversation?.messages || []) {
    const role = message.direction === "inbound"
      ? "user"
      : message.direction === "outbound"
        ? "assistant"
        : "";
    if (!role) continue;
    const text = cleanText(message.text, 2_000);
    if (!text) continue;

    // Responses accepts native user/assistant turns. Keep consecutive WhatsApp
    // bubbles as separate messages because their order/timing is conversationally meaningful.
    items.push({ role, content: text });
  }

  const latest = cleanText(conversation?.customerTurn?.text, 4_000);
  const lastItem = items[items.length - 1];
  if (latest && (!lastItem || lastItem.role !== "user" || cleanText(lastItem.content, 4_000) !== latest)) {
    items.push({ role: "user", content: latest });
  }
  return items;
}

function technicalJidFromMessageId(value) {
  const match = String(value || "").match(/(?:^|_)(\d{5,30})@(c\.us|s\.whatsapp\.net|lid)(?:_|$)/i);
  if (!match) return null;
  return {
    user: match[1],
    domain: match[2].toLowerCase(),
    jid: `${match[1]}@${match[2].toLowerCase()}`,
  };
}

function identityCandidates(conversation) {
  const values = [];
  const phone = cleanText(conversation?.contactPhone, 40).replace(/\D/g, "");
  const jid = cleanText(conversation?.contactJid, 120);
  const title = normalizeText(conversation?.chatTitle);
  if (phone) values.push(phone);
  if (jid) values.push(jid);
  for (const message of conversation?.messages || []) {
    if (message?.direction !== "inbound") continue;
    const technical = technicalJidFromMessageId(message?.id);
    if (!technical) continue;
    // A WhatsApp LID is a stable chat identity but is NOT the customer's phone.
    // Only c.us/s.whatsapp.net numeric users can safely become phone candidates.
    if (technical.domain !== "lid") values.push(technical.user);
    values.push(technical.jid);
    break;
  }
  if (title) values.push(title);
  return [...new Set(values.filter(Boolean))];
}

function offerDocId(key) {
  return `wa-offer-${hashId(key, 32)}`;
}

function usableOffer(offer) {
  if (!offer || offer.status !== "open" || !Array.isArray(offer.options) || !offer.options.length) return false;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return false;
  return true;
}

async function activeOfferForConversation(conversation) {
  const found = [];
  for (const key of identityCandidates(conversation)) {
    const snapshot = await db.collection("whatsappCopilotOffers").doc(offerDocId(key)).get();
    if (!snapshot.exists) continue;
    const offer = { id: snapshot.id, ...snapshot.data() };
    if (usableOffer(offer)) found.push(offer);
  }

  if (!found.length) {
    const title = cleanText(conversation?.chatTitle, 160);
    if (title) {
      const snapshot = await db.collection("whatsappCopilotOffers").where("chatTitle", "==", title).limit(10).get();
      for (const doc of snapshot.docs || []) {
        const offer = { id: doc.id, ...doc.data() };
        if (usableOffer(offer)) found.push(offer);
      }
    }
  }

  return found.sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")))[0] || null;
}

function compactOffer(offer) {
  if (!offer) return null;
  return {
    id: offer.id,
    request: offer.request || {},
    options: (offer.options || []).slice(0, 3).map((option, index) => ({
      ordinal: index + 1,
      id: option.id,
      date: option.date,
      time: option.time,
      endTime: option.endTime,
      address: option.address,
      zone: option.zone,
    })),
    expiresAt: offer.expiresAt || "",
  };
}

function plannerInstructions({ company, operator, languageMode, knownFacts, activeOffer }) {
  const now = arubaDateParts();
  return [
    `You are the primary conversational brain for ${company}, an air-conditioning company in Aruba.`,
    `The responsible department is ${operator}. Aruba local date is ${now.date} and local time is ${now.time}.`,
    "This is a real WhatsApp customer-service conversation. Understand it semantically like a capable human agent, not as a keyword classifier.",
    "Read the full native user/assistant message sequence. The latest user message is the immediate task; earlier turns supply context and resolve short replies such as 'sí', 'esa', 'en la tarde', or 'la primera'.",
    "Never repeat a question whose answer is already clear in the conversation or known facts.",
    "Never restart the intake just because the customer phrases something differently.",
    "Use action=reply for greetings, progressive intake, acknowledgements, clarifying ambiguity, and normal company conversation that requires no authoritative ERP lookup.",
    "Use action=check_availability when service type, quantity and address are known and the customer is asking for, changing, or refining availability. Preserve any day/time restriction the customer just stated.",
    "Use action=book_appointment when the customer clearly accepts or selects an appointment that DEMAC just offered. A short affirmative such as 'sí', 'si ok', 'excelente', 'dale', 'esa', or 'me sirve' confirms the immediately preceding single offered slot. Do not re-open availability after a clear confirmation.",
    "If the last DEMAC message offered exactly one appointment and asked whether it works, a concise affirmative means customerConfirmedAppointment=true and action=book_appointment. Carry the date/time of that offered slot into requestedDate/requestedTime when available from activeOffer or the visible conversation.",
    "If multiple appointment options are genuinely still active and the customer only says 'sí' without identifying one, use action=reply and ask which option; do not guess.",
    "If the customer asks a business-policy question such as duration, price, warranty, payment, inclusions, cancellation, preparation, frequency, emergency service, service area, invoice or estimate, use action=answer_knowledge and set knowledgeKind.",
    "Price/duration follow-ups are semantic questions. For example, '¿todos los aires de diferentes BTU tienen el mismo precio?' is knowledgeKind=price and must not simply repeat the previous single-BTU amount; the ERP knowledge tool will provide the authoritative matrix.",
    "Use action=handoff only for complaints requiring judgment, refunds, threats, unresolved payment disputes, uncertain warranty decisions, explicit demand for a person, or when safe automation is not possible.",
    "The ERP is authoritative for prices, durations, availability, routes, capacity and booking. Never invent those values in reply.",
    "Do not mention OpenAI, AI, prompts, databases, ERP internals, models, routing algorithms, or internal rules to the customer.",
    "Sound natural and concise. Avoid beginning every response with 'Perfecto'. Vary acknowledgements naturally and do not repeat the full service description when the context is already established.",
    "For progressive intake, ask only the smallest useful next question. Usually one question per response; at most two short related questions.",
    "For a simple greeting, greet naturally, ask how you can help, and you may show Servicio y mantenimiento / Instalación / Reparación as short bullets. Then wait.",
    "If the customer selects servicio, ask only for missing quantity and address. If one of those is already known, ask only for the other.",
    "Spanish, English and Papiamento di Aruba are supported. Respond in the language of the latest customer turn unless requestedLanguageMode explicitly forces one.",
    "For Papiamento use Aruba usage, not Curaçao spelling.",
    "requestedDate must be YYYY-MM-DD when a specific date can be resolved; otherwise empty. requestedTime must be HH:mm when a specific start time can be resolved; otherwise empty. timePreference can contain 'morning', 'afternoon', 'after HH:mm', 'from HH:mm', 'before HH:mm', or 'until HH:mm'.",
    "quantity is 0 only when unknown. address is empty only when unknown. Do not confuse a time, quantity, or date with an address.",
    "reply must contain customer-facing text only for action=reply or action=handoff. For ERP-backed actions it can be empty because the authoritative tool result will produce the final text.",
    `Requested language mode: ${languageMode}.`,
    `Known structured facts (may be incomplete; visible conversation wins if they conflict): ${JSON.stringify(knownFacts || {})}`,
    `Current active ERP appointment offer (null if none): ${JSON.stringify(compactOffer(activeOffer))}`,
  ].join("\n");
}

function functionCallArguments(payload) {
  for (const item of payload?.output || []) {
    if (item?.type === "function_call" && item?.name === "decide_customer_turn") {
      return JSON.parse(item.arguments || "{}");
    }
  }
  throw new Error("OpenAI did not return the required decide_customer_turn function call.");
}

async function callPlannerModel({ apiKey, model, instructions, messages }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: REASONING_EFFORT },
      store: false,
      max_output_tokens: 1_200,
      instructions,
      input: messages,
      tools: [{
        type: "function",
        name: "decide_customer_turn",
        description: "Return the single best next conversational action and the structured facts needed to execute it safely.",
        strict: true,
        parameters: DECISION_SCHEMA,
      }],
      tool_choice: { type: "function", name: "decide_customer_turn" },
      parallel_tool_calls: false,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI returned HTTP ${response.status}`);
    error.code = payload?.error?.code || response.status;
    error.status = response.status;
    throw error;
  }
  return functionCallArguments(payload);
}

async function planTurn({ apiKey, instructions, messages }) {
  try {
    return {
      decision: await callPlannerModel({ apiKey, model: PRIMARY_MODEL, instructions, messages }),
      model: PRIMARY_MODEL,
      fallbackUsed: false,
    };
  } catch (primaryError) {
    // Some API projects can have different model entitlements. The fallback keeps
    // production usable while exposing the actual model in metadata/health diagnostics.
    const decision = await callPlannerModel({ apiKey, model: FALLBACK_MODEL, instructions, messages });
    return {
      decision,
      model: FALLBACK_MODEL,
      fallbackUsed: true,
      primaryError: cleanText(primaryError?.message, 300),
    };
  }
}

function mergedDecisionFacts(decision, conversation, activeOffer) {
  const stored = conversation?.confirmedFacts || {};
  const requestFacts = activeOffer?.request || {};
  return {
    serviceType: cleanText(decision.serviceType || stored.serviceType || requestFacts.serviceType, 80),
    quantity: decision.quantity > 0
      ? String(decision.quantity)
      : String(stored.quantity || requestFacts.quantity || ""),
    address: cleanText(decision.address || stored.address || requestFacts.address, 180),
    requestedDate: cleanText(decision.requestedDate, 20),
    requestedTime: cleanText(decision.requestedTime, 20),
    preferredDate: cleanText(decision.requestedDate, 20),
    preferredTime: cleanText(decision.timePreference || decision.requestedTime, 80),
    customerName: cleanText(stored.customerName, 120),
    extraDetails: cleanText(conversation?.customerTurn?.text, 300),
  };
}

function intentForService(serviceType) {
  if (serviceType === "installation") return "installation_request";
  if (serviceType === "repair") return "repair_request";
  return "service_request";
}

function schedulingAnalysis(decision, facts, action, activeOffer) {
  let ordinal = Number(decision.selectedOptionOrdinal || 0);
  if (action === "book_appointment" && ordinal === 0 && activeOffer?.options?.length === 1) ordinal = 1;
  return {
    intent: action === "book_appointment" ? "appointment_question" : intentForService(facts.serviceType),
    language: decision.language || "es",
    conversationStage: action === "book_appointment" ? "appointment_option_selected" : "ready_for_schedule_lookup",
    nextAction: action === "book_appointment" ? "reserve_erp_appointment" : "query_erp_availability",
    summary: cleanText(decision.summary, 400),
    reply: "",
    requiresHuman: false,
    confidence: Number(decision.confidence || 0.9),
    missingInformation: Array.isArray(decision.missingInformation) ? decision.missingInformation : [],
    selectedOptionOrdinal: ordinal,
    customerConfirmedAppointment: action === "book_appointment",
    collectedInformation: facts,
  };
}

function requestIdentity(conversation) {
  const candidates = identityCandidates(conversation);
  const phone = cleanText(conversation?.contactPhone, 40).replace(/\D/g, "")
    || candidates.find((value) => /^\d{7,20}$/.test(value))
    || "";
  const jid = cleanText(conversation?.contactJid, 120)
    || candidates.find((value) => /@(c\.us|s\.whatsapp\.net|lid)$/i.test(value))
    || "";
  return { phone, jid };
}

function schedulingPayload(result, analysis, modelMeta) {
  const offering = ["availability_offered", "appointment_changed_reoffer"].includes(result.action);
  const booked = result.action === "appointment_booked";
  const pending = result.action === "appointment_pending_approval";
  const unavailable = result.action === "availability_unavailable";
  return {
    draft: result.reply,
    source: "openai-native-agent-v31+erp-scheduling",
    warning: result.warning || "",
    metadata: {
      intent: analysis.intent,
      language: analysis.language,
      conversationStage: booked
        ? "appointment_confirmed"
        : pending
          ? "appointment_option_selected"
          : offering
            ? "offering_appointments"
            : unavailable
              ? "human_handoff"
              : "general_support",
      nextAction: pending ? "reserve_erp_appointment" : booked || offering ? "wait_for_customer" : unavailable ? "transfer_human" : "wait_for_customer",
      summary: analysis.summary,
      confidence: analysis.confidence,
      requiresHuman: unavailable,
      missingInformation: analysis.missingInformation,
      collectedInformation: analysis.collectedInformation,
      selectedOptionOrdinal: analysis.selectedOptionOrdinal,
      customerConfirmedAppointment: analysis.customerConfirmedAppointment,
      scheduling: result.metadata || null,
      agentVersion: AGENT_VERSION,
      ...modelMeta,
    },
  };
}

function replyPayload(decision, modelMeta) {
  return {
    draft: cleanText(decision.reply, 3_000),
    source: "openai-native-agent-v31",
    warning: decision.requiresHuman ? "La conversación requiere revisión de Operaciones." : "",
    metadata: {
      intent: decision.action === "handoff" ? "human_requested" : "general_question",
      language: decision.language,
      conversationStage: decision.action === "handoff" ? "human_handoff" : "general_support",
      nextAction: decision.action === "handoff" ? "transfer_human" : "wait_for_customer",
      summary: decision.summary,
      confidence: decision.confidence,
      requiresHuman: decision.action === "handoff" || decision.requiresHuman,
      missingInformation: decision.missingInformation,
      collectedInformation: {
        serviceType: decision.serviceType,
        quantity: decision.quantity ? String(decision.quantity) : "",
        address: decision.address,
        requestedDate: decision.requestedDate,
        requestedTime: decision.requestedTime,
        preferredDate: decision.requestedDate,
        preferredTime: decision.timePreference || decision.requestedTime,
        customerName: "",
        extraDetails: "",
      },
      selectedOptionOrdinal: decision.selectedOptionOrdinal,
      customerConfirmedAppointment: decision.customerConfirmedAppointment,
      agentVersion: AGENT_VERSION,
      ...modelMeta,
    },
  };
}

function missingSchedulingFacts(facts) {
  const missing = [];
  if (!facts.serviceType) missing.push("serviceType");
  if (!facts.quantity) missing.push("quantity");
  if (!facts.address) missing.push("address");
  return missing;
}

function missingFactsReply(language, missing) {
  const names = language === "en"
    ? { serviceType: "the type of service", quantity: "how many AC units", address: "the address" }
    : language === "pap-aw"
      ? { serviceType: "tipo di trabou", quantity: "cuanto airco", address: "e adres" }
      : { serviceType: "el tipo de trabajo", quantity: "cuántos aires son", address: "la dirección" };
  const labels = missing.map((key) => names[key]);
  if (language === "en") return `I can check that for you. I just need ${labels.join(" and ")}.`;
  if (language === "pap-aw") return `Mi por check esey pa bo. Mi falta solamente ${labels.join(" y ")}.`;
  return `Claro, puedo revisarlo. Solo me falta ${labels.join(" y ")}.`;
}

async function runAgentTurn({ rawBody, apiKey, company = "DEMAC Professional Cooling Solutions", operator = "Operaciones" }) {
  const { body, conversation } = normalizedConversation(rawBody);
  if (!conversation.customerTurn?.text) throw new Error("No se encontró el último mensaje del cliente.");

  const activeOffer = await activeOfferForConversation(conversation);
  const knownFacts = conversation.confirmedFacts || {};
  const languageMode = ["auto", "es", "en", "pap-aw"].includes(body?.languageMode) ? body.languageMode : "auto";
  const instructions = plannerInstructions({ company, operator, languageMode, knownFacts, activeOffer });
  const messages = inputMessages(conversation);
  const planned = await planTurn({ apiKey, instructions, messages });
  const decision = planned.decision;
  const modelMeta = {
    model: planned.model,
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    fallbackUsed: planned.fallbackUsed,
    reasoningEffort: REASONING_EFFORT,
    architecture: "ai-first-native-messages+erp-tools",
  };

  if (decision.action === "reply" || decision.action === "handoff") {
    if (!cleanText(decision.reply, 3_000)) {
      decision.reply = decision.language === "en"
        ? "How can I help you today?"
        : decision.language === "pap-aw"
          ? "Con nos por yuda bo awe?"
          : "¿Cómo podemos ayudarle hoy?";
    }
    return replyPayload(decision, modelMeta);
  }

  if (decision.action === "answer_knowledge") {
    const kind = KNOWLEDGE_KINDS.includes(decision.knowledgeKind) ? decision.knowledgeKind : "";
    const knowledge = await resolveKnowledgeReply({ ...body, conversation, questionKind: kind });
    if (knowledge?.route === "knowledge" && knowledge.payload) {
      knowledge.payload.source = "openai-native-agent-v31+erp-knowledge";
      knowledge.payload.metadata = {
        ...(knowledge.payload.metadata || {}),
        agentVersion: AGENT_VERSION,
        ...modelMeta,
      };
      return knowledge.payload;
    }
    decision.reply = decision.language === "en"
      ? "I want to make sure I give you the correct information. Our Operations team will verify that for you."
      : decision.language === "pap-aw"
        ? "Mi kier sigur cu bo haya e informacion corecto. Nos team di Operacion lo verifica esey pa bo."
        : "Quiero asegurarme de darle la información correcta. Nuestro equipo de Operaciones verificará ese dato.";
    decision.requiresHuman = true;
    decision.action = "handoff";
    return replyPayload(decision, modelMeta);
  }

  const facts = mergedDecisionFacts(decision, conversation, activeOffer);
  const missing = missingSchedulingFacts(facts);
  if (missing.length) {
    decision.action = "reply";
    decision.reply = missingFactsReply(decision.language, missing);
    decision.missingInformation = missing;
    return replyPayload(decision, modelMeta);
  }

  const analysis = schedulingAnalysis(decision, facts, decision.action, activeOffer);
  const identity = requestIdentity(conversation);
  const request = {
    chatTitle: cleanText(conversation.chatTitle, 160),
    contactPhone: identity.phone,
    contactJid: identity.jid,
    latestCustomerTurn: cleanText(conversation.customerTurn.text, 300),
  };
  const result = await orchestrateScheduling({
    db,
    request,
    analysis,
    commitAppointment: body?.commitAppointment === true,
  });
  return schedulingPayload(result, analysis, modelMeta);
}

module.exports = {
  AGENT_VERSION,
  DECISION_SCHEMA,
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  REASONING_EFFORT,
  activeOfferForConversation,
  compactOffer,
  functionCallArguments,
  identityCandidates,
  inputMessages,
  mergedDecisionFacts,
  normalizedConversation,
  plannerInstructions,
  replyPayload,
  requestIdentity,
  runAgentTurn,
  schedulingAnalysis,
  schedulingPayload,
  technicalJidFromMessageId,
};
