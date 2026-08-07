const test = require("node:test");
const assert = require("node:assert/strict");

const state = require("./whatsappCopilotStateMachineV21");

const afternoonOffer = {
  id: "offer-test",
  status: "open",
  options: [
    { date: "2026-08-08", time: "13:30", address: "Sabana Liber 404" },
  ],
};

test("sí and excelente ok confirm the only active appointment option", () => {
  assert.equal(state.isExplicitSelectionTurnV21("sí"), true);
  assert.equal(state.isExplicitSelectionTurnV21("excelente ok"), true);
  assert.equal(state.selectOptionFromTurn("sí", afternoonOffer)?.ordinal, 1);
  assert.equal(state.selectOptionFromTurn("excelente ok", afternoonOffer)?.option.time, "13:30");
});

test("deictic booking commands confirm the only active appointment option", () => {
  for (const text of ["ok dame esa cita", "sí esa", "esa está bien", "me quedo con esa"]) {
    assert.equal(state.isDeicticConfirmation(text), true, text);
    assert.equal(state.selectOptionFromTurn(text, afternoonOffer)?.ordinal, 1, text);
  }
});

test("explicit 1:30 PM resolves the afternoon offer directly", () => {
  const selected = state.selectOptionFromTurn("dame la opción de la tarde de la 1:30 PM", afternoonOffer);
  assert.equal(selected?.ordinal, 1);
  assert.equal(selected?.option.time, "13:30");
});

test("generic yes does not invent a choice when two options remain", () => {
  const twoOptions = {
    ...afternoonOffer,
    options: [
      { date: "2026-08-08", time: "08:30", address: "Sabana Liber 404" },
      { date: "2026-08-08", time: "09:30", address: "Sabana Liber 404" },
    ],
  };
  assert.equal(state.selectOptionFromTurn("sí", twoOptions), null);
});

test("identity candidates include phone, jid and normalized chat title", () => {
  const values = state.identityCandidates({
    contactPhone: "+297 560 6772",
    contactJid: "2975606772@c.us",
    chatTitle: "My Love",
    messages: [],
  });
  assert.ok(values.includes("2975606772"));
  assert.ok(values.includes("2975606772@c.us"));
  assert.ok(values.includes("my love"));
});
