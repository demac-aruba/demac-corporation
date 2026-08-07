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

function detectQuestionKind(value) {
  const text = normalizeText(value);
  if (/\b(cuanto tiempo|cuanto dura|how long|duration|duracion)\b/.test(text)) return "duration";
  if (/\b(cuanto cuesta|precio|price|cost|tarifa|costo)\b/.test(text)) return "price";
  if (/\b(que incluye|what is included|what does.*include|incluye el servicio)\b/.test(text)) return "service_includes";
  if (/\b(garantia|warranty)\b/.test(text)) return "warranty";
  if (/\b(pago|payment|transferencia|cash|efectivo|tarjeta|card)\b/.test(text)) return "payment";
  if (/\b(que hacen|como funciona|what do you do|how does.*work)\b/.test(text)) return "service_info";
  return "";
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
  if (/\b(how|what|when|where|price|cost|duration|warranty|payment|does|included)\b/.test(text)) return "en";
  if (/\b(con ta|cua opcion|cuanto tempo|ki ora|mi por|bo por|mester|danki|pa bo|tin un|airconan)\b/.test(text)) return "pap-aw";
  return "es";
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

function valueForLanguage(value, language) {
  if (typeof value === "string") return cleanText(value, 1_200);
  if (!value || typeof value !== "object") return "";
  return cleanText(value[language] || value.es || value.en || value["pap-aw"] || "", 1_200);
}

function approvedKnowledgeAnswer(knowledge, kind, language) {
  const sources = [
    knowledge?.answers,
    knowledge?.approvedAnswers,
    knowledge?.customerAnswers,
    knowledge,
  ].filter((item) => item && typeof item === "object");
  const aliases = {
    price: ["price", "pricing", "prices"],
    service_includes: ["service_includes", "serviceIncludes", "included"],
    warranty: ["warranty", "guarantee"],
    payment: ["payment", "paymentMethods", "payments"],
    service_info: ["service_info", "serviceInfo", "services"],
  };
  for (const source of sources) {
    for (const key of aliases[kind] || [kind]) {
      const answer = valueForLanguage(source[key], language);
      if (answer) return answer;
    }
  }
  return "";
}

function serviceDescription(services, preset, language) {
  const normalizedLabel = normalizeText(preset.label);
  const service = services.find((item) => normalizeText(item.name) === normalizedLabel)
    || services.find((item) => normalizeText(`${item.name} ${item.category}`).includes(normalizedLabel));
  if (!service) return "";
  return valueForLanguage(
    service.customerDescription || service.description || service.details,
    language,
  );
}

function unavailableAnswer(kind, language) {
  if (language === "en") {
    if (kind === "price") return "I want to give you the correct current price. Our Operations team will verify it in the ERP before answering.";
    return "Our Operations team will verify that information in the ERP before answering so we do not give you incorrect information.";
  }
  if (language === "pap-aw") {
    if (kind === "price") return "Nos kier duna bo e prijs correcto y actual. Nos team di Operacion lo verifica esaki den ERP prome cu contesta.";
    return "Nos team di Operacion lo verifica e informacion aki den ERP prome cu contesta, pa nos no duna bo informacion robes.";
  }
  if (kind === "price") return "Queremos darle el precio correcto y actualizado. Nuestro equipo de Operaciones lo verificará en el ERP antes de responderle.";
  return "Nuestro equipo de Operaciones verificará esa información en el ERP antes de responderle, para no darle información incorrecta.";
}

async function buildKnowledgeReply({ conversation, kind, language }) {
  const [presetSnapshot, knowledgeSnapshot, servicesSnapshot, vansSnapshot] = await Promise.all([
    db.collection("businessSettings").doc("appointment-work-presets").get(),
    db.collection("businessSettings").doc("whatsapp-copilot-knowledge").get(),
    db.collection("services").get(),
    db.collection("vans").get(),
  ]);
  const presetSettings = presetSnapshot.exists ? presetSnapshot.data() : null;
  const knowledge = knowledgeSnapshot.exists ? knowledgeSnapshot.data() : {};
  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const activeVanCount = Math.max(1, vansSnapshot.docs.filter((doc) => doc.data()?.active !== false).length);
  const facts = conversationFacts(conversation);
  const analysis = {
    intent: facts.serviceType === "installation" ? "installation_request" : "service_request",
    summary: `${facts.serviceType} ${facts.quantity}`,
    collectedInformation: facts,
  };
  const preset = resolvePreset(analysis, presetSettings);

  if (kind === "duration") {
    const quantity = parseQuantity(facts.quantity);
    if (!quantity) {
      return {
        draft: durationText(preset.durationMinutesPerUnit, language, true),
        requiresHuman: false,
        warning: "",
        preset,
      };
    }
    const allocations = distributeUnits(quantity, preset.durationMinutesPerUnit, activeVanCount);
    const estimatedMinutes = allocations.length
      ? Math.max(...allocations.map((allocation) => allocation.quantity * preset.durationMinutesPerUnit))
      : quantity * preset.durationMinutesPerUnit;
    return {
      draft: durationText(estimatedMinutes, language),
      requiresHuman: false,
      warning: "",
      preset,
    };
  }

  let draft = approvedKnowledgeAnswer(knowledge, kind, language);
  if (!draft && ["service_includes", "service_info"].includes(kind)) {
    draft = serviceDescription(services, preset, language);
  }
  if (!draft) {
    return {
      draft: unavailableAnswer(kind, language),
      requiresHuman: true,
      warning: `Falta una respuesta aprobada para ${kind} en businessSettings/whatsapp-copilot-knowledge.`,
      preset,
    };
  }
  return { draft, requiresHuman: false, warning: "", preset };
}

exports.whatsappCopilotKnowledge = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    secrets: [extensionToken],
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

    try {
      const conversation = request.body?.conversation || {};
      const latestText = cleanText(
        conversation?.customerTurn?.text
          || [...(conversation?.messages || [])].reverse().find((item) => item?.direction === "inbound")?.text,
        2_000,
      );
      const kind = cleanText(request.body?.questionKind, 80) || detectQuestionKind(latestText);
      if (!kind) {
        response.status(400).json({ error: "No se identificó una pregunta informativa directa." });
        return;
      }
      const language = languageFromRequest(request.body, latestText);
      const result = await buildKnowledgeReply({ conversation, kind, language });
      const facts = conversationFacts(conversation);
      response.status(200).json({
        draft: result.draft,
        source: "erp-knowledge",
        warning: result.warning,
        metadata: {
          intent: kind === "price" ? "price_question" : "general_question",
          language,
          conversationStage: "general_support",
          nextAction: "wait_for_customer",
          summary: `Pregunta directa: ${kind}`,
          confidence: 1,
          requiresHuman: result.requiresHuman,
          missingInformation: [],
          collectedInformation: facts,
          selectedOptionOrdinal: 0,
          customerConfirmedAppointment: false,
          knowledgeQuestionKind: kind,
          knowledgeSource: kind === "duration"
            ? "businessSettings/appointment-work-presets"
            : "businessSettings/whatsapp-copilot-knowledge",
          presetId: result.preset?.id || "",
        },
      });
    } catch (error) {
      response.status(500).json({ error: error?.message || "No se pudo consultar la base unificada del ERP." });
    }
  },
);

module.exports.detectQuestionKind = detectQuestionKind;
