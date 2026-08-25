const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COMMUNICATION_COMMAND_ACTIONS,
  buildOwnershipPatch,
  nextOwnershipVersion,
  outboundQueueId,
  requireExpectedOwnershipVersion,
} = require("./communicationConversationAuthority");

const owner = { uid: "user-1", name: "Yerika", role: "office_operator" };
const manager = { uid: "manager-1", name: "Operations", role: "operations" };

function conversation(overrides = {}) {
  return {
    owner: "Yerika",
    ownerUserId: "user-1",
    lockedBy: "Yerika",
    lockedByUserId: "user-1",
    aiDisposition: "human_active",
    status: "assigned",
    ownershipVersion: 4,
    ...overrides,
  };
}

test("ownershipVersion is monotonic", () => {
  assert.equal(nextOwnershipVersion({}), 1);
  assert.equal(nextOwnershipVersion({ ownershipVersion: 4 }), 5);
});

test("human claim puts conversation under one sender authority", () => {
  const patch = buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.CLAIM,
    conversation: conversation({ owner: null, ownerUserId: null, lockedBy: null, lockedByUserId: null }),
    identity: owner,
    now: "2026-08-24T21:00:00.000Z",
  });
  assert.equal(patch.ownerUserId, "user-1");
  assert.equal(patch.lockedByUserId, "user-1");
  assert.equal(patch.aiDisposition, "human_active");
  assert.equal(patch.unread, 0);
});

test("non-manager cannot steal a conversation already owned by another operator", () => {
  assert.throws(() => buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.CLAIM,
    conversation: conversation({ owner: "Other", ownerUserId: "user-2" }),
    identity: owner,
    now: "2026-08-24T21:00:00.000Z",
  }), (error) => error.code === "conversation_already_owned");
});

test("human owner can return conversation to Maya but ownership remains explicit", () => {
  const patch = buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.RETURN_TO_MAYA,
    conversation: conversation(),
    identity: owner,
    now: "2026-08-24T21:00:00.000Z",
  });
  assert.equal(patch.ownerUserId, null);
  assert.equal(patch.lockedByUserId, null);
  assert.equal(patch.aiDisposition, "ai_active");
});

test("manager can close an owned conversation and Maya stays paused", () => {
  const patch = buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.CLOSE,
    conversation: conversation(),
    identity: manager,
    now: "2026-08-24T21:00:00.000Z",
  });
  assert.equal(patch.status, "resolved");
  assert.equal(patch.aiDisposition, "ai_paused");
  assert.equal(patch.ownerUserId, null);
});

test("stale expected ownership version is rejected before command commit", () => {
  assert.throws(
    () => requireExpectedOwnershipVersion(conversation(), 3),
    (error) => error.code === "ownership_version_changed",
  );
  assert.doesNotThrow(() => requireExpectedOwnershipVersion(conversation(), 4));
});

test("outbound command id is stable and account-scoped", () => {
  const first = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: "demac-wa-corporate",
    commandRequestId: "request-123",
  });
  const duplicate = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: "demac-wa-corporate",
    commandRequestId: "request-123",
  });
  const otherAccount = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: "demac-wa-test",
    commandRequestId: "request-123",
  });
  assert.equal(first, duplicate);
  assert.notEqual(first, otherAccount);
});
