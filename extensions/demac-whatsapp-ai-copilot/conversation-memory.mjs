const STORAGE_KEY = "demacWhatsAppConversationMemoryV1";
const MEMORY_MESSAGE_ID = "__demac_copilot_memory__";
const MAX_MEMORY_ENTRIES = 100;

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeText(value) {
  return cleanText(value, 2_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeClock(value) {
  const text = String(value ?? "");
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = String(match[3] ?? "").toLowerCase();
  if (suffix.includes("p") && hour < 12) hour += 12;
  if (suffix.includes("a") && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractTimePreference(text) {
  const raw = cleanText(text, 500);
  const normalized = normalizeText(raw);
  const time = normalizeClock(raw);
  if (time && /\b(after|later than|despues|posterior|luego de|mas tarde de)\b/.test(normalized)) {
    return `after ${time}`;
  }
  if (time && /\b(from|starting at|a partir de|desde)\b/.test(normalized)) {
    return `from ${time}`;
  }
  if (time && /\b(before|earlier than|antes de)\b/.test(normalized)) {
    return `before ${time}`;
  }
  if (time && /\b(until|hasta)\b/.test(normalized)) {
    return `until ${time}`;
  }
  if (/\b(afternoon|tarde|merdia)\b/.test(normalized)) return "afternoon";
  if (/\b(morning|mainta)\b/.test(normalized)) return "morning";
  return "";
}

function cleanAddressCandidate(value) {
  let candidate = cleanText(value, 140)
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "")
    .replace(/\s+(?:y|and)\s+(?:son|tengo|necesito|it is|there are)\b.*$/i, "")
    .trim();
  if (/^(aqui|acá|here|ahi|allí)$/i.test(candidate)) candidate = "";
  if (!/[a-zA-ZÀ-ÿ]/.test(candidate)) candidate = "";
  return candidate;
}

function extractAddress(text) {
  const raw = cleanText(text, 500);
  const directPatterns = [
    /(?:la\s+)?direcci[oó]n\s*(?:es|esta|está|:)?\s+(.+)$/i,
    /\baddress\s*(?:is|:)?\s+(.+)$/i,
    /\badres\s*(?:ta|:)?\s+(.+)$/i,
  ];
  for (const pattern of directPatterns) {
    const match = raw.match(pattern);
    const candidate = cleanAddressCandidate(match?.[1]);
    if (candidate) return candidate;
  }

  const embedded = raw.match(/\b(?:en|na)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'\-]{1,70}\s+\d+[A-Za-z0-9\-]*)\b/i);
  return cleanAddressCandidate(embedded?.[1]);
}

function extractQuantity(text) {
  const raw = cleanText(text, 500);
  const match = raw.match(/\b(\d{1,2})\s*(?:aires?|airco(?:nan)?|a\.?c\.?\s*units?)\b/i);
  return match ? String(Math.max(1, Math.min(40, Number(match[1])))) : "";
}

function extractServiceType(text) {
  const normalized = normalizeText(text);
  if (/\b(install|installation|instalacion|instala)\b/.test(normalized)) return "installation";
  if (/\b(repair|reparacion|repara|checkup|diagnostic|diagnostico)\b/.test(normalized)) return "repair";
  if (/\b(service|servicio|mantenimiento|cleaning|limpieza)\b/.test(normalized)) return "service";
  return "";
}

function extractRequestedDate(text) {
  const raw = cleanText(text, 500);
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso?.[1] || "";
}

export function conversationMemoryKey(context) {
  for (const message of context?.messages || []) {
    const match = String(message?.id || "").match(/(?:^|_)(\d{7,20})@(c\.us|s\.whatsapp\.net)(?:_|$)/i);
    if (match) return `phone:${match[1]}`;
  }
  const title = normalizeText(context?.chatTitle).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return title ? `chat:${title}` : "chat:unknown";
}

export function extractConversationFacts(context) {
  const facts = {};
  const inbound = (context?.messages || []).filter((message) => message?.direction === "inbound");
  for (const message of inbound) {
    const text = message?.text || "";
    const serviceType = extractServiceType(text);
    const quantity = extractQuantity(text);
    const address = extractAddress(text);
    const preferredTime = extractTimePreference(text);
    const requestedDate = extractRequestedDate(text);
    if (serviceType) facts.serviceType = serviceType;
    if (quantity) facts.quantity = quantity;
    if (address) facts.address = address;
    if (preferredTime) facts.preferredTime = preferredTime;
    if (requestedDate) facts.requestedDate = requestedDate;
  }
  return facts;
}

export function mergeConversationFacts(previous = {}, current = {}) {
  const merged = { ...previous };
  for (const key of ["serviceType", "quantity", "address", "preferredTime", "requestedDate", "customerName"]) {
    const value = cleanText(current?.[key], key === "address" ? 140 : 120);
    if (value) merged[key] = value;
  }
  return merged;
}

function memoryText(facts) {
  const fields = [];
  if (facts.serviceType) fields.push(`serviceType=${facts.serviceType}`);
  if (facts.quantity) fields.push(`quantity=${facts.quantity}`);
  if (facts.address) fields.push(`address=${facts.address}`);
  if (facts.preferredTime) fields.push(`preferredTime=${facts.preferredTime}`);
  if (facts.requestedDate) fields.push(`requestedDate=${facts.requestedDate}`);
  if (!fields.length) return "";
  return [
    "NOTA INTERNA DEMAC — no enviar ni mencionar al cliente.",
    `Datos ya confirmados por el cliente: ${fields.join("; ")}.`,
    "No vuelvas a pedir estos datos.",
    "La fecha u hora indicada por el cliente es una restricción obligatoria: nunca ofrezcas una opción incompatible.",
  ].join(" ");
}

export function injectConversationMemory(context, facts) {
  const note = memoryText(facts);
  if (!note) return { ...(context || {}) };
  const messages = (context?.messages || []).filter((message) => message?.id !== MEMORY_MESSAGE_ID);
  return {
    ...(context || {}),
    messages: [{
      id: MEMORY_MESSAGE_ID,
      direction: "outbound",
      sender: "DEMAC",
      text: note,
    }, ...messages],
    confirmedFacts: { ...facts },
  };
}

async function readMemory(storage) {
  const stored = await storage.get(STORAGE_KEY);
  const value = stored?.[STORAGE_KEY];
  return value && typeof value === "object" ? value : {};
}

async function writeMemory(storage, memory) {
  const entries = Object.entries(memory)
    .sort(([, left], [, right]) => String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || "")))
    .slice(0, MAX_MEMORY_ENTRIES);
  await storage.set({ [STORAGE_KEY]: Object.fromEntries(entries) });
}

export async function prepareConversationContext(context, storage) {
  const key = conversationMemoryKey(context);
  const memory = await readMemory(storage);
  const current = extractConversationFacts(context);
  const facts = mergeConversationFacts(memory[key]?.facts, current);
  memory[key] = { facts, chatTitle: cleanText(context?.chatTitle, 160), updatedAt: new Date().toISOString() };
  await writeMemory(storage, memory);
  return { key, facts, context: injectConversationMemory(context, facts) };
}

export async function learnConversationMemory(key, currentFacts, metadata, storage) {
  if (!key) return;
  const collected = metadata?.collectedInformation || {};
  const learned = {
    serviceType: collected.serviceType,
    quantity: collected.quantity,
    address: collected.address,
    preferredTime: collected.preferredTime || collected.requestedTime,
    requestedDate: collected.requestedDate || collected.preferredDate,
    customerName: collected.customerName,
  };
  const memory = await readMemory(storage);
  const facts = mergeConversationFacts(
    mergeConversationFacts(memory[key]?.facts, currentFacts),
    learned,
  );
  memory[key] = { ...(memory[key] || {}), facts, updatedAt: new Date().toISOString() };
  await writeMemory(storage, memory);
}

export { STORAGE_KEY };
