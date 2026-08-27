const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
} = require("./bookingAuthorityCore");
const { createBookingAppointmentLifecycle } = require("./bookingAuthorityAppointmentLifecycle");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const { cleanText } = require("./bookingSchedulingPrimitives");
const { createMayaGuardedBookingDb } = require("./demacCustomerAppointmentMutationGuard");

const CUSTOMER_APPOINTMENT_LIFECYCLE_TOOLS_VERSION = 1;

const CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES = Object.freeze({
  CANCEL_APPOINTMENT: "cancel_appointment",
  RESCHEDULE_APPOINTMENT: "reschedule_appointment",
});

const CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.CANCEL_APPOINTMENT,
    description: "Cancel one existing ERP appointment through canonical Booking Authority. This mutation is server-gated by Maya pilot policy and the exact current communication turn. Never claim cancellation unless this tool returns success=true and the canonical appointment is cancelled.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["appointmentId", "reason", "note"],
      properties: {
        appointmentId: { type: "string" },
        reason: { type: "string" },
        note: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.RESCHEDULE_APPOINTMENT,
    description: "Reschedule one existing ERP appointment through canonical Booking Authority using an exact current booking offer and option. The selected capacity is revalidated transactionally. This mutation is server-gated by Maya pilot policy and the exact current communication turn.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["appointmentId", "offerId", "offerVersion", "optionId", "reason", "note"],
      properties: {
        appointmentId: { type: "string" },
        offerId: { type: "string" },
        offerVersion: { type: "integer", minimum: 1 },
        optionId: { type: "string" },
        reason: { type: "string" },
        note: { type: "string" },
      },
    },
  },
]);

function lifecycleToolError(error) {
  if (error instanceof BookingAuthorityError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: cleanText(error.message, 500),
        details: error.details || {},
      },
    };
  }
  return {
    success: false,
    error: {
      code: "internal_error",
      message: cleanText(error?.message || error, 500) || "Unexpected appointment lifecycle tool error.",
      details: {},
    },
  };
}

function requireMutationContext(context = {}) {
  const conversationId = cleanText(context.conversationId || context.conversationKey, 300);
  const inboundMessageId = cleanText(context.inboundMessageId || context.messageId, 300);
  if (!conversationId || !inboundMessageId) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Canonical conversation and inbound-message identity are required for Maya appointment mutations.",
      {
        conversationIdPresent: Boolean(conversationId),
        inboundMessageIdPresent: Boolean(inboundMessageId),
      },
    );
  }
}

function createCustomerAppointmentLifecycleTools({ db, schedulingProvider = null } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible transactional db is required.");
  }
  const provider = schedulingProvider || createSchedulingProvider({ db });

  function lifecycleFor(action, context) {
    requireMutationContext(context);
    const guardedDb = createMayaGuardedBookingDb({ db, action, context });
    return createBookingAppointmentLifecycle({
      db: guardedDb,
      schedulingProvider: provider,
    });
  }

  async function cancelAppointment(args = {}, context = {}) {
    const lifecycle = lifecycleFor(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.CANCEL_APPOINTMENT, context);
    return lifecycle.cancelAppointment({
      appointmentId: args.appointmentId,
      reason: args.reason,
      note: args.note,
      actor: context.actor || { id: "demac-customer-agent", name: "Maya", source: "demac-customer-agent" },
    });
  }

  async function rescheduleAppointment(args = {}, context = {}) {
    const lifecycle = lifecycleFor(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.RESCHEDULE_APPOINTMENT, context);
    return lifecycle.rescheduleAppointment({
      appointmentId: args.appointmentId,
      offerId: args.offerId,
      offerVersion: args.offerVersion,
      optionId: args.optionId,
      reason: args.reason,
      note: args.note,
      actor: context.actor || { id: "demac-customer-agent", name: "Maya", source: "demac-customer-agent" },
      changeKind: "customer_reschedule",
      context,
    });
  }

  async function invoke(name, args = {}, context = {}) {
    try {
      if (name === CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.CANCEL_APPOINTMENT) {
        return await cancelAppointment(args, context);
      }
      if (name === CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.RESCHEDULE_APPOINTMENT) {
        return await rescheduleAppointment(args, context);
      }
      return {
        success: false,
        error: {
          code: "unknown_tool",
          message: `Unknown customer appointment lifecycle tool: ${cleanText(name, 120)}`,
          details: {},
        },
      };
    } catch (error) {
      return lifecycleToolError(error);
    }
  }

  return {
    version: CUSTOMER_APPOINTMENT_LIFECYCLE_TOOLS_VERSION,
    definitions: CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_DEFINITIONS,
    cancelAppointment,
    rescheduleAppointment,
    invoke,
  };
}

module.exports = {
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOLS_VERSION,
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_DEFINITIONS,
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES,
  createCustomerAppointmentLifecycleTools,
  lifecycleToolError,
  requireMutationContext,
};
