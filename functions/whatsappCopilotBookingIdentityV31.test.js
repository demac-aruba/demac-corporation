const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bookingIdentity,
  notificationRecipient,
} = require("./whatsappCopilotScheduling");

test("V31 can book a WhatsApp LID chat without pretending the LID is a phone number", () => {
  const identity = bookingIdentity(
    { contactPhone: "", contactJid: "159876543210987@lid", chatTitle: "My Love" },
    { client: null, phone: "" },
    { address: "Sabana Liber 404" },
  );
  assert.equal(identity.source, "jid");
  assert.equal(identity.phone, "");
  assert.equal(identity.jid, "159876543210987@lid");
  assert.equal(identity.canNotify, false);
  assert.match(identity.key, /^jid:/);
});

test("V31 prefers a real WhatsApp phone when one is available", () => {
  const identity = bookingIdentity(
    { contactPhone: "2975601234", contactJid: "159876543210987@lid", chatTitle: "Cliente" },
    {},
    { address: "Noord 15" },
  );
  assert.equal(identity.source, "phone");
  assert.equal(identity.phone, "2975601234");
  assert.equal(identity.canNotify, true);
});

test("ERP notification recipient is omitted when no verified phone exists", () => {
  assert.equal(notificationRecipient({ id: "client-lid", phone: "", whatsapp: "" }), null);
  const recipient = notificationRecipient({
    id: "client-phone",
    name: "Cliente",
    phone: "+2975601234",
    whatsapp: "+2975601234",
    phoneCountry: "AW",
    whatsappCountry: "AW",
  });
  assert.equal(recipient.sourceId, "client-phone");
  assert.equal(recipient.sendConfirmation, true);
  assert.equal(recipient.sendReminder, true);
});
