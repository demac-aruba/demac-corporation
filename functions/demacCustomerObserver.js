const { cleanText } = require("./bookingSchedulingPrimitives");

const MAYA_OBSERVER_VERSION = 1;
const DEFAULT_OBSERVER_MODEL = process.env.DEMAC_CUSTOMER_OBSERVER_MODEL || "gpt-5-mini";
const OPERATIONAL_INTENTS = Object.freeze([
  "cancellation",
  "reschedule",
  "customer_withdrew_change",
  "human_request",
  "complaint",
  "operational_change",
  "booking_request",
  "price_request",
  "general",
  "unknown",
]);

const OBSERVATION_TOOL = Object.freeze({
  type: "function",
  name: "record_customer_observation",
  description: "Record only the operational meaning of the customer's current communication. This tool never sends a customer reply and never mutates ERP business records.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [
      "intent",
      "confidence",
      "language",
      "summary",
      "requiresAttention",
      "dispatchRisk",
      "reasonAlreadyProvided",
      "reason",
      "appointmentReference",
      "requestedDate",
      "requestedTime",
      "criticalValueAmbiguous",
    ],
    properties: {
      intent: { type: "string", enum: OPERATIONAL_INTENTS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      language: { type: "string", enum: ["pap-aw", "es", "en", "unknown"] },
      summary: { type: "string" },
      requiresAttention: { type: "boolean" },
      dispatchRisk: { type: "boolean" },
      reasonAlreadyProvided: { type: "boolean" },
      reason: { type: "string" },
      appointmentReference: { type: "string" },
      requestedDate: { type: "string" },
      requestedTime: { type: "string" },
      criticalValueAmbiguous: { type: "boolean" },
    },
  },
});

function observerInstructions() {
  return [
    "You are the read-only Maya operational Observer for DEMAC Professional Cooling Solutions in Aruba.",
    "Classify the meaning of new customer communications. Do not write a customer response, do not book, cancel, reschedule, price, or mutate anything.",
    "Cancellation means the customer clearly wants an existing appointment cancelled. Reschedule means the customer wants the appointment moved or asks for another date/time instead of permanent cancellation.",
    "customer_withdrew_change means the customer explicitly reverses a prior cancellation/reschedule request and wants the existing appointment kept.",
    "operational_change includes address/access/location/timing information that can affect today's or an upcoming dispatch.",
    "dispatchRisk should be true only when the communication may make an upcoming appointment unsafe to dispatch as currently planned, especially cancellation/reschedule/access restrictions.",
    "If a critical value such as date, time, address, quantity, appointment identity, permanent cancellation, or authorization is materially unclear, set criticalValueAmbiguous=true.",
    "Do not treat weak wording as permanent cancellation. Lower confidence and require attention when meaning is uncertain.",
    "Preserve the customer's language. Aruba Papiamento is pap-aw, not Curaçao Papiamentu.",
    "Use only the supplied customer-turn content. Never infer hidden facts.",
    "You MUST call record_customer_observation exactly once.",
  ].join("\n");
}

function parseToolArguments(call = {}) {
  try {
    return JSON.parse(call.arguments || "{}");
  } catch {
    throw new Error("Maya Observer returned invalid function arguments.");
  }
}

function observationFromResponse(response = {}) {
  const calls = (Array.isArray(response.output) ? response.output : [])
    .filter((item) => item?.type === "function_call" && item?.name === OBSERVATION_TOOL.name);
  if (calls.length !== 1) throw new Error("Maya Observer must return exactly one observation function call.");
  const raw = parseToolArguments(calls[0]);
  const intent = OPERATIONAL_INTENTS.includes(raw.intent) ? raw.intent : "unknown";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return {
    intent,
    confidence,
    language: ["pap-aw", "es", "en"].includes(raw.language) ? raw.language : "unknown",
    summary: cleanText(raw.summary, 800),
    requiresAttention: raw.requiresAttention === true,
    dispatchRisk: raw.dispatchRisk === true,
    reasonAlreadyProvided: raw.reasonAlreadyProvided === true,
    reason: cleanText(raw.reason, 500),
    appointmentReference: cleanText(raw.appointmentReference, 300),
    requestedDate: cleanText(raw.requestedDate, 80),
    requestedTime: cleanText(raw.requestedTime, 80),
    criticalValueAmbiguous: raw.criticalValueAmbiguous === true,
  };
}

async function defaultObserverModelClient({ apiKey, text, model = DEFAULT_OBSERVER_MODEL, fetchImpl = fetch } = {}) {
  if (!cleanText(apiKey, 8_000)) throw new Error("OpenAI API key is required for Maya Observer.");
  const customerText = cleanText(text, 8_000);
  if (!customerText) throw new Error("Maya Observer requires customer content.");
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: observerInstructions(),
      input: [{ role: "user", content: customerText }],
      tools: [OBSERVATION_TOOL],
      tool_choice: { type: "function", name: OBSERVATION_TOOL.name },
      parallel_tool_calls: false,
      reasoning: { effort: "low" },
      max_output_tokens: 900,
      store: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI returned HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code || response.status;
    throw error;
  }
  return payload;
}

function createMayaCustomerObserver({ modelClient = defaultObserverModelClient, model = DEFAULT_OBSERVER_MODEL } = {}) {
  async function observe({ apiKey, text } = {}) {
    const response = await modelClient({ apiKey, text, model });
    return {
      ...observationFromResponse(response),
      observerVersion: MAYA_OBSERVER_VERSION,
      model,
    };
  }
  return { observe, version: MAYA_OBSERVER_VERSION };
}

module.exports = {
  DEFAULT_OBSERVER_MODEL,
  MAYA_OBSERVER_VERSION,
  OBSERVATION_TOOL,
  OPERATIONAL_INTENTS,
  createMayaCustomerObserver,
  defaultObserverModelClient,
  observationFromResponse,
  observerInstructions,
};
