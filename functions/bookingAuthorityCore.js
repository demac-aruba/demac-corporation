const crypto = require("node:crypto");

const BOOKING_AUTHORITY_VERSION = 1;

const BOOKING_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  INVALID_IDEMPOTENCY_KEY: "invalid_idempotency_key",
  OFFER_NOT_FOUND: "offer_not_found",
  OFFER_NOT_OPEN: "offer_not_open",
  OFFER_EXPIRED: "offer_expired",
  OFFER_VERSION_MISMATCH: "offer_version_mismatch",
  OPTION_NOT_FOUND: "option_not_found",
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
  return String(value ?? "").trim().slice(0, maxLength);
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
    return {
      id: cleanText(line?.id, 120) || `work-${index + 1}`,
      presetId,
      serviceId: cleanText(line?.serviceId, 120),
      quantity,
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

function hashKey(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
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

function validateOfferSelection({
  offer,
  offerVersion,
  optionId,
  now = new Date(),
}) {
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
      { status: offer.status || "" },
    );
  }

  const expiresAt = parseExpiry(offer.expiresAt);
  if (!expiresAt || expiresAt <= now.getTime()) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OFFER_EXPIRED,
      "The booking offer has expired.",
      { expiresAt: offer.expiresAt || "" },
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
  const option = options.find((candidate) => cleanText(candidate?.id, 180) === selectedOptionId);
  if (!option) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.OPTION_NOT_FOUND,
      "The selected option does not belong to this booking offer.",
      { optionId: selectedOptionId },
    );
  }

  return option;
}

function buildAppointmentDraft({
  request,
  offer,
  offerVersion,
  optionId,
  idempotencyKey,
  actor = {},
  now = new Date(),
}) {
  const normalizedRequest = normalizeBookingRequest(request);
  const option = validateOfferSelection({ offer, offerVersion, optionId, now });
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
    selectedOptionId: requireText(option.id, "option.id", 180),
    status: "confirmed",
    date: requireText(option.date, "option.date", 20),
    startTime: requireText(option.time || option.startTime, "option.time", 20),
    endTime: cleanText(option.endTime, 20),
    workLines: normalizedRequest.workLines,
    constraints: normalizedRequest.constraints,
    assignments: Array.isArray(option.assignments) ? option.assignments : [],
    primaryVanId: cleanText(option.primaryVanId || option.assignments?.[0]?.vanId, 120),
    source: cleanText(actor.source, 80) || "booking-authority",
    createdBy: cleanText(actor.id || actor.userId, 160),
    createdByName: cleanText(actor.name || actor.displayName, 160),
    createdAtIso: now.toISOString(),
  };
}

module.exports = {
  BOOKING_AUTHORITY_VERSION,
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  buildAppointmentDraft,
  canonicalAppointmentIdentity,
  normalizeBookingRequest,
  normalizeIdempotencyKey,
  normalizeWorkLines,
  validateOfferSelection,
};
