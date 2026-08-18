const test = require("node:test");
const assert = require("node:assert/strict");
const { workOrderBlocksOperationalMoveCapacity } = require("./bookingCapacityAvailability");

test("operational capacity matches LIVE cancelled/rescheduled status semantics", () => {
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Confirmada" }), true);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Pendiente" }), true);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Cancelada" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "cancelled" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "canceled" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Reprogramada" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "rescheduled" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ status: "Confirmada" }), false);
});
