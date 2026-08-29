const crypto = require("node:crypto");

const BOOKING_AUTHORITY_VERSION = 1;

const BOOKING_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  INVALID_IDEMPOTENCY_KEY: "invalid_idempotency_key",
  AVAILABILITY_PROVIDER_ERROR: "availability_provider_error",
  NO_AVAILABILITY: "no_availability",
  OFFER_NOT_FOUND: "offer_not_found",
  OFFER_NOT_OPEN: "offer_not_open",
  OFFER_EXPIRED: "offer_expired",
  OFFER_VERSION_MISMATCH: "offer_version_mismatch",
  OPTION_NOT_FOUND: "option_not_found",
  CUSTOMER_NOT_FOUND: "customer_not_found",
  PROPERTY_NOT_FOUND: "property_not_found",
  PROPERTY_CUSTOMER_MISMATCH: "property_customer_mismatch",
  SLOT_CONFLICT: "slot_conflict",
  AVAILABILITY_CHANGED: "availability_changed",
  APPOINTMENT_NOT_FOUND: "appointment_not_found",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
});

class BookingAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BookingAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function cleanText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function requireText(value, field, maxLength = 240) {
  const normalized = cleanText(value, maxLength);
  if (!normalized) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `${field} is required.`,
      { field },
    );
  }
  return normalized;
}

function hashKey(value, length = 24) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, length);
}

function normalizeManualDuration(value, field) {
  if (value === undefined || value === null || value === "") return 0;
  const minutes = positiveInteger(value);
  if (minutes < 30 || minutes > 720 || minutes % 15 !== 0) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `${field} must be between 30 and 720 minutes in 15-minute increments.`,
      { field },
    );
  }
  return minutes;
}

function normalizeWorkLines(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "At least one work line is required.",
      { field: "workLines" },
    );
  }

  return value.map((line, index) => {
    const presetId = requireText(line?.presetId || line?.serviceType, `workLines[${index}].presetId`, 120);
    const quantity = positiveInteger(line?.quantity);
    if (!quantity) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        `workLines[${index}].quantity must be a positive integer.`,
        { field: `workLines[${index}].quantity` },
      );
    }
    const manualDurationMinutes = normalizeManualDuration(
      line?.manualDurationMinutes,
      `workLines[${index}].manualDurationMinutes`,
    );
    return {
      id: cleanText(line?.id, 120) || `work-${index + 1}`,
      presetId,
      serviceId: cleanText(line?.serviceId, 120),
      quantity,
      ...(manualDurationMinutes ? { manualDurationMinutes } : {}),
      customerFacingDescription: cleanText(line?.customerFacingDescription, 500),
      technicianInstructions: cleanText(line?.technicianInstructions, 1_500),
    };
  });
}

function normalizeBookingRequest(value = {}) {
  return {
    customerId: requireText(value.customerId, "customerId", 160),
    propertyId: requireText(value.propertyId, "propertyId", 160),
    workLines: normalizeWorkLines(value.workLines),
    constraints: {
      requestedDate: cleanText(value.constraints?.requestedDate, 20),
      requestedTime: cleanText(value.constraints?.requestedTime, 20),
      preferredTime: cleanText(value.constraints?.preferredTime, 80),
    },
    notes: cleanText(value.notes, 1_500),
  };
}

function normalizeAssignment(value = {}, index = 0) {
  const quantity = positiveInteger(value.quantity);
  const slots = positiveInteger(value.slots);
  if (!quantity || !slots) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `options.assignments[${index}] requires positive quantity and slots.`,
      { field: `options.assignments[${index}]` },
    );
  }
  const role = cleanText(value.role, 40);
  return {
    vanId: requireText(value.vanId, `options.assignments[${index}].vanId`, 120),
    vanName: cleanText(value.vanName, 160),
    technicianIds: Array.isArray(value.technicianIds)
      ? value.technicianIds.map((item) => cleanText(item, 120)).filter(Boolean)
      : [],
    driverStaffId: cleanText(value.driverStaffId, 120),
    helperStaffId: cleanText(value.helperStaffId, 120),
    quantity,
    slots,
    durationMinutes: positiveInteger(value.durationMinutes) || slots * 60,
    fullDay: value.fullDay === true,
    time: cleanText(value.time, 20),
    endTime: cleanText(value.endTime, 20),
    capacityEndTime: cleanText(value.capacityEndTime, 20),
    role: role === "support" || (!role && index > 0) ? "support" : "primary",
  };
}

function normalizeWorkItemSnapshot(value = {}, index = 0) {
  const quantity = positiveInteger(value.quantity);
  const durationMinutes = positiveInteger(value.durationMinutes);
  const durationMinutesPerUnit = positiveInteger(value.durationMinutesPerUnit);
  if (!quantity || !durationMinutes || !durationMinutesPerUnit) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `options.workItems[${index}] requires positive quantity and duration.`,
      { field: `options.workItems[${index}]` },
    );
  }
  const durationMode = ["per_unit", "fixed", "manual"].includes(cleanText(value.durationMode, 40))
    ? cleanText(value.durationMode, 40)
    : "per_unit";
  return {
    id: cleanText(value.id, 120) || `work-${index + 1}`,
    presetId: requireText(value.presetId, `options.workItems[${index}].presetId`, 120),
    serviceId: cleanText(value.serviceId, 120),
    label: cleanText(value.label, 240),
    quantity,
    durationMinutes,
    durationMinutesPerUnit,
    durationMode,
    serviceDefinitionVersion: positiveInteger(value.serviceDefinitionVersion),
  };
}

function normalizeOfferOption(value = {}, index = 0) {
  const assignments = Array.isArray(value.assignments)
    ? value.assignments.map((item, assignmentIndex) => normalizeAssignment(item, assignmentIndex))
    : [];
  if (!assignments.length) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `options[${index}].assignments is required.`,
      { field: `options[${index}].assignments` },
    );
  }
  const workItems = Array.isArray(value.workItems)
    ? value.workItems.map((item, workIndex) => normalizeWorkItemSnapshot(item, workIndex))
    : [];
  return {
    id: requireText(value.id, `options[${index}].id`, 180),
    date: requireText(value.date, `options[${index}].date`, 20),
    time: requireText(value.time || value.startTime, `options[${index}].time`, 20),
    endTime: cleanText(value.endTime, 20),
    capacityEndTime: cleanText(value.capacityEndTime, 20),
    address: cleanText(value.address, 500),
    zone: cleanText(value.zone, 120),
    presetId: cleanText(value.presetId, 120),
    presetLabel: cleanText(value.presetLabel, 240),
    serviceId: cleanText(value.serviceId, 120),
    durationMinutesPerUnit: positiveInteger(value.durationMinutesPerUnit) || 60,
    durationMode: ["per_unit", "fixed", "manual", "mixed"].includes(cleanText(value.durationMode, 40))
      ? cleanText(value.durationMode, 40)
      : "per_unit",
    serviceDefinitionVersion: positiveInteger(value.serviceDefinitionVersion),
    quantity: positiveInteger(value.quantity) || assignments.reduce((sum, item) => sum + item.quantity, 0),
    workItems,
    assignments,
    requestedDateMatch: value.requestedDateMatch === true,
    requestedTimeMatch: value.requestedTimeMatch === true,
  };
}

function normalizeIdempotencyKey(value) {
  const key = cleanText(value, 500);
  if (key.length < 8) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
      "A stable idempotency key of at least 8 characters is required.",
    );
  }
  return key;
}

function canonicalAppointmentIdentity(idempotencyKey) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  return {
    appointmentId: `APT-${hashKey(key, 20).toUpperCase()}`,
    idempotencyKeyHash: hashKey(key, 40),
  };
}

function parseExpiry(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function validateOfferSelection({ offer, offerVersion, optionId, now = new Date() }) {
  if (!offer || typeof offer !== "object") {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OFFER_NOT_FOUND,
      "The booking offer does not exist.",
    );
  }
  if (offer.status !== "open") {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OFFER_NOT_OPEN,
      "The booking offer is no longer open.",
      { status: cleanText(offer.status, 40) },
    );
  }
  const expiresAt = parseExpiry(offer.expiresAt);
  if (!expiresAt || expiresAt <= now.getTime()) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OFFER_EXPIRED,
      "The booking offer has expired.",
      { expiresAt: cleanText(offer.expiresAt, 80) },
    );
  }
  const expectedVersion = positiveInteger(offer.version);
  const suppliedVersion = positiveInteger(offerVersion);
  if (!expectedVersion || !suppliedVersion || expectedVersion !== suppliedVersion) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OFFER_VERSION_MISMATCH,
      "The booking offer version does not match the current offer.",
      { expectedVersion, suppliedVersion },
    );
  }
  const selectedOptionId = requireText(optionId, "optionId", 180);
  const options = Array.isArray(offer.options) ? offer.options : [];
  const rawOption = options.find((candidate) => cleanText(candidate?.id, 180) === selectedOptionId);
  if (!rawOption) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OPTION_NOT_FOUND,
      "The selected option does not belong to this booking offer.",
      { optionId: selectedOptionId },
    );
  }
  return normalizeOfferOption(rawOption, options.indexOf(rawOption));
}

function buildAppointmentDraft({
  request,
  offer,
  offerVersion,
  optionId,
  idempotencyKey,
  actor = {},
  now = new Date(),
  optionOverride = null,
}) {
  const normalizedRequest = normalizeBookingRequest(request);
  const validatedOption = validateOfferSelection({ offer, offerVersion, optionId, now });
  const option = optionOverride ? normalizeOfferOption(optionOverride) : validatedOption;
  if (option.id !== validatedOption.id || option.date !== validatedOption.date || option.time !== validatedOption.time) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
      "Revalidation changed the selected date, time, or option identity.",
      { selectedOptionId: validatedOption.id },
    );
  }
  const primaryAssignment = option.assignments.find((assignment) => assignment.role !== "support")
    || option.assignments[0]
    || {};
  const capacityEndTime = cleanText(
    option.capacityEndTime || primaryAssignment.capacityEndTime || option.endTime,
    20,
  );
  const identity = canonicalAppointmentIdentity(idempotencyKey);
  return {
    id: identity.appointmentId,
    appointmentId: identity.appointmentId,
    bookingAuthorityVersion: BOOKING_AUTHORITY_VERSION,
    idempotencyKeyHash: identity.idempotencyKeyHash,
    customerId: normalizedRequest.customerId,
    propertyId: normalizedRequest.propertyId,
    offerId: requireText(offer.id, "offer.id", 180),
    offerVersion: positiveInteger(offer.version),
    selectedOptionId: option.id,
    status: "confirmed",
    date: option.date,
    startTime: option.time,
    endTime: option.endTime,
    capacityEndTime,
    workLines: normalizedRequest.workLines,
    workItems: option.workItems,
    constraints: normalizedRequest.constraints,
    notes: normalizedRequest.notes,
    assignments: option.assignments,
    primaryVanId: cleanText(primaryAssignment.vanId, 120),
    source: cleanText(actor.source, 80) || "booking-authority",
    createdBy: cleanText(actor.id || actor.userId, 160),
    createdByName: cleanText(actor.name || actor.displayName, 160),
    createdAtIso: now.toISOString(),
    updatedAtIso: now.toISOString(),
  };
}

module.exports = {
  BOOKING_AUTHORITY_VERSION,
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  buildAppointmentDraft,
  canonicalAppointmentIdentity,
  cleanText,
  hashKey,
  normalizeBookingRequest,
  normalizeIdempotencyKey,
  normalizeOfferOption,
  normalizeWorkLines,
  positiveInteger,
  validateOfferSelection,
};
