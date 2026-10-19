const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatAppointmentDate,
  greetingForLanguage,
  localizeServiceDescription,
  papiamentoUnknownFixedWords,
  renderAppointmentText,
  templateLanguageForRecipient,
} = require("./appointmentCommunicationRenderer");

test("Papiamento preferred language is preserved instead of falling back to English", () => {
  assert.equal(templateLanguageForRecipient({ preferredLanguage: "Papiamento" }, { preferredLanguage: "English" }), "pap");
  assert.equal(templateLanguageForRecipient({}, { preferredLanguage: "Papiamento" }), "pap");
  assert.equal(templateLanguageForRecipient({ preferredLanguage: "Español" }, { preferredLanguage: "Papiamento" }), "es");
  assert.equal(templateLanguageForRecipient(
    { preferredLanguage: "Papiamento", templateLanguage: "en" },
    { preferredLanguage: "English", templateLanguage: "en" },
  ), "pap");
});

test("Aruba Papiamento appointment date includes the official weekday and month", () => {
  assert.equal(formatAppointmentDate("2026-08-22", "pap"), "diasabra, 22 di augustus 2026");
  assert.match(formatAppointmentDate("2026-08-24", "en"), /Monday/i);
  assert.match(formatAppointmentDate("2026-08-24", "es"), /lunes/i);
  assert.match(formatAppointmentDate("2026-08-24", "nl"), /maandag/i);
});

test("Papiamento greeting follows Aruba local time", () => {
  assert.equal(greetingForLanguage("pap", "Stefany Grovell", new Date("2026-08-21T18:00:00Z")), "Bon tardi Stefany Grovell,");
});

test("canonical scheduling work is localized instead of leaking the English picker label", () => {
  assert.equal(localizeServiceDescription({
    appointmentWorkItems: [{ presetId: "standard_installation", label: "Standard Installation", quantity: 1 }],
  }, "Standard Installation × 1", "pap"), "Instalacion standard × 1");
});

test("custom customer-facing description wins over the generic Other work label", () => {
  const customDescription = "Revisa e cassette pa lek y controla e drain line prome cu cualkier reparacion.";
  assert.equal(localizeServiceDescription({
    customerFacingDescription: customDescription,
    customerFacingDescriptionIsDefault: false,
    appointmentWorkItems: [{ presetId: "other", label: "Other", quantity: 1 }],
  }, "Other × 1", "pap"), customDescription);
});

test("default generated customer description still allows the canonical work label to be localized", () => {
  assert.equal(localizeServiceDescription({
    customerFacingDescription: "Scheduled work: 1 × Standard Installation.",
    customerFacingDescriptionIsDefault: true,
    appointmentWorkItems: [{ presetId: "standard_installation", label: "Standard Installation", quantity: 1 }],
  }, "Standard Installation × 1", "pap"), "Instalacion standard × 1");
});

test("Papiamento reminder uses WhatsApp emphasis and localized labels", () => {
  const text = renderAppointmentText("appointment-reminder", [
    "Stefany Grovell",
    "diasabra, 22 di augustus 2026",
    "8:30 AM",
    "Piedra Plat 1C",
    "Instalacion standard × 1",
  ], "pap", { now: new Date("2026-08-21T18:00:00Z") });

  assert.match(text, /^Bon tardi Stefany Grovell,/);
  assert.match(text, /Esaki ta un recordatorio pa bo cita cu \*DEMAC Professional Cooling Solutions\*\./);
  assert.match(text, /\*Fecha:\* diasabra, 22 di augustus 2026/);
  assert.match(text, /\*Ora:\* 8:30 AM/);
  assert.match(text, /\*Adres:\* Piedra Plat 1C/);
  assert.match(text, /\*Servicio:\* Instalacion standard × 1/);
  assert.doesNotMatch(text, /This is a reminder/i);
});

test("all appointment message languages bold the brand and field labels", () => {
  const fixtures = [
    ["en", "*Date:*"],
    ["es", "*Fecha:*"],
    ["nl", "*Datum:*"],
    ["pap", "*Fecha:*"],
  ];
  for (const [language, dateLabel] of fixtures) {
    const text = renderAppointmentText("appointment-confirmation", ["Customer", "date", "time", "address", "service"], language, { now: new Date("2026-08-21T18:00:00Z") });
    assert.match(text, /\*DEMAC Professional Cooling Solutions\*/);
    assert.ok(text.includes(dateLabel));
  }
});

test("fixed Papiamento customer copy uses the existing Aruba orthography vocabulary", () => {
  assert.deepEqual(papiamentoUnknownFixedWords(), []);
});

test('confirmation and reminder show two address lines and a welcoming English closing', () => {
  for (const type of ['appointment-confirmation', 'appointment-reminder']) {
    const text = renderAppointmentText(type, ['Synthetic client', 'date', '8:30 AM', 'compact address', 'Standard Service × 3'], 'en', {
      addressLines: ['Synthetic Residence 10', 'Apartment 4'],
    });
    assert.match(text, /\*Address:\* Synthetic Residence 10\n\*Address:\* Apartment 4\n\*Service:\* Standard Service × 3/);
    assert.match(text, /If you have any questions or need to make a change to your appointment, please feel free to reply to this message\. We’re happy to help!$/);
    assert.doesNotMatch(text, /compact address|If you need to make any changes/);
  }
});
