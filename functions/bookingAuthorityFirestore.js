const crypto = require("node:crypto");
const {
  BOOKING_AUTHORITY_VERSION,
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  buildAppointmentDraft,
  canonicalAppointmentIdentity,
  cleanText,
  hashKey,
  normalizeBookingRequest,
  normalizeOfferOption,
  validateOfferSelection,
} = require("./bookingAuthorityCore");

const BOOKING_COLLECTIONS = Object.freeze({
  offers: "bookingOffers",
  appointments: "appointments",
  capacityLocks: "bookingCapacityLocks",
  idempotency: "bookingIdempotency",
  workOrders: "workOrders",
  clients: "clients",
  properties: "properties",
});

const BOOKING_CREATE_MODES = Object.freeze({
  CONFIRMED: "confirmed",
  TEMPORARY_HOLD: "temporary_hold",
});

function normalizeCreateMode(value) {
  return value === BOOKING_CREATE_MODES.TEMPORARY_HOLD
    ? BOOKING_CREATE_MODES.TEMPORARY_HOLD
    : BOOKING_CREATE_MODES.CONFIRMED;
}

function createModeFromAppointment(appointment) {
  return cleanText(appointment?.status, 40) === BOOKING_CREATE_MODES.TEMPORARY_HOLD
    ? BOOKING_CREATE_MODES.TEMPORARY_HOLD
    : BOOKING_CREATE_MODES.CONFIRMED;
}

function defaultServerTimestamp() {
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    output[key] = compactObject(item);
  }
  return output;
}

function providerError(error, operation) {
  if (error instanceof BookingAuthorityError) return error;
  return new BookingAuthorityError(
    BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
    `Booking availability provider failed during ${operation}.`,
    { operation, cause: cleanText(error?.message || error, 500) },
  );
}

function requireProviderMethod(provider, method) {
  if (!provider || typeof provider[method] !== "function") {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
      `Booking availability provider must implement ${method}().`,
      { method },
    );
  }
  return provider[method].bind(provider);
}

function canonicalOfferIdentity(requestKey) {
  const key = cleanText(requestKey, 500);
  return key
    ? `OFR-${hashKey(key, 20).toUpperCase()}`
    : `OFR-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}

function offerStillUsable(offer, now) {
  if (!offer || offer.status !== "open") return false;
  const expiry = Date.parse(String(offer.expiresAt || ""));
  return Number.isFinite(expiry) && expiry > now.getTime();
}

function actorFields(actor = {}) {
  return {
    source: cleanText(actor.source, 80) || "booking-authority",
    actorId: cleanText(actor.id || actor.userId, 160),
    actorName: cleanText(actor.name || actor.displayName, 160),
  };
}

function requestFingerprint(request) {
  return hashKey(JSON.stringify(normalizeBookingRequest(request)), 40);
}

function createAppointmentFingerprint({ appointmentId, offerId, offerVersion, optionId, createMode }) {
  return hashKey(JSON.stringify({
    appointmentId: cleanText(appointmentId, 180),
    offerId: cleanText(offerId, 180),
    offerVersion: Number(offerVersion),
    optionId: cleanText(optionId, 180),
    createMode: normalizeCreateMode(createMode),
  }), 40);
}

function appointmentStillOwnsCapacityLock(appointment, lockId) {
  if (!appointment) return false;
  const status = cleanText(appointment.status, 40).toLowerCase();
  if (["cancelled", "canceled", "cancelada"].includes(status)) return false;
  return Array.isArray(appointment.capacityLockIds)
    && appointment.capacityLockIds.map((value) => cleanText(value, 180)).includes(cleanText(lockId, 180));
}

async function findLiveForeignCapacityLocks({ transaction, db, collections, lockSnapshots, appointmentId }) {
  const foreign = (lockSnapshots || []).filter((entry) => {
    if (!entry?.snapshot?.exists) return false;
    const stored = entry.snapshot.data() || {};
    return stored.active !== false && cleanText(stored.appointmentId, 180) !== cleanText(appointmentId, 180);
  });
  if (!foreign.length) return [];

  const ownerIds = [...new Set(foreign
    .map((entry) => cleanText(entry.snapshot.data()?.appointmentId, 180))
    .filter(Boolean))];
  const ownerSnapshots = await Promise.all(ownerIds.map(async (ownerId) => ({
    ownerId,
    snapshot: await transaction.get(db.collection(collections.appointments).doc(ownerId)),
  })));
  const owners = new Map(ownerSnapshots.map(({ ownerId, snapshot }) => [
    ownerId,
    snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null,
  ]));

  return foreign.filter((entry) => {
    const ownerId = cleanText(entry.snapshot.data()?.appointmentId, 180);
    return appointmentStillOwnsCapacityLock(owners.get(ownerId), entry.lock?.id || entry.lockId);
  }).map((entry) => ({
    ...entry,
    ownerId: cleanText(entry.snapshot.data()?.appointmentId, 180),
  }));
}

function assertCustomerPropertyRelationship({ customerSnapshot, propertySnapshot, request }) {
  if (!customerSnapshot.exists) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND,
      "The customer no longer exists in the ERP.",
      { customerId: request.customerId },
    );
  }
  if (!propertySnapshot.exists) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.PROPERTY_NOT_FOUND,
      "The property no longer exists in the ERP.",
      { propertyId: request.propertyId },
    );
  }
  const property = { id: propertySnapshot.id, ...propertySnapshot.data() };
  if (cleanText(property.clientId, 160) !== request.customerId) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH,
      "The selected property does not belong to the selected customer.",
      { customerId: request.customerId, propertyId: request.propertyId, propertyClientId: property.clientId || "" },
    );
  }
  return {
    customer: { id: customerSnapshot.id, ...customerSnapshot.data() },
    property,
  };
}

function validateCapacityLocks(locks) {
  if (!Array.isArray(locks) || !locks.length) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
      "The scheduling provider did not return capacity locks for the selected option.",
    );
  }
  const seen = new Set();
  return locks.map((lock, index) => {
    const id = cleanText(lock?.id || lock?.key, 180);
    if (!id || seen.has(id)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
        "The scheduling provider returned an invalid capacity lock.",
        { index, id },
      );
    }
    seen.add(id);
    return {
      id,
      date: cleanText(lock.date, 20),
      vanId: cleanText(lock.vanId, 120),
      slot: cleanText(lock.slot, 20),
    };
  });
}

function validateWorkOrders(workOrders, appointmentId) {
  if (!Array.isArray(workOrders) || !workOrders.length) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
      "The scheduling provider did not build any work orders for the appointment.",
    );
  }
  const seen = new Set();
  return workOrders.map((workOrder, index) => {
    const id = cleanText(workOrder?.id, 180);
    if (!id || seen.has(id)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
        "The scheduling provider returned an invalid work order id.",
        { index, id },
      );
    }
    seen.add(id);
    return compactObject({ ...workOrder, id, appointmentId });
  });
}

function notificationRecipientsFrom(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map((item) => compactObject({ ...item })) : [];
}

function createBookingAuthority({
  db,
  availabilityProvider,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  offerTtlMinutes = 30,
  collections = BOOKING_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }

  async function checkAvailability({ request, actor = {}, context = {} } = {}) {
    const normalizedRequest = normalizeBookingRequest(request);
    const now = asDate(clock());
    const requestKey = cleanText(context.requestKey || context.inboundMessageId || context.idempotencyKey, 500);
    const offerId = canonicalOfferIdentity(requestKey);
    const offerRef = db.collection(collections.offers).doc(offerId);

    if (requestKey) {
      const existingSnapshot = await offerRef.get();
      if (existingSnapshot.exists) {
        const existing = { id: existingSnapshot.id, ...existingSnapshot.data() };
        if (existing.requestFingerprint === requestFingerprint(normalizedRequest) && offerStillUsable(existing, now)) {
          return { success: true, available: true, replayed: true, offer: existing, options: existing.options || [] };
        }
      }
    }

    let result;
    try {
      const check = requireProviderMethod(availabilityProvider, "checkAvailability");
      result = await check({ request: normalizedRequest, context, now });
    } catch (error) {
      throw providerError(error, "checkAvailability");
    }

    const rawOptions = Array.isArray(result?.options) ? result.options : [];
    const options = rawOptions.map((option, index) => normalizeOfferOption(option, index));
    if (!options.length) {
      return {
        success: true,
        available: false,
        replayed: false,
        offer: null,
        options: [],
        reason: cleanText(result?.reason, 160) || BOOKING_ERROR_CODES.NO_AVAILABILITY,
        metadata: compactObject(result?.metadata || {}),
      };
    }

    const ttl = Math.max(5, Math.min(180, Number(offerTtlMinutes) || 30));
    const expiresAt = new Date(now.getTime() + ttl * 60_000).toISOString();
    const actorInfo = actorFields(actor);
    const notificationRecipients = notificationRecipientsFrom(context.notificationRecipients);
    const offer = compactObject({
      id: offerId,
      bookingAuthorityVersion: BOOKING_AUTHORITY_VERSION,
      version: 1,
      status: "open",
      request: normalizedRequest,
      requestFingerprint: requestFingerprint(normalizedRequest),
      options,
      providerVersion: cleanText(result?.providerVersion, 120),
      metadata: {
        ...(result?.metadata || {}),
        ...(notificationRecipients.length ? { notificationRecipients } : {}),
      },
      createdAtIso: now.toISOString(),
      updatedAtIso: now.toISOString(),
      expiresAt,
      ...actorInfo,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await offerRef.set(offer);
    return { success: true, available: true, replayed: false, offer, options };
  }

  async function getAppointment(appointmentId) {
    const id = cleanText(appointmentId, 180);
    if (!id) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "appointmentId is required.",
        { field: "appointmentId" },
      );
    }
    const snapshot = await db.collection(collections.appointments).doc(id).get();
    if (!snapshot.exists) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.APPOINTMENT_NOT_FOUND,
        "The appointment does not exist.",
        { appointmentId: id },
      );
    }
    return { id: snapshot.id, ...snapshot.data() };
  }

  async function createAppointment({
    offerId,
    offerVersion,
    optionId,
    idempotencyKey,
    actor = {},
    context = {},
    createMode = BOOKING_CREATE_MODES.CONFIRMED,
    // Server-internal callback only. Callable/HTTP adapters never forward this field.
    // It lets another authority join this exact Firestore transaction without
    // creating a second, failure-prone commit boundary.
    internalTransactionParticipant = null,
  } = {}) {
    const canonicalOfferId = cleanText(offerId, 180);
    if (!canonicalOfferId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "offerId is required.",
        { field: "offerId" },
      );
    }
    const normalizedCreateMode = normalizeCreateMode(createMode);
    const temporaryHold = normalizedCreateMode === BOOKING_CREATE_MODES.TEMPORARY_HOLD;
    if (internalTransactionParticipant !== null && typeof internalTransactionParticipant !== "function") {
      throw new TypeError("internalTransactionParticipant must be a server-internal function.");
    }
    const now = asDate(clock());
    const identity = canonicalAppointmentIdentity(idempotencyKey);
    const offerRef = db.collection(collections.offers).doc(canonicalOfferId);
    const appointmentRef = db.collection(collections.appointments).doc(identity.appointmentId);
    const idempotencyRef = db.collection(collections.idempotency).doc(identity.idempotencyKeyHash);
    const createRequestFingerprint = createAppointmentFingerprint({
      appointmentId: identity.appointmentId,
      offerId: canonicalOfferId,
      offerVersion,
      optionId,
      createMode: normalizedCreateMode,
    });
    const sameIdempotencyRequest = (record = {}) => record.offerId === canonicalOfferId
      && Number(record.offerVersion) === Number(offerVersion)
      && record.optionId === cleanText(optionId, 180)
      && record.appointmentId === identity.appointmentId
      && normalizeCreateMode(record.createMode) === normalizedCreateMode
      && (!cleanText(record.createRequestFingerprint, 80)
        || cleanText(record.createRequestFingerprint, 80) === createRequestFingerprint);
    const sameAppointmentRequest = (appointment = {}) => {
      if (cleanText(appointment.idempotencyKeyHash, 80) !== identity.idempotencyKeyHash) return false;
      const storedFingerprint = cleanText(appointment.createRequestFingerprint, 80);
      if (storedFingerprint) return storedFingerprint === createRequestFingerprint;
      return cleanText(appointment.offerId, 180) === canonicalOfferId
        && Number(appointment.offerVersion) === Number(offerVersion)
        && cleanText(appointment.selectedOptionId, 180) === cleanText(optionId, 180)
        && createModeFromAppointment(appointment) === normalizedCreateMode;
    };
    const idempotencyRecord = (recordNow) => compactObject({
      id: identity.idempotencyKeyHash,
      appointmentId: identity.appointmentId,
      offerId: canonicalOfferId,
      offerVersion: Number(offerVersion),
      optionId: cleanText(optionId, 180),
      createMode: normalizedCreateMode,
      createRequestFingerprint,
      operation: temporaryHold ? "createTemporaryHold" : "createAppointment",
      ...actorFields(actor),
      createdAtIso: recordNow.toISOString(),
      createdAt: serverTimestamp(),
    });
    const replayResult = (appointment) => ({
      success: true,
      replayed: true,
      createMode: createModeFromAppointment(appointment),
      appointmentId: appointment.appointmentId || appointment.id,
      appointment,
      workOrderIds: appointment.workOrderIds || [],
    });

    const [existingIdempotencySnapshot, existingAppointmentSnapshot] = await Promise.all([
      idempotencyRef.get(),
      appointmentRef.get(),
    ]);
    if (existingIdempotencySnapshot.exists) {
      const record = existingIdempotencySnapshot.data();
      if (!sameIdempotencyRequest(record)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "This idempotency key was already used for a different booking request.",
          { appointmentId: record.appointmentId || "" },
        );
      }
      const replay = await getAppointment(record.appointmentId);
      return replayResult(replay);
    }

    // A canonical appointment and its idempotency document are normally committed
    // together. If an older/imported graph is missing only the idempotency record,
    // repair it without requiring the already-consumed offer to still be open.
    if (existingAppointmentSnapshot.exists) {
      return db.runTransaction(async (transaction) => {
        const repairNow = asDate(clock());
        const [currentIdempotencySnapshot, currentAppointmentSnapshot] = await Promise.all([
          transaction.get(idempotencyRef),
          transaction.get(appointmentRef),
        ]);
        if (currentIdempotencySnapshot.exists && !sameIdempotencyRequest(currentIdempotencySnapshot.data() || {})) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This idempotency key was already used for a different booking request.",
            { appointmentId: cleanText(currentIdempotencySnapshot.data()?.appointmentId, 180) },
          );
        }
        if (!currentAppointmentSnapshot.exists) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The canonical appointment disappeared while repairing its idempotency record.",
            { appointmentId: identity.appointmentId },
          );
        }
        const existing = { id: currentAppointmentSnapshot.id, ...currentAppointmentSnapshot.data() };
        if (!sameAppointmentRequest(existing)) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The canonical appointment id already exists for a different booking request.",
            { appointmentId: identity.appointmentId },
          );
        }
        if (!currentIdempotencySnapshot.exists) transaction.set(idempotencyRef, idempotencyRecord(repairNow));
        return replayResult(existing);
      });
    }

    const initialOfferSnapshot = await offerRef.get();
    const initialOffer = initialOfferSnapshot.exists ? { id: initialOfferSnapshot.id, ...initialOfferSnapshot.data() } : null;
    const initiallySelected = validateOfferSelection({ offer: initialOffer, offerVersion, optionId, now });

    let revalidation;
    try {
      const revalidate = requireProviderMethod(availabilityProvider, "revalidateSelection");
      revalidation = await revalidate({
        request: normalizeBookingRequest(initialOffer.request),
        offer: initialOffer,
        option: initiallySelected,
        context,
        now,
      });
    } catch (error) {
      throw providerError(error, "revalidateSelection");
    }
    if (!revalidation || revalidation.available !== true || !revalidation.option) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
        "The selected appointment option is no longer available.",
        { reason: cleanText(revalidation?.reason, 240) },
      );
    }
    const refreshedOption = normalizeOfferOption(revalidation.option);

    return db.runTransaction(async (transaction) => {
      const transactionNow = asDate(clock());
      const [idempotencySnapshot, appointmentSnapshot, currentOfferSnapshot] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(appointmentRef),
        transaction.get(offerRef),
      ]);

      if (idempotencySnapshot.exists) {
        const record = idempotencySnapshot.data();
        if (!sameIdempotencyRequest(record)) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This idempotency key was already used for a different booking request.",
            { appointmentId: record.appointmentId || "" },
          );
        }
        const replaySnapshot = appointmentSnapshot.exists
          ? appointmentSnapshot
          : await transaction.get(db.collection(collections.appointments).doc(record.appointmentId));
        if (!replaySnapshot.exists) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The idempotency record exists without its canonical appointment.",
            { appointmentId: record.appointmentId || "" },
          );
        }
        const replay = { id: replaySnapshot.id, ...replaySnapshot.data() };
        return replayResult(replay);
      }

      if (appointmentSnapshot.exists) {
        const existing = { id: appointmentSnapshot.id, ...appointmentSnapshot.data() };
        if (!sameAppointmentRequest(existing)) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The canonical appointment id already exists for a different booking request.",
            { appointmentId: identity.appointmentId },
          );
        }
        transaction.set(idempotencyRef, idempotencyRecord(transactionNow));
        return replayResult(existing);
      }

      const currentOffer = currentOfferSnapshot.exists ? { id: currentOfferSnapshot.id, ...currentOfferSnapshot.data() } : null;
      validateOfferSelection({ offer: currentOffer, offerVersion, optionId, now: transactionNow });
      const request = normalizeBookingRequest(currentOffer.request);
      const customerRef = db.collection(collections.clients).doc(request.customerId);
      const propertyRef = db.collection(collections.properties).doc(request.propertyId);
      const [customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(customerRef),
        transaction.get(propertyRef),
      ]);
      const { customer, property } = assertCustomerPropertyRelationship({ customerSnapshot, propertySnapshot, request });

      let transactionValidation;
      try {
        const validateTransaction = requireProviderMethod(availabilityProvider, "validateTransaction");
        transactionValidation = await validateTransaction({
          transaction,
          db,
          request,
          offer: currentOffer,
          option: refreshedOption,
          appointmentId: identity.appointmentId,
          context,
          now: transactionNow,
        });
      } catch (error) {
        throw providerError(error, "validateTransaction");
      }
      if (!transactionValidation || transactionValidation.available !== true) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected appointment capacity was occupied before the booking could be committed.",
          { reason: cleanText(transactionValidation?.reason, 240) },
        );
      }
      const committedOption = normalizeOfferOption(transactionValidation.option || refreshedOption);
      const locks = validateCapacityLocks(transactionValidation.capacityLocks);
      const lockSnapshots = [];
      for (const lock of locks) {
        const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
        lockSnapshots.push({ lock, lockRef, snapshot: await transaction.get(lockRef) });
      }
      const liveForeignLocks = await findLiveForeignCapacityLocks({
        transaction,
        db,
        collections,
        lockSnapshots,
        appointmentId: identity.appointmentId,
      });
      if (liveForeignLocks.length) {
        const entry = liveForeignLocks[0];
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected appointment capacity was occupied concurrently.",
          { date: entry.lock.date, vanId: entry.lock.vanId, slot: entry.lock.slot, appointmentId: entry.ownerId },
        );
      }

      const appointment = buildAppointmentDraft({
        request,
        offer: currentOffer,
        offerVersion,
        optionId,
        idempotencyKey,
        actor,
        now: transactionNow,
        optionOverride: committedOption,
      });
      const notificationRecipients = notificationRecipientsFrom(currentOffer?.metadata?.notificationRecipients);
      let workOrders;
      try {
        const buildWorkOrders = requireProviderMethod(availabilityProvider, "buildWorkOrders");
        workOrders = validateWorkOrders(await buildWorkOrders({
          appointment: { ...appointment, status: normalizedCreateMode },
          option: committedOption,
          request,
          customer,
          property,
          actor,
          context: { ...context, notificationRecipients, appointmentState: normalizedCreateMode },
          now: transactionNow,
        }), identity.appointmentId);
      } catch (error) {
        throw providerError(error, "buildWorkOrders");
      }
      const workOrderIds = workOrders.map((item) => item.id);
      const participantResult = internalTransactionParticipant
        ? (await internalTransactionParticipant({
          transaction,
          appointmentId: identity.appointmentId,
          request,
          now: transactionNow,
        })) || {}
        : {};
      if (!participantResult || typeof participantResult !== "object" || Array.isArray(participantResult)) {
        throw new TypeError("internalTransactionParticipant must return an object when it returns a value.");
      }
      const participantAppointmentPatch = compactObject(
        participantResult.appointmentPatch && typeof participantResult.appointmentPatch === "object"
          ? participantResult.appointmentPatch
          : {},
      );
      const participantWorkOrderPatch = compactObject(
        participantResult.workOrderPatch && typeof participantResult.workOrderPatch === "object"
          ? participantResult.workOrderPatch
          : {},
      );
      const appointmentRecord = compactObject({
        ...participantAppointmentPatch,
        ...appointment,
        createRequestFingerprint,
        status: normalizedCreateMode,
        notificationRecipients,
        workOrderIds,
        capacityLockIds: locks.map((lock) => lock.id),
        ...(temporaryHold
          ? {
            heldAtIso: transactionNow.toISOString(),
            holdPolicy: "manual-confirm-or-cancel",
          }
          : { confirmedAtIso: transactionNow.toISOString() }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(appointmentRef, appointmentRecord);
      workOrders.forEach((workOrder) => {
        transaction.set(db.collection(collections.workOrders).doc(workOrder.id), compactObject({
          ...participantWorkOrderPatch,
          ...workOrder,
          bookingAuthorityVersion: BOOKING_AUTHORITY_VERSION,
          bookingOfferId: canonicalOfferId,
          createdAt: workOrder.createdAt || transactionNow.toISOString(),
          updatedAt: transactionNow.toISOString(),
        }));
      });
      lockSnapshots.forEach(({ lock, lockRef }) => {
        transaction.set(lockRef, compactObject({
          ...lock,
          appointmentId: identity.appointmentId,
          active: true,
          createdAtIso: transactionNow.toISOString(),
          updatedAtIso: transactionNow.toISOString(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });
      transaction.set(offerRef, compactObject({
        status: temporaryHold ? "held" : "booked",
        selectedOptionId: cleanText(optionId, 180),
        appointmentId: identity.appointmentId,
        workOrderIds,
        ...(temporaryHold
          ? {
            heldAtIso: transactionNow.toISOString(),
            heldAt: serverTimestamp(),
          }
          : {
            bookedAtIso: transactionNow.toISOString(),
            bookedAt: serverTimestamp(),
          }),
        updatedAtIso: transactionNow.toISOString(),
        updatedAt: serverTimestamp(),
      }), { merge: true });
      transaction.set(idempotencyRef, idempotencyRecord(transactionNow));

      return {
        success: true,
        replayed: false,
        createMode: normalizedCreateMode,
        appointmentId: identity.appointmentId,
        appointment: appointmentRecord,
        workOrderIds,
      };
    });
  }

  return {
    version: BOOKING_AUTHORITY_VERSION,
    collections,
    checkAvailability,
    createAppointment,
    getAppointment,
  };
}

module.exports = {
  BOOKING_COLLECTIONS,
  BOOKING_CREATE_MODES,
  appointmentStillOwnsCapacityLock,
  assertCustomerPropertyRelationship,
  canonicalOfferIdentity,
  compactObject,
  createAppointmentFingerprint,
  createBookingAuthority,
  createModeFromAppointment,
  findLiveForeignCapacityLocks,
  normalizeCreateMode,
  notificationRecipientsFrom,
  requestFingerprint,
  validateCapacityLocks,
  validateWorkOrders,
};
