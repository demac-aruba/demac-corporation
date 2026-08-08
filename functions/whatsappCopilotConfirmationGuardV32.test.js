const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveConfirmedOfferSelection,
} = require("./whatsappCopilotConfirmationGuardV32");

function offer(options) {
  return {
    id: "offer-test",
    status: "open",
    expiresAt: "2099-01-01T00:00:00.000Z",
    request: { serviceType: "service", quantity: 3, address: "Sabana Liber 404" },
    options: options.map(([date, time], index) => ({
      id: `opt-${index + 1}`,
      date,
      time,
      address: "Sabana Liber 404",
    })),
  };
}

test("confirms Monday afternoon when it uniquely identifies one active option", () => {
  const active = offer([
    ["2026-08-10", "13:30"],
    ["2026-08-11", "13:30"],
  ]);
  const selected = resolveConfirmedOfferSelection("on lunes en la tarde esta bien", active);
  assert.equal(selected?.ordinal, 1);
  assert.equal(selected?.option.date, "2026-08-10");
  assert.equal(selected?.option.time, "13:30");
});

test("treats 'lunes a la 1' as selection of the offered 1:30 p.m. slot", () => {
  const active = offer([
    ["2026-08-10", "13:30"],
    ["2026-08-10", "08:30"],
  ]);
  const selected = resolveConfirmedOfferSelection("lunes a la 1", active);
  assert.equal(selected?.ordinal, 1);
  assert.equal(selected?.option.time, "13:30");
});

test("does not confuse an availability question with a confirmation", () => {
  const active = offer([
    ["2026-08-10", "13:30"],
    ["2026-08-10", "08:30"],
  ]);
  assert.equal(resolveConfirmedOfferSelection("tienes en la tarde?", active), null);
  assert.equal(resolveConfirmedOfferSelection("tienes para lunes a la 1?", active), null);
});

test("a bare yes remains ambiguous when two options are active", () => {
  const active = offer([
    ["2026-08-10", "13:30"],
    ["2026-08-11", "13:30"],
  ]);
  assert.equal(resolveConfirmedOfferSelection("si", active), null);
});

test("a bare yes confirms when there is only one active option", () => {
  const active = offer([["2026-08-10", "13:30"]]);
  const selected = resolveConfirmedOfferSelection("si", active);
  assert.equal(selected?.ordinal, 1);
});

test("dame la opcion de la tarde selects the unique afternoon option", () => {
  const active = offer([
    ["2026-08-10", "08:30"],
    ["2026-08-10", "13:30"],
  ]);
  const selected = resolveConfirmedOfferSelection("ok dame la opcion de la tarde", active);
  assert.equal(selected?.ordinal, 2);
  assert.equal(selected?.option.time, "13:30");
});

test("an exact 1:00 request does not silently change to 1:30", () => {
  const active = offer([
    ["2026-08-10", "13:30"],
    ["2026-08-10", "08:30"],
  ]);
  assert.equal(resolveConfirmedOfferSelection("lunes a la 1:00", active), null);
});
