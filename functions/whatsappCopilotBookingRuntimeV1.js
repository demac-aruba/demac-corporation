const scheduling = require("./whatsappCopilotScheduling");
const { formatAvailabilityReply } = require("./whatsappCopilotAvailability");
const {
  BOOKING_CORE_VERSION,
  applyHardConstraints,
  bookedSessionPatch,
  conversationKey,
  loadCanonicalOffer,
  markSelectedSession,
  markUnavailableSession,
  persistOfferedSession,
  sessionDocId,
} = require("./whatsappCopilotBookingCoreV1");

const legacyOrchestrateScheduling = scheduling.orchestrateScheduling;

async function canonicalOrchestrateScheduling({ db, request, analysis, commitAppointment = false }) {
  const response = await legacyOrchestrateScheduling({ db, request, analysis, commitAppointment });

  if (["availability_offered", "appointment_changed_reoffer"].includes(response.action)) {
    const constrained = applyHardConstraints(response.result, analysis);
    if (!constrained.options.length) {
      await markUnavailableSession(db, request, analysis);
      return {
        ...response,
        action: "availability_unavailable",
        reply: formatAvailabilityReply(analysis.language, constrained),
        result: constrained,
        offer: null,
        metadata: {
          ...(response.metadata || {}),
          appointmentCreated: false,
          availabilityOptions: [],
          requestedDate: constrained.requestedDate || "",
          requestedDateUnavailable: constrained.requestedDateUnavailable,
          bookingCoreVersion: BOOKING_CORE_VERSION,
          bookingStage: "searching",
          hardConstraints: constrained.hardConstraints,
        },
      };
    }

    const savedOffer = await persistOfferedSession(db, request, analysis, constrained);
    return {
      ...response,
      reply: formatAvailabilityReply(analysis.language, constrained),
      result: constrained,
      offer: savedOffer,
      metadata: {
        ...(response.metadata || {}),
        availabilityOptions: constrained.options,
        requestedDate: constrained.requestedDate || "",
        requestedDateUnavailable: constrained.requestedDateUnavailable,
        bookingCoreVersion: BOOKING_CORE_VERSION,
        bookingStage: "offered",
        offerVersion: savedOffer.version,
        hardConstraints: constrained.hardConstraints,
      },
    };
  }

  if (response.action === "appointment_pending_approval") {
    const option = response.metadata?.selectedOption;
    const offer = await loadCanonicalOffer(db, request);
    if (offer && option) await markSelectedSession(db, request, offer, option);
    return {
      ...response,
      metadata: {
        ...(response.metadata || {}),
        bookingCoreVersion: BOOKING_CORE_VERSION,
        bookingStage: "selected",
      },
    };
  }

  if (response.action === "appointment_booked") {
    const option = response.metadata?.selectedOption;
    const key = conversationKey(request);
    if (key && option) {
      await db.collection("whatsappCopilotBookingSessions").doc(sessionDocId(key)).set(
        bookedSessionPatch(
          option,
          response.metadata?.primaryWorkOrderId || response.offer?.primaryWorkOrderId || "",
          response.metadata?.workOrderIds || response.offer?.workOrderIds || [],
        ),
        { merge: true },
      );
    }
    return {
      ...response,
      metadata: {
        ...(response.metadata || {}),
        bookingCoreVersion: BOOKING_CORE_VERSION,
        bookingStage: "booked",
      },
    };
  }

  if (response.action === "availability_unavailable") {
    await markUnavailableSession(db, request, analysis);
    return {
      ...response,
      metadata: {
        ...(response.metadata || {}),
        bookingCoreVersion: BOOKING_CORE_VERSION,
        bookingStage: "searching",
      },
    };
  }

  return {
    ...response,
    metadata: {
      ...(response.metadata || {}),
      bookingCoreVersion: BOOKING_CORE_VERSION,
    },
  };
}

// Install exactly once in the Node module cache. The AI agent and confirmation
// guard require whatsappCopilotScheduling after this runtime is loaded by router.
if (scheduling.orchestrateScheduling !== canonicalOrchestrateScheduling) {
  scheduling.orchestrateScheduling = canonicalOrchestrateScheduling;
}

module.exports = {
  BOOKING_CORE_VERSION,
  canonicalOrchestrateScheduling,
  legacyOrchestrateScheduling,
};