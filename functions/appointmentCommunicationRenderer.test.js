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