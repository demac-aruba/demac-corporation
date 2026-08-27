const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES,
  requireMutationContext,
} = require("./demacCustomerAppointmentLifecycleTools");

const {
  BookingAuthorityError,
} = require("./bookingAuthorityCore");

test("appointment lifecycle tools expose only canonical cancel and reschedule commands", () => {
  assert.deepEqual(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES, {
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
