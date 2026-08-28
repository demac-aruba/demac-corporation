const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES,
  compactAppointmentForChange,
  requireMutationContext,
} = require("./demacCustomerAppointmentLifecycleTools");

const {
  BookingAuthorityError,
} = require("./bookingAuthorityCore");

test("appointment lifecycle tools expose context read plus canonical cancel and reschedule commands", () => {
  assert.deepEqual(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES, {
    GET_APPOINTMENT_CHANGE_CONTEXT: "get_appointment_change_context",
    CANCEL_APPOINTMENT: "cancel_appointment",
    RESCHEDULE_APPOINTMENT: "reschedule_appointment",
  });
});

test("appointment lifecycle mutation context fails closed without the exact inbound message identity", () => {
  assert.throws(
    () => requireMutationContext({ conversationId: "COMM-1" }),
    (error) => error instanceof BookingAuthorityError
      && error.details.conversationIdPresent === true
      && error.details.inboundMessageIdPresent === false,
  );
  assert.doesNotThrow(() => requireMutationContext({ conversationId: "COMM-1", inboundMessageId: "MSG-1" }));
});

test("appointment-change context exposes scheduling facts without technician/internal assignment details", () => {
  const compact = compactAppointmentForChange({
    id: "APT-1",
    customerId: "C-1",
    propertyId: "P-1",
    status: "confirmed",
    date: "2026-08-29",
    startTime: "09:30",
    endTime: "10:30",
    workLines: [{ id: "w1", presetId: "standard_service", serviceId: "s1", quantity: 1 }],
    constraints: { requestedDate: "2026-08-29" },
    assignments: [{ vanId: "van-1", technicianIds: ["secret-tech"] }],
  });
  assert.equal(compact.id, "APT-1");
  assert.equal(compact.workLines[0].presetId, "standard_service");
  assert.equal("assignments" in compact, false);
});
