const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const { whatsappCopilotDraft: schedulingDraft } = require("./whatsappCopilot");
const {
  detectQuestionKind,
  resolveKnowledgeReply,
} = require("./whatsappCopilotKnowledge");
const {
  formatNaturalCustomerReply,
  immediateReply,
  isAvailabilityTurn,
  latestCustomerText,
} = require("./whatsappCopilotConversationPolicy");
const {
  handleStatefulSchedulingV22,
  isSchedulingControlTurnV22,
} = require("./whatsappCopilotStateMachineV22");

const extensionToken = defineSecret("WHATSAPP_COPILOT_EXTENSION_TOKEN");
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const RUNTIME = {
  functionName: "whatsappCopilotDraft",
  source: "openai+erp-conversation-orchestrator-v18-flow-v22",
  version: 18,
  flowVersion: 22,
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

function schedulingCapture() {
  const state = { statusCode: 200, body: undefined, responseType: "json" };
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

function runtimeMetadata(extra = {}) {
  return { ...RUNTIME, ...extra };
}

function sendCaptured(response, captured, route) {
  const body = captured.body;
  if (body && typeof body === "object" && typeof body.draft === "string") {
    body.draft = formatNaturalCustomerReply(body.draft, body?.metadata?.language || "es");
  }
  if (body && typeof body === "object") {
    body.runtime = runtimeMetadata({ route });
    body.metadata = {
      ...(body.metadata || {}),
      currentTurnPolicy: "authoritative-v18",
      conversationFlowVersion: 22,
      orchestratorRoute: route,
    };
  }
  const outgoing = response.status(captured.statusCode);
  if (captured.responseType === "send") outgoing.send(body);
  else outgoing.json(body);
}

function sendDeterministic(response, payload, route) {
  payload.draft = formatNaturalCustomerReply(payload.draft, payload?.metadata?.language || "es");
  payload.runtime = runtimeMetadata({ route });
  payload.metadata = {
    ...(payload.metadata || {}),
    currentTurnPolicy: "authoritative-v18",
    conversationFlowVersion: 22,
    orchestratorRoute: route,
  };
  response.status(200).json(payload);
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
      model: "gpt-5-mini",
      openAiConfigured: Boolean(openAiApiKey.value()),
      erpSchedulingConfigured: true,
      erpKnowledgeConfigured: true,
      conversationPolicyVersion: RUNTIME.version,
      conversationFlowVersion: RUNTIME.flowVersion,
      functionName: RUNTIME.functionName,
      currentTurnPolicy: "authoritative-v18",
    });
    return;
  }

  try {
    const conversation = request.body?.conversation || {};
    const latest = latestCustomerText(conversation);

    // 1) The newest customer turn always wins over history/memory.
    const immediate = immediateReply({
      conversation,
      languageMode: request.body?.languageMode || "auto",
    });
    if (immediate) {
      immediate.runtime = runtimeMetadata({ route: "immediate-current-turn" });
      immediate.metadata = {
        ...(immediate.metadata || {}),
        currentCustomerTurn: latest,
        conversationFlowVersion: 22,
        orchestratorRoute: "immediate-current-turn",
      };
      response.status(200).json(immediate);
      return;
    }

    // 2) Appointment selection is a direct state transition against the active offer.
    //    V22 no longer rewrites "sí" into text that must pass the generic scheduling
    //    classifier. It builds the confirmed analysis itself, then calls the ERP
    //    scheduling transaction directly. This prevents confirmations from falling
    //    back into another availability search.
    if (isSchedulingControlTurnV22(latest) || request.body?.commitAppointment === true) {
      const deterministic = await handleStatefulSchedulingV22(request.body || {});
      if (deterministic) {
        sendDeterministic(response, deterministic, "schedule-stateful-v22");
        return;
      }
    }

    // 3) Availability language that still needs intake interpretation can use OpenAI + ERP.
    if (isAvailabilityTurn(latest) || request.body?.commitAppointment === true) {
      const captured = await runSchedulingDraft(request);
      sendCaptured(response, captured, "schedule");
      return;
    }

    // 4) FAQ rules run only when the CURRENT turn explicitly asks that FAQ.
    const questionKind = detectQuestionKind(latest);
    if (questionKind) {
      const knowledge = await resolveKnowledgeReply({
        ...(request.body || {}),
        questionKind,
      });
      if (knowledge.route === "knowledge") {
        knowledge.payload.draft = formatNaturalCustomerReply(
          knowledge.payload.draft,
          knowledge.payload?.metadata?.language || "es",
        );
        knowledge.payload.runtime = runtimeMetadata({ route: `knowledge:${questionKind}` });
        knowledge.payload.metadata = {
          ...(knowledge.payload.metadata || {}),
          currentCustomerTurn: latest,
          currentTurnPolicy: "authoritative-v18",
          conversationFlowVersion: 22,
          orchestratorRoute: `knowledge:${questionKind}`,
        };
        response.status(200).json(knowledge.payload);
        return;
      }
    }

    // 5) Ordinary conversation/intake continues through the OpenAI + ERP engine.
    const captured = await runSchedulingDraft(request);
    sendCaptured(response, captured, "conversation-intake");
  } catch (error) {
    response.status(500).json({
      error: `No se pudo procesar el flujo unificado del Copilot: ${error?.message || error}`,
      runtime: runtimeMetadata({ route: "error" }),
    });
  }
});

module.exports.RUNTIME = RUNTIME;
