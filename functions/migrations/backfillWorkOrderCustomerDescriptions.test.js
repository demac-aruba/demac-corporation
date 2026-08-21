const assert = require("node:assert/strict");
const test = require("node:test");

const {
  appointmentCustomerDescription,
  automaticDescriptionForAppointment,
  groupOrdersByAppointment,
} = require("./backfillWorkOrderCustomerDescriptions");

test("backfill recovers the canonical customer-facing description from appointment work lines", () => {
  assert.equal(appointmentCustomerDescription({
    workLines: [{
      presetId: "other",
      quantity: 1,
      customerFacingDescription: "Inspect cassette leak and drain line before repair.",
    }],
  }), "Inspect cassette leak and drain line before repair.");
});

test("duplicate shared descriptions are not repeated for multi-work appointments", () => {
  assert.equal(appointmentCustomerDescription({
    workLines: [
      { presetId: "standard_service", customerFacingDescription: "Service two units in the office." },
      { presetId: "deep_cleaning", customerFacingDescription: "Service two units in the office." },
    ],
  }), "Service two units in the office.");
});

test("automatic description can be reconstructed from the canonical appointment and Work Order labels", () => {
  const appointment = {
    workLines: [{ presetId: "other", quantity: 1 }],
  };
  const orders = [{
    appointmentPresetId: "other",
    appointmentWorkLabel: "Other",
    appointmentWorkItems: [{ presetId: "other", label: "Other", quantity: 1 }],
  }];
  assert.equal(automaticDescriptionForAppointment(appointment, orders), "Scheduled work: 1 × Other.");
});

test("Work Orders are grouped by canonical appointment id", () => {
  const grouped = groupOrdersByAppointment([
    { id: "wo-1", ref: { id: "wo-1" }, data: () => ({ appointmentId: "APT-1" }) },
    { id: "wo-2", ref: { id: "wo-2" }, data: () => ({ appointmentId: "APT-1" }) },
    { id: "wo-3", ref: { id: "wo-3" }, data: () => ({ appointmentId: "APT-2" }) },
  ]);
  assert.equal(grouped.get("APT-1").length, 2);
  assert.equal(grouped.get("APT-2").length, 1);
});