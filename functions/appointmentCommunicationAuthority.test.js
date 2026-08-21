const assert = require("node:assert/strict");
const test = require("node:test");
const {
  closeConfirmationAfterReminder,
  deriveRecipientPurposeState,
  projectRecipientCommunication,
} = require("./appointmentCommunicationAuthority");

const stefany = {
  id: "client-stefany",
  recipientType: "client",
  sourceId: "stefany",
  name: "Stefany Grovell",
  role: "Customer / owner",
  whatsapp: "+2975600001",
  sendConfirmation: false,
  sendReminder: true,
};

function queue(queueId, status, overrides = {}) {
  return {
    queueId,
    status,
    recipientId: "client-stefany",
    reason: "appointment-created",
    ...overrides,
  };
}

test("an unrequested confirmation ignores a legacy automatic failure in current state", () => {
  const state = deriveRecipientPurposeState({
    recipient: stefany,
    purpose: "confirmation",
    queue: [queue("old-meta", "failed", { errorMessage: "(#133010) Account not registered", provider: "meta" })],
    singleRecipient: true,
    appointmentDate: "2026-08-22",
  });
  assert.equal(state.selected, false);
  assert.equal(state.state, "not_requested");
  assert.equal(state.lastError, "");
  assert.equal(state.historyAttemptCount, 1);
  assert.equal(state.canSendNow, true);
});

test("a successful message remains visible even when automatic policy is off", () => {
  const recipient = { ...stefany, sendReminder: false };
  const state = deriveRecipientPurposeState({
    recipient,
    purpose: "reminder",
    queue: [queue("sent-reminder", "sent", { reason: "daily-next-business-day-reminder" })],
    singleRecipient: true,
    appointmentDate: "2026-08-22",
  });
  assert.equal(state.selected, false);
  assert.equal(state.state, "sent");
  assert.equal(state.canSendNow, false);
});

test("a manual send is visible without changing the recipient automatic selection", () => {
  const state = deriveRecipientPurposeState({
    recipient: stefany,
    purpose: "confirmation",
    queue: [queue("manual-confirmation", "sent", { reason: "manual-office-confirmation", manual: true, provider: "wacli" })],
    singleRecipient: true,
    appointmentDate: "2026-08-22",
  });
  assert.equal(state.selected, false);
  assert.equal(state.state, "sent");
  assert.equal(state.manual, true);
});

test("a sent reminder closes an unrequested confirmation for the same recipient", () => {
  const result = projectRecipientCommunication({
    order: { date: "2026-08-22", notificationRecipients: [stefany] },
    confirmationQueue: [],
    reminderQueue: [queue("sent-reminder", "sent", { reason: "manual-office-reminder", manual: true, provider: "wacli" })],
  });
  assert.equal(result.recipients[0].confirmation.state, "closed");
  assert.equal(result.recipients[0].confirmation.canSendNow, false);
  assert.equal(result.recipients[0].confirmation.blockedReason, "reminder-already-sent");
  assert.equal(result.recipients[0].reminder.state, "sent");
});

test("a sent reminder supersedes an old failed confirmation without erasing its audit history", () => {
  const recipient = { ...stefany, sendConfirmation: true };
  const result = projectRecipientCommunication({
    order: { date: "2026-08-22", notificationRecipients: [recipient] },
    confirmationQueue: [queue("old-meta", "failed", { errorMessage: "(#133010) Account not registered", provider: "meta" })],
    reminderQueue: [queue("sent-reminder", "sent", { reason: "daily-next-business-day-reminder", provider: "wacli" })],
  });
  const confirmation = result.recipients[0].confirmation;
  assert.equal(confirmation.state, "closed");
  assert.equal(confirmation.lastError, "");
  assert.equal(confirmation.canSendNow, false);
  assert.equal(confirmation.blockedReason, "reminder-already-sent");
  assert.deepEqual(confirmation.historyQueueIds, ["old-meta"]);
  assert.equal(confirmation.historyAttemptCount, 1);
});

test("a queued reminder closes confirmation immediately so the two lifecycle steps cannot race", () => {
  const confirmation = closeConfirmationAfterReminder(
    { selected: false, state: "not_requested", canSendNow: true, historyQueueIds: [] },
    { selected: true, state: "queued", canSendNow: false },
  );
  assert.equal(confirmation.state, "closed");
  assert.equal(confirmation.canSendNow, false);
  assert.equal(confirmation.blockedReason, "reminder-in-progress");
});

test("a failed reminder does not close confirmation", () => {
  const confirmation = closeConfirmationAfterReminder(
    { selected: false, state: "not_requested", canSendNow: true },
    { selected: true, state: "failed", canSendNow: true },
  );
  assert.equal(confirmation.state, "not_requested");
  assert.equal(confirmation.canSendNow, true);
});

test("different contacts keep independent confirmation and reminder lifecycle", () => {
  const manager = {
    id: "contact-manager",
    recipientType: "contact",
    sourceId: "manager",
    name: "Property Manager",
    role: "Manager",
    whatsapp: "+2975600002",
    sendConfirmation: true,
    sendReminder: false,
  };
  const tenant = {
    id: "contact-tenant",
    recipientType: "contact",
    sourceId: "tenant",
    name: "Tenant",
    role: "Tenant",
    whatsapp: "+2975600003",
    sendConfirmation: false,
    sendReminder: true,
  };
  const result = projectRecipientCommunication({
    order: { date: "2026-08-22", notificationRecipients: [manager, tenant] },
    confirmationQueue: [{ queueId: "c1", status: "sent", recipientId: "contact-manager", reason: "appointment-created" }],
    reminderQueue: [{ queueId: "r1", status: "sent", recipientId: "contact-tenant", reason: "daily-next-business-day-reminder" }],
  });
  assert.equal(result.recipients[0].confirmation.state, "sent");
  assert.equal(result.recipients[0].reminder.state, "not_requested");
  assert.equal(result.recipients[1].confirmation.state, "closed");
  assert.equal(result.recipients[1].confirmation.canSendNow, false);
  assert.equal(result.recipients[1].reminder.state, "sent");
  assert.equal(result.confirmation.state, "partial");
  assert.equal(result.reminder.state, "sent");
});

test("selected communication with no queue attempt is not mislabeled as failed", () => {
  const state = deriveRecipientPurposeState({
    recipient: { ...stefany, sendConfirmation: true },
    purpose: "confirmation",
    queue: [],
    singleRecipient: true,
    appointmentDate: "2026-08-22",
  });
  assert.equal(state.state, "not_sent");
  assert.equal(state.lastError, "");
  assert.equal(state.canSendNow, true);
});