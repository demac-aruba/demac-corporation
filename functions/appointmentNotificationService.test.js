const assert = require("node:assert/strict");
const test = require("node:test");

const {
  nextOpenBusinessDate,
  notificationQueueIds,
  reminderEligible,
  selectedRecipients,
} = require("./appointmentNotificationService");

test("Saturday reminder run targets Monday when Sunday is closed", () => {
  assert.equal(nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(),
  }), "2026-08-24");
});

test("Saturday reminder run skips Sunday and a Monday holiday", () => {
  assert.equal(nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(["2026-08-24"]),
  }), "2026-08-25");
});

test("next open business day is independent from whether that day has appointments", () => {
  const targetDate = nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(),
  });
  assert.equal(targetDate, "2026-08-24");
});

test("communication status can prefer the latest reminder attempt while preserving history", () => {
  const value = {
    queueIds: ["old-failed", "latest-1"],
    latestQueueIds: ["latest-1"],
  };
  assert.deepEqual(notificationQueueIds(value), ["old-failed", "latest-1"]);
  assert.deepEqual(notificationQueueIds(value, { preferLatest: true }), ["latest-1"]);
});

test("reminder eligibility respects the existing Work Order recipient policy", () => {
  assert.equal(reminderEligible({
    status: "Programada",
    whatsappNotificationsEnabled: true,
    notificationRecipients: [{ sendReminder: true }],
  }), true);
  assert.equal(reminderEligible({
    status: "Programada",
    whatsappNotificationsEnabled: true,
    notificationRecipients: [{ sendReminder: false }],
  }), false);
  assert.equal(reminderEligible({
    status: "Cancelada",
    whatsappNotificationsEnabled: true,
    notificationRecipients: [{ sendReminder: true }],
  }), false);
});

test("recipient resolution deduplicates the same WhatsApp number", () => {
  const recipients = selectedRecipients({
    notificationRecipients: [
      { id: "a", whatsapp: "+2975600000", sendReminder: true },
      { id: "b", phone: "2975600000", sendReminder: true },
      { id: "c", whatsapp: "+2975611111", sendReminder: false },
    ],
  }, { id: "client-1" }, "reminder");
  assert.deepEqual(recipients.map((item) => item.id), ["a"]);
});
