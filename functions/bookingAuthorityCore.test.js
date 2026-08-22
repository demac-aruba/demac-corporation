const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOOKING_AUTHORITY_VERSION,
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  buildAppointmentDraft,
  canonicalAppointmentIdentity,
  normalizeBookingRequest,
  normalizeOfferOption,
  validateOfferSelection,
} = require("./bookingAuthorityCore");

function offer(overrides = {}) {
  return {
    id: "offer-123",
    version: 4,
    status: "open",
    expiresAt: "2099-01-01T00:00:00.000Z",
    options: [{
      id: "opt-1",
      date: "2098-12-20",
      time: "13:30",
      endTime: "15:30",
      presetId: "standard_service",
      assignments: [{ vanId: "VAN-2", technicianIds: ["t1", "t2"], quantity: 2, slots: 2 }],
    }],
    ...overrides,
  };
}

test("normalizes a channel-independent booking request", () => {
  const request = normalizeBookingRequest({
    customerId: "client-1",
    propertyId: "property-1",
    workLines: [{ presetId: "standard_service", quantity: 2 }],
    constraints: { preferredTime: "afternoon" },
  });
  assert.equal(request.customerId, "client-1");
  assert.equal(request.propertyId, "property-1");
  assert.equal(request.workLines[0].quantity, 2);
  assert.equal(request.constraints.preferredTime, "afternoon");
});

test("rejects requests without stable customer/property ids", () => {
  assert.throws(
    () => normalizeBookingRequest({ propertyId: "property-1", workLines: [{ presetId: "standard_service", quantity: 1 }] }),
    (error) => error instanceof BookingAuthorityError
      && error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
      && error.details.field === "customerId",
  );
});

test("normalizes offer assignments and requires positive capacity", () => {
  const normalized = normalizeOfferOption(offer().options[0]);
  assert.equal(normalized.assignments[0].vanId, "VAN-2");
  assert.equal(normalized.assignments[0].slots, 2);
  assert.throws(
    () => normalizeOfferOption({ ...offer().options[0], assignments: [{ vanId: "VAN-2", quantity: 2, slots: 0 }] }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

test("canonical offer normalization preserves exact requested date/time intent for confirm-time revalidation", () => {
  const providerOption = {
    ...offer().options[0],
    requestedDateMatch: true,
    requestedTimeMatch: true,
  };
  const storedOption = normalizeOfferOption(providerOption);
  const selected = validateOfferSelection({
    offer: offer({ options: [storedOption] }),
    offerVersion: 4,
    optionId: "opt-1",
    now: new Date("2026-08-22T18:25:00-04:00"),
  });
  assert.equal(storedOption.requestedDateMatch, true);
  assert.equal(storedOption.requestedTimeMatch, true);
  assert.equal(selected.requestedDateMatch, true);
  assert.equal(selected.requestedTimeMatch, true);
});

test("appointment identity is deterministic for the same idempotency key", () => {
  const first = canonicalAppointmentIdentity("communication:123:message:ABC:book");
  const second = canonicalAppointmentIdentity("communication:123:message:ABC:book");
  const different = canonicalAppointmentIdentity("communication:123:message:XYZ:book");
  assert.equal(first.appointmentId, second.appointmentId);
  assert.equal(first.idempotencyKeyHash, second.idempotencyKeyHash);
  assert.notEqual(first.appointmentId, different.appointmentId);
});

test("rejects expired offers", () => {
  assert.throws(
    () => validateOfferSelection({
      offer: offer({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      offerVersion: 4,
      optionId: "opt-1",
      now: new Date("2026-08-16T20:00:00-04:00"),
    }),
    (error) => error.code === BOOKING_ERROR_CODES.OFFER_EXPIRED,
  );
});

test("rejects stale offer versions", () => {
  assert.throws(
    () => validateOfferSelection({ offer: offer(), offerVersion: 3, optionId: "opt-1" }),
    (error) => error.code === BOOKING_ERROR_CODES.OFFER_VERSION_MISMATCH
      && error.details.expectedVersion === 4
      && error.details.suppliedVersion === 3,
  );
});

test("rejects option ids that were not issued by the offer", () => {
  assert.throws(
    () => validateOfferSelection({ offer: offer(), offerVersion: 4, optionId: "opt-99" }),
    (error) => error.code === BOOKING_ERROR_CODES.OPTION_NOT_FOUND,
  );
});

test("builds canonical confirmed appointment only after offer validation", () => {
  const draft = buildAppointmentDraft({
    request: {
      customerId: "client-1",
      propertyId: "property-1",
      workLines: [{ presetId: "standard_service", quantity: 2 }],
    },
    offer: offer(),
    offerVersion: 4,
    optionId: "opt-1",
    idempotencyKey: "communication:123:message:ABC:book",
    actor: { source: "communication-center", id: "agent", name: "DEMAC Agent" },
    now: new Date("2026-08-16T20:00:00-04:00"),
  });
  assert.equal(draft.bookingAuthorityVersion, BOOKING_AUTHORITY_VERSION);
  assert.equal(draft.status, "confirmed");
  assert.equal(draft.offerId, "offer-123");
  assert.equal(draft.selectedOptionId, "opt-1");
  assert.equal(draft.primaryVanId, "VAN-2");
  assert.match(draft.appointmentId, /^APT-[A-F0-9]{20}$/);
});

test("revalidation may refresh staff but may not silently change date/time", () => {
  const refreshed = {
    ...offer().options[0],
    assignments: [{ vanId: "VAN-2", technicianIds: ["new-tech"], quantity: 2, slots: 2 }],
  };
  const draft = buildAppointmentDraft({
    request: { customerId: "client-1", propertyId: "property-1", workLines: [{ presetId: "standard_service", quantity: 2 }] },
    offer: offer(),
    offerVersion: 4,
    optionId: "opt-1",
    idempotencyKey: "communication:123:message:ABC:book",
    optionOverride: refreshed,
  });
  assert.deepEqual(draft.assignments[0].technicianIds, ["new-tech"]);
  assert.throws(
    () => buildAppointmentDraft({
      request: { customerId: "client-1", propertyId: "property-1", workLines: [{ presetId: "standard_service", quantity: 2 }] },
      offer: offer(),
      offerVersion: 4,
      optionId: "opt-1",
      idempotencyKey: "communication:123:message:ABC:book",
      optionOverride: { ...refreshed, time: "14:30" },
    }),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
  );
});
