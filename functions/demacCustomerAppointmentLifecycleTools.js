const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
} = require("./bookingAuthorityCore");
const { createBookingAppointmentLifecycle } = require("./bookingAuthorityAppointmentLifecycle");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  MAYA_MUTATION_RECEIPT_COLLECTION,
  createMayaGuardedBookingDb,
  loadCurrentAppointmentWorkflowContext,
  mutationReceiptIdentity,
  mutationReplayDecision,
} = require("./demacCustomerAppointmentMutationGuard");

const CUSTOMER_APPOINTMENT_LIFECYCLE_TOOLS_VERSION = 2;

const CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES = Object.freeze({
  GET_APPOINTMENT_CHANGE_CONTEXT: "get_appointment_change_context",
  CANCEL_APPOINTMENT: "cancel_appointment",
  RESCHEDULE_APPOINTMENT: "reschedule_appointment",
});

const CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.GET_APPOINTMENT_CHANGE_CONTEXT,
    description: "Read the exact appointment already correlated by Maya Observer + Communication Case for this current cancellation/reschedule turn. Use this before attempting an existing-appointment change; it returns the canonical appointment and never guesses among multiple appointments.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    type: "function",
    name: CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.CANCEL_APPOINTMENT,
    description: "Cancel the exact appointment authorized by the current Communication Case through canonical Booking Authority. The supplied appointmentId must match that observed case. Never claim cancellation unless this tool returns success=true and the canonical appointment is cancelled.",
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
    description: "Reschedule the exact appointment authorized by the current Communication Case through canonical Booking Authority using an exact current booking offer and option. The supplied appointmentId must match that observed case and capacity is revalidated transactionally.",
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

function compactAppointmentForChange(appointment = {}) {
  return {
    id: cleanText(appointment.appointmentId || appointment.id, 180),
    customerId: cleanText(appointment.customerId, 160),
    propertyId: cleanText(appointment.propertyId, 160),
    status: cleanText(appointment.status, 80),
    date: cleanText(appointment.date, 20),
    startTime: cleanText(appointment.startTime, 20),
    endTime: cleanText(appointment.endTime, 20),
    workLines: Array.isArray(appointment.workLines) ? appointment.workLines.map((line) => ({
      id: cleanText(line.id, 120),
      presetId: cleanText(line.presetId, 120),
      serviceId: cleanText(line.serviceId, 120),
      quantity: Number(line.quantity || 0),
    })) : [],
    constraints: appointment.constraints || {},
  };
}

function createCustomerAppointmentLifecycleTools({ db, schedulingProvider = null } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible transactional db is required.");
  }
  const provider = schedulingProvider || createSchedulingProvider({ db });

  function lifecycleFor(action, context, mutationReceipt) {
    requireMutationContext(context);
    const guardedDb = createMayaGuardedBookingDb({ db, action, context, mutationReceipt });
    return createBookingAppointmentLifecycle({
      db: guardedDb,
      schedulingProvider: provider,
    });
  }

  async function getAppointmentChangeContext(_args = {}, context = {}) {
    requireMutationContext(context);
    const result = await loadCurrentAppointmentWorkflowContext({ db, context });
    if (!result.success) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "No exact current appointment-change context is available for this customer turn.",
        result.error || {},
      );
    }
    return {
      success: true,
      workflow: result.workflow,
      caseId: result.caseId,
      appointmentId: result.appointmentId,
      appointment: compactAppointmentForChange(result.appointment),
    };
  }

  async function loadCommittedReplay(action, args = {}, context = {}) {
    const expected = mutationReceiptIdentity(action, args, context);
    const receiptSnapshot = await db.collection(MAYA_MUTATION_RECEIPT_COLLECTION).doc(expected.id).get();
    if (!receiptSnapshot.exists) return { expected, replay: null };
    const receipt = receiptSnapshot.data() || {};
    const appointmentSnapshot = await db.collection("appointments").doc(expected.appointmentId).get();
    const appointment = appointmentSnapshot.exists ? { id: appointmentSnapshot.id, ...appointmentSnapshot.data() } : {};
    const decision = mutationReplayDecision({ receipt, expected, appointment });
    if (!decision.allowed) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        "A prior Maya appointment mutation receipt exists but current canonical state no longer matches it.",
        { receiptId: expected.id, replayReason: decision.reason },
      );
    }
    return {
      expected,
      replay: {
        success: true,
        replayed: true,
        appointmentId: expected.appointmentId,
        ...(action === CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.RESCHEDULE_APPOINTMENT ? { changeKind: "customer_reschedule" } : {}),
        appointment,
      },
    };
  }

  async function executeMutation(action, args, context, runner) {
    requireMutationContext(context);
    const executionContext = { ...context, requestedAppointmentId: cleanText(args.appointmentId, 180) };
    let replayState = await loadCommittedReplay(action, args, executionContext);
    if (replayState.replay) return replayState.replay;
    try {
      return await runner(replayState.expected, executionContext);
    } catch (error) {
      if (error instanceof BookingAuthorityError && error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT && error.details?.mayaMutationReplay === true) {
        replayState = await loadCommittedReplay(action, args, executionContext);
        if (replayState.replay) return replayState.replay;
      }
      throw error;
    }
  }

  async function cancelAppointment(args = {}, context = {}) {
    return executeMutation(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.CANCEL_APPOINTMENT, args, context, async (receipt, executionContext) => {
      const lifecycle = lifecycleFor(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.CANCEL_APPOINTMENT, executionContext, receipt);
      return lifecycle.cancelAppointment({
        appointmentId: args.appointmentId,
        reason: args.reason,
        note: args.note,
        actor: context.actor || { id: "demac-customer-agent", name: "Maya", source: "demac-customer-agent" },
      });
    });
  }

  async function rescheduleAppointment(args = {}, context = {}) {
    return executeMutation(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.RESCHEDULE_APPOINTMENT, args, context, async (receipt, executionContext) => {
      const lifecycle = lifecycleFor(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.RESCHEDULE_APPOINTMENT, executionContext, receipt);
      return lifecycle.rescheduleAppointment({
        appointmentId: args.appointmentId,
        offerId: args.offerId,
        offerVersion: args.offerVersion,
        optionId: args.optionId,
        reason: args.reason,
        note: args.note,
        actor: context.actor || { id: "demac-customer-agent", name: "Maya", source: "demac-customer-agent" },
        changeKind: "customer_reschedule",
        context: executionContext,
      });
    });
  }

  async function invoke(name, args = {}, context = {}) {
    try {
      if (name === CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES.GET_APPOINTMENT_CHANGE_CONTEXT) {
        return await getAppointmentChangeContext(args, context);
      }
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
    getAppointmentChangeContext,
    cancelAppointment,
    rescheduleAppointment,
    invoke,
  };
}

module.exports = {
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOLS_VERSION,
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_DEFINITIONS,
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES,
  compactAppointmentForChange,
  createCustomerAppointmentLifecycleTools,
  lifecycleToolError,
  requireMutationContext,
};
