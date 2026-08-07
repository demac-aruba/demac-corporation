const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_COMPANY_OPERATIONAL_RULES,
  buildAllocationPlan,
  formatAvailabilityReply,
  normalizeCompanyOperationalRules,
} = require("./whatsappCopilotCompanyRules");

const standardService = {
  id: "standard_service",
  label: "Servicio estándar",
  kind: "service",
  durationMinutesPerUnit: 60,
};

test("keeps six standard services inside one normal van day", () => {
  const plan = buildAllocationPlan(6, 60, 4, standardService, DEFAULT_COMPANY_OPERATIONAL_RULES);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].quantity, 6);
  assert.equal(plan[0].slots, 6);
  assert.equal(plan[0].fullDay, false);
  assert.equal(plan[0].role, "primary");
});

test("uses the seven-unit single-property full-day exception", () => {
  const plan = buildAllocationPlan(7, 60, 4, standardService, DEFAULT_COMPANY_OPERATIONAL_RULES);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].quantity, 7);
  assert.equal(plan[0].slots, 6);
  assert.equal(plan[0].fullDay, true);
  assert.equal(plan[0].fixedTime, "08:30");
});

test("splits ten units into a full-day primary van and a half-day support van", () => {
  const plan = buildAllocationPlan(10, 60, 4, standardService, DEFAULT_COMPANY_OPERATIONAL_RULES);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], {
    quantity: 7,
    slots: 6,
    fullDay: true,
    role: "primary",
    fixedTime: "08:30",
    timePolicy: "fixed",
  });
  assert.deepEqual(plan[1], {
    quantity: 3,
    slots: 3,
    fullDay: false,
    role: "support",
    allowedTimes: ["08:30", "13:30"],
    timePolicy: "allowed",
  });
});

test("fourteen units use two full-day vans from 8:30", () => {
  const plan = buildAllocationPlan(14, 60, 4, standardService, DEFAULT_COMPANY_OPERATIONAL_RULES);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.quantity), [7, 7]);
  assert.equal(plan.every((item) => item.fullDay && item.fixedTime === "08:30"), true);
});

test("sixteen units can use two full-day vans plus a two-unit half-day support van", () => {
  const plan = buildAllocationPlan(16, 60, 4, standardService, DEFAULT_COMPANY_OPERATIONAL_RULES);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((item) => item.quantity), [7, 7, 2]);
  assert.equal(plan[2].fullDay, false);
  assert.deepEqual(plan[2].allowedTimes, ["08:30", "13:30"]);
});

test("no fixed maximum still respects the number of staffed vans", () => {
  const plan = buildAllocationPlan(22, 60, 3, standardService, DEFAULT_COMPANY_OPERATIONAL_RULES);
  assert.deepEqual(plan, []);
});

test("normalizes support threshold and preserves zero as no fixed automatic maximum", () => {
  const rules = normalizeCompanyOperationalRules({
    standardService: {
      singlePropertyMainVanMaxUnits: 7,
      automaticSupportFromUnits: 5,
      automaticSupportMaxUnits: 0,
      supportHalfDayMaxUnits: 3,
    },
  });
  assert.equal(rules.standardService.automaticSupportFromUnits, 8);
  assert.equal(rules.standardService.automaticSupportMaxUnits, 0);
});

test("customer wording explains an all-day job without exposing support vans", () => {
  const reply = formatAvailabilityReply("es", {
    quantity: 10,
    options: [
      {
        date: "2026-08-10",
        time: "08:30",
        address: "Noord 15",
        allDayCustomerNotice: true,
      },
      {
        date: "2026-08-11",
        time: "08:30",
        address: "Noord 15",
        allDayCustomerNotice: true,
      },
    ],
  });
  assert.match(reply, /trabajo puede extenderse durante el día/i);
  assert.match(reply, /\n\n\*1\./);
  assert.doesNotMatch(reply, /van|apoyo/i);
});
