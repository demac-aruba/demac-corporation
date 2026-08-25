const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) {
  initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });
}

const {
  conversationIngressState,
  outboundQueueAccountMatches,
} = require("./whatsappWacliGateway");

test("new inbound WhatsApp conversations start under AI ownership", () => {
  const state = conversationIngressState({ current: {}, exists: false, inbound: true });
  assert.deepEqual(state, {
    queue: "general",
    status: "new",
    owner: null,
    ownerUserId: null,
    routeReason: null,
    aiDisposition: "ai_active",
    lockedBy: null,
    lockedByUserId: null,
  });
});

test("existing semantic queue and AI ownership are preserved without text classification", () => {
  const state = conversationIngressState({
    exists: true,
    inbound: true,
    current: {
      queue: "finance",
      status: "waiting_customer",
      aiDisposition: "ai_active",
      routeReason: "Customer Agent routed payment question to Finance.",
    },
  });
  assert.equal(state.queue, "finance");
  assert.equal(state.status, "waiting_customer");
  assert.equal(state.aiDisposition, "ai_active");
  assert.equal(state.routeReason, "Customer Agent routed payment question to Finance.");
});

test("existing human ownership always wins over AI-first defaults", () => {
  const state = conversationIngressState({
    exists: true,
    inbound: true,
    current: {
      queue: "complaints",
      status: "escalated",
      aiDisposition: "ai_active",
      owner: "Operations",
      ownerUserId: "operator-1",
      lockedByUserId: "operator-1",
      routeReason: "Human complaint review",
    },
  });
  assert.equal(state.queue, "complaints");
  assert.equal(state.status, "escalated");
  assert.equal(state.aiDisposition, "human_active");
  assert.equal(state.ownerUserId, "operator-1");
  assert.equal(state.lockedByUserId, "operator-1");
});

test("paused or handoff-pending conversations are not silently reactivated", () => {
  assert.equal(conversationIngressState({
    exists: true,
    inbound: true,
    current: { aiDisposition: "ai_paused", queue: "technical", status: "waiting_demac" },
  }).aiDisposition, "ai_paused");
  assert.equal(conversationIngressState({
    exists: true,
    inbound: true,
    current: { aiDisposition: "handoff_pending", queue: "sales", status: "escalated" },
  }).aiDisposition, "handoff_pending");
});

test("new outbound-only conversations remain human-owned", () => {
  const state = conversationIngressState({ current: {}, exists: false, inbound: false });
  assert.equal(state.queue, "general");
  assert.equal(state.status, "waiting_customer");
  assert.equal(state.aiDisposition, "human_active");
});

test("outbound polling is strictly scoped to the bridge communication account", () => {
  assert.equal(outboundQueueAccountMatches({ communicationAccountId: "demac-wa-corporate" }, "DEMAC-WA-CORPORATE"), true);
  assert.equal(outboundQueueAccountMatches({ communicationAccountId: "demac-wa-test" }, "demac-wa-corporate"), false);
  assert.equal(outboundQueueAccountMatches({}, "demac-wa-corporate"), false);
});

test("message direction follows the Wacli FromMe message contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  assert.match(source, /const inbound = payload\.FromMe === false;/);
  assert.doesNotMatch(source, /const inbound = payload\.IsFromMe/);
  assert.match(source, /direction: inbound \? "inbound" : "outbound"/);
  assert.match(source, /role: inbound \? "customer" : "operator"/);
});

test("gateway creates canonical account-scoped message identity before persistence", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  assert.match(source, /wacliCanonicalIdentity\(\{ communicationAccountId, chat, providerMessageId \}\)/);
  assert.match(source, /persistCanonicalMessage\(\{/);
  assert.doesNotMatch(source, /whatsappMessages"\)\.doc\(safeDocumentId\(messageId\)\)\.set/);
});

test("gateway requires the authenticated bridge account boundary before webhook media poll and ack work", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  const matches = source.match(/requireBoundCommunicationAccount\(request\)/g) || [];
  assert.ok(matches.length >= 4, `expected account binding on four connector endpoints, found ${matches.length}`);
});

test("gateway contains no language keyword router or operator auto-assignment", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  assert.doesNotMatch(source, /function\s+inferQueue\b/);
  assert.doesNotMatch(source, /function\s+chooseAvailableOperator\b/);
  assert.doesNotMatch(source, /communicationOperatorPresence/);
  assert.doesNotMatch(source, /Auto-routed from/);
});
