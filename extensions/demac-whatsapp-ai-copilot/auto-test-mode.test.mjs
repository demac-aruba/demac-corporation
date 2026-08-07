import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_TEST_TTL_MS,
  buildAutoTestSession,
  contextMatchesAutoTestSession,
  latestInboundFingerprint,
  shouldAutoReply,
} from "./auto-test-mode.mjs";

const NOW = Date.parse("2026-08-07T13:00:00.000Z");

function context({ title = "Mi número de prueba", direction = "inbound", text = "Necesito servicio", id = "false_2975600000@c.us_ABC" } = {}) {
  return {
    chatTitle: title,
    customerTurn: { text, messageIds: direction === "inbound" ? [id] : [] },
    messages: [
      { id, direction, text },
    ],
  };
}

test("binds automatic mode to one conversation for eight hours", () => {
  const session = buildAutoTestSession(context(), NOW);
  assert.equal(session.enabled, true);
  assert.equal(session.conversationKey, "phone:2975600000");
  assert.equal(Date.parse(session.expiresAt) - NOW, AUTO_TEST_TTL_MS);
});

test("only a new inbound message is eligible for automatic reply", () => {
  const chat = context();
  const session = buildAutoTestSession(chat, NOW);
  const decision = shouldAutoReply(chat, session, NOW + 1000);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "new-inbound");
  assert.ok(decision.fingerprint);

  const outbound = context({ direction: "outbound", text: "Respuesta de DEMAC", id: "true_2975600000@c.us_DEF" });
  assert.equal(shouldAutoReply(outbound, session, NOW + 1000).allowed, false);
});

test("does not answer a different WhatsApp conversation", () => {
  const bound = context({ id: "false_2975600000@c.us_A" });
  const other = context({ title: "Otro cliente", id: "false_2975999999@c.us_B" });
  const session = buildAutoTestSession(bound, NOW);
  assert.equal(contextMatchesAutoTestSession(other, session), false);
  assert.equal(shouldAutoReply(other, session, NOW + 1000).reason, "different-chat");
});

test("deduplicates an inbound turn already sent or currently processing", () => {
  const chat = context();
  const fingerprint = latestInboundFingerprint(chat);
  const base = buildAutoTestSession(chat, NOW);
  assert.equal(shouldAutoReply(chat, { ...base, lastHandledFingerprint: fingerprint }, NOW + 1000).reason, "already-handled");
  assert.equal(shouldAutoReply(chat, { ...base, processingFingerprint: fingerprint }, NOW + 1000).reason, "already-processing");
});

test("automatic mode expires", () => {
  const chat = context();
  const session = buildAutoTestSession(chat, NOW);
  assert.equal(shouldAutoReply(chat, session, NOW + AUTO_TEST_TTL_MS + 1).reason, "inactive");
});
