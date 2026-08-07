import "./auto-storage-shim.mjs";
import { conversationMemoryKey } from "./conversation-memory.mjs";

export const AUTO_TEST_TTL_MS = 8 * 60 * 60 * 1000;

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function latestMessage(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  return messages.length ? messages[messages.length - 1] : null;
}

export function latestInboundFingerprint(context) {
  const last = latestMessage(context);
  if (!last || last.direction !== "inbound") return "";
  const key = conversationMemoryKey(context);
  const groupedIds = Array.isArray(context?.customerTurn?.messageIds)
    ? context.customerTurn.messageIds.filter(Boolean).join(",")
    : "";
  return [
    key,
    cleanText(last.id, 180),
    groupedIds,
    cleanText(context?.customerTurn?.text || last.text, 1000),
  ].join("|");
}

export function buildAutoTestSession(context, now = Date.now()) {
  const key = conversationMemoryKey(context);
  if (!key || key === "chat:unknown") {
    throw new Error("No se pudo identificar de forma segura la conversación de prueba.");
  }
  return {
    enabled: true,
    conversationKey: key,
    chatTitle: cleanText(context?.chatTitle, 160) || "Chat de prueba",
    enabledAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AUTO_TEST_TTL_MS).toISOString(),
    lastHandledFingerprint: "",
    processingFingerprint: "",
    lastEvent: "Modo automático de prueba activado.",
    lastEventAt: new Date(now).toISOString(),
  };
}

export function isAutoTestSessionActive(session, now = Date.now()) {
  if (!session?.enabled || !session?.conversationKey) return false;
  const expiresAt = Date.parse(session.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function contextMatchesAutoTestSession(context, session) {
  return Boolean(session?.conversationKey)
    && conversationMemoryKey(context) === session.conversationKey;
}

export function shouldAutoReply(context, session, now = Date.now()) {
  if (!isAutoTestSessionActive(session, now)) return { allowed: false, reason: "inactive", fingerprint: "" };
  if (!contextMatchesAutoTestSession(context, session)) return { allowed: false, reason: "different-chat", fingerprint: "" };
  const fingerprint = latestInboundFingerprint(context);
  if (!fingerprint) return { allowed: false, reason: "latest-message-not-inbound", fingerprint: "" };
  if (fingerprint === session.lastHandledFingerprint) return { allowed: false, reason: "already-handled", fingerprint };
  if (fingerprint === session.processingFingerprint) return { allowed: false, reason: "already-processing", fingerprint };
  return { allowed: true, reason: "new-inbound", fingerprint };
}

export function autoTestStatus(session, now = Date.now()) {
  const active = isAutoTestSessionActive(session, now);
  return {
    enabled: active,
    conversationKey: active ? session.conversationKey : "",
    chatTitle: active ? session.chatTitle : "",
    enabledAt: active ? session.enabledAt : "",
    expiresAt: active ? session.expiresAt : "",
    lastEvent: session?.lastEvent || "",
    lastEventAt: session?.lastEventAt || "",
    processing: Boolean(active && session.processingFingerprint),
  };
}
