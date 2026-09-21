const crypto = require("node:crypto");
const { appointmentStateToken, assertAppointmentToken, lifecycleActorId,
  assertSameLifecycleContext, assertCreationOffer } = require('./bookingLifecycleIntent');
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

function sameProjectContext(left, right) {
  if (!left || !right) return left === right;
  const keys = ["schemaVersion", "projectId", "phaseId", "expectedVersion", "actorId",
    ...(left.sourcePartialAppointmentId ? ['sourcePartialAppointmentId', 'sourcePartialOutcomeRevision'] : [])];
  return Object.keys(left).length === keys.length && Object.keys(right).length === keys.length
    && keys.every(key => left[key] === right[key]);
}

function requestFingerprint(request) {
  return hashKey(JSON.stringify(normalizeBookingRequest(request)), 40);
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

function backdatedOfferMetadata(offer) {
  const metadata = offer?.metadata || {};
  return metadata.bookingMode === "backdated" && metadata.backdatingAcknowledged === true
    ? {
      bookingMode: "backdated",
      backdatingAcknowledged: true,
      workAlreadyPerformed: true,
    }
    : null;
}

function assertBackdatedCreateIntent({ offer, context = {}, createMode }) {
  const offerIsBackdated = Boolean(backdatedOfferMetadata(offer));
  const contextIsBackdated = context.channel === "office"
    && context.bookingMode === "backdated"
    && context.backdatingAcknowledged === true;
  if (offerIsBackdated !== contextIsBackdated) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "The confirmed backdating intent does not match the selected booking offer.",
      { reason: "backdating-intent-mismatch" },
    );
  }
  if (offerIsBackdated && normalizeCreateMode(createMode) === BOOKING_CREATE_MODES.TEMPORARY_HOLD) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Backdated work must be recorded as a confirmed appointment, not a temporary hold.",
      { reason: "backdating-temporary-hold-not-allowed" },
    );
  }
  return offerIsBackdated;
}

function createBookingAuthority({
  db,
  availabilityProvider,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  offerTtlMinutes = 30,
  collections = BOOKING_COLLECTIONS,
  projectIntegration = null,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }

  async function checkAvailability({ request, actor = {}, context = {} } = {}) {
    const normalizedRequest = normalizeBookingRequest(request);
    const lifecycleAppointmentId = cleanText(context.excludeAppointmentId, 180);
    let lifecycleContext = null;
    if (lifecycleAppointmentId) {
      const appointment = await getAppointment(lifecycleAppointmentId);
      assertAppointmentToken(appointment, context.expectedAppointmentToken);
      if (appointment.customerId !== normalizedRequest.customerId || appointment.propertyId !== normalizedRequest.propertyId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'The appointment identity does not match the requested work.');
      }
      lifecycleContext = { version: 1, appointmentId: lifecycleAppointmentId, actorId: lifecycleActorId(actor),
        expectedAppointmentToken: context.expectedAppointmentToken, changeKind: context.changeKind || 'customer_reschedule' };
    }
    const followUp = context.sourcePartialAppointmentId !== undefined;
    if (followUp && lifecycleAppointmentId) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'A remaining-work offer cannot change its original appointment.');
    if ((context.projectSelection !== undefined || followUp) && !projectIntegration) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Central Project booking is not configured.", { reason: "project_booking_not_active" });
    }
    const preparedFollowUp = followUp ? await projectIntegration.prepareFollowUpOffer({ request: normalizedRequest, actor, context }) : null;
    const followUpContext = preparedFollowUp?.followUpContext || null;
    const projectContext = preparedFollowUp ? preparedFollowUp.projectContext : context.projectSelection === undefined
      ? null : await projectIntegration.prepareOffer({ request: normalizedRequest, actor, context });
    const now = asDate(clock());
    const requestKey = cleanText(context.requestKey || context.inboundMessageId || context.idempotencyKey, 500);
    const offerId = canonicalOfferIdentity(requestKey);
    const offerRef = db.collection(collections.offers).doc(offerId);

    if (requestKey) {
      const existingSnapshot = await offerRef.get();
      if (existingSnapshot.exists) {
        const existing = { id: existingSnapshot.id, ...existingSnapshot.data() };
        assertSameLifecycleContext(existing.lifecycleContext, lifecycleContext);
        assertSameLifecycleContext(existing.followUpContext, followUpContext);
        if (!sameProjectContext(existing.projectContext || null, projectContext)) {
          throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT, "This availability request belongs to another Project selection.", { reason: "project_offer_context_conflict" });
        }
        if ((lifecycleContext || followUpContext) && (existing.requestFingerprint !== requestFingerprint(normalizedRequest) || !offerStillUsable(existing, now))) {
          throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT, 'This change offer cannot be replaced. Obtain availability with a new requestId.', { reason: 'lifecycle_offer_request_conflict' });
        }
        if (existing.requestFingerprint === requestFingerprint(normalizedRequest) && offerStillUsable(existing, now)) {
          return { success: true, available: true, replayed: true, offer: existing, options: existing.options || [], metadata: compactObject(existing.metadata || {}) };
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
      ...(projectContext ? { projectContext } : {}),
      ...(lifecycleContext ? { lifecycleContext } : {}),
      ...(followUpContext ? { followUpContext } : {}),
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
    // Serialize ownership of an offer ID. A concurrent ordinary/Project check must not
    // overwrite the other's bound Project context between the initial read and this write.
    const persistedOffer = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(offerRef);
      if (lifecycleContext) {
        const latest = await transaction.get(db.collection(collections.appointments).doc(lifecycleAppointmentId));
        if (!latest.exists) throw new BookingAuthorityError(BOOKING_ERROR_CODES.APPOINTMENT_NOT_FOUND, 'The appointment no longer exists.');
        assertAppointmentToken({ id: latest.id, ...latest.data() }, lifecycleContext.expectedAppointmentToken);
      }
      if (current.exists) assertSameLifecycleContext(current.data().lifecycleContext, lifecycleContext);
      if (current.exists) assertSameLifecycleContext(current.data().followUpContext, followUpContext);
      if (current.exists && !sameProjectContext(current.data().projectContext || null, projectContext)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT, "This availability request belongs to another Project selection.", { reason: "project_offer_context_conflict" });
      }
      if (current.exists && (lifecycleContext || followUpContext)
          && (current.data().requestFingerprint !== offer.requestFingerprint || !offerStillUsable(current.data(), now))) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT, 'This change offer cannot be replaced. Obtain availability with a new requestId.', { reason: 'lifecycle_offer_request_conflict' });
      }
      if (current.exists && current.data().requestFingerprint === offer.requestFingerprint && offerStillUsable(current.data(), now)) {
        return { offer: { id: current.id, ...current.data() }, replayed: true };
      }
      transaction.set(offerRef, offer);
      return { offer, replayed: false };
    });
    return { success: true, available: true, replayed: persistedOffer.replayed, offer: persistedOffer.offer,
      options: persistedOffer.offer.options, metadata: compactObject(persistedOffer.offer.metadata || {}) };
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
    const appointment = { id: snapshot.id, ...snapshot.data() };
    return { ...appointment, lifecycleToken: appointmentStateToken(appointment) };
  }

  async function validateProjectReplay(transaction, appointment, actor, context) {
    if (context.sourcePartialAppointmentId || appointment.sourcePartialAppointmentId) {
      if (!projectIntegration) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'The existing follow-up requires reconciliation.', { reason: 'remaining_work_reconciliation_required' });
      await projectIntegration.validateFollowUpReplay({ transaction, appointment, actor, context });
    }
    if (!appointment.projectContext) return;
    if (!projectIntegration) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "This Project booking needs its configured recovery workflow.", { reason: "project_booking_not_active" });
    await projectIntegration.validateReplay({ transaction, appointment, actor, context });
  }

  async function createAppointment({
    offerId,
    offerVersion,
    optionId,
    idempotencyKey,
    actor = {},
    context = {},
    createMode = BOOKING_CREATE_MODES.CONFIRMED,
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
    const now = asDate(clock());
    const identity = canonicalAppointmentIdentity(idempotencyKey);
    const offerRef = db.collection(collections.offers).doc(canonicalOfferId);
    const idempotencyRef = db.collection(collections.idempotency).doc(identity.idempotencyKeyHash);

    const existingIdempotencySnapshot = await idempotencyRef.get();
    if (existingIdempotencySnapshot.exists) {
      const record = existingIdempotencySnapshot.data();
      const sameRequest = record.offerId === canonicalOfferId
        && Number(record.offerVersion) === Number(offerVersion)
        && record.optionId === cleanText(optionId, 180)
        && record.appointmentId === identity.appointmentId
        && normalizeCreateMode(record.createMode) === normalizedCreateMode;
      if (!sameRequest) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "This idempotency key was already used for a different booking request.",
          { appointmentId: record.appointmentId || "" },
        );
      }
      const replay = await getAppointment(record.appointmentId);
      await validateProjectReplay(null, replay, actor, context);
      return {
        success: true,
        replayed: true,
        createMode: createModeFromAppointment(replay),
        appointmentId: replay.appointmentId || replay.id,
        appointment: replay,
        workOrderIds: replay.workOrderIds || [],
      };
    }

    const initialOfferSnapshot = await offerRef.get();
    const initialOffer = initialOfferSnapshot.exists ? { id: initialOfferSnapshot.id, ...initialOfferSnapshot.data() } : null;
    assertCreationOffer(initialOffer, context);
    const initiallySelected = validateOfferSelection({ offer: initialOffer, offerVersion, optionId, now });
    assertBackdatedCreateIntent({ offer: initialOffer, context, createMode: normalizedCreateMode });

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
      const appointmentRef = db.collection(collections.appointments).doc(identity.appointmentId);
      const [idempotencySnapshot, appointmentSnapshot, currentOfferSnapshot] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(appointmentRef),
        transaction.get(offerRef),
      ]);

      if (idempotencySnapshot.exists) {
        const record = idempotencySnapshot.data();
        const sameRequest = record.offerId === canonicalOfferId
          && Number(record.offerVersion) === Number(offerVersion)
          && record.optionId === cleanText(optionId, 180)
          && record.appointmentId === identity.appointmentId
          && normalizeCreateMode(record.createMode) === normalizedCreateMode;
        if (!sameRequest) {
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
        await validateProjectReplay(transaction, replay, actor, context);
        return {
          success: true,
          replayed: true,
          createMode: createModeFromAppointment(replay),
          appointmentId: replay.appointmentId || replay.id,
          appointment: replay,
          workOrderIds: replay.workOrderIds || [],
        };
      }

      if (appointmentSnapshot.exists) {
        const existing = { id: appointmentSnapshot.id, ...appointmentSnapshot.data() };
        if (existing.idempotencyKeyHash !== identity.idempotencyKeyHash) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The canonical appointment id already exists with a different idempotency identity.",
            { appointmentId: identity.appointmentId },
          );
        }
        await validateProjectReplay(transaction, existing, actor, context);
        return {
          success: true,
          replayed: true,
          createMode: createModeFromAppointment(existing),
          appointmentId: existing.appointmentId || existing.id,
          appointment: existing,
          workOrderIds: existing.workOrderIds || [],
        };
      }

      const currentOffer = currentOfferSnapshot.exists ? { id: currentOfferSnapshot.id, ...currentOfferSnapshot.data() } : null;
      assertCreationOffer(currentOffer, context);
      validateOfferSelection({ offer: currentOffer, offerVersion, optionId, now });
      assertBackdatedCreateIntent({ offer: currentOffer, context, createMode: normalizedCreateMode });
      const backdatedMetadata = backdatedOfferMetadata(currentOffer);
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
          now,
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
      const locks = validateCapacityLocks(transactionValidation.capacityLocks);
      const lockSnapshots = [];
      for (const lock of locks) {
        const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
        lockSnapshots.push({ lock, lockRef, snapshot: await transaction.get(lockRef) });
      }
      for (const entry of lockSnapshots) {
        if (!entry.snapshot.exists) continue;
        const stored = entry.snapshot.data();
        if (stored.active !== false && stored.appointmentId !== identity.appointmentId) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.SLOT_CONFLICT,
            "The selected appointment capacity was occupied concurrently.",
            { date: entry.lock.date, vanId: entry.lock.vanId, slot: entry.lock.slot },
          );
        }
      }

      const appointment = buildAppointmentDraft({
        request,
        offer: currentOffer,
        offerVersion,
        optionId,
        idempotencyKey,
        actor,
        now,
        optionOverride: refreshedOption,
      });
      const notificationRecipients = backdatedMetadata
        ? []
        : notificationRecipientsFrom(currentOffer?.metadata?.notificationRecipients);
      let workOrders;
      try {
        const buildWorkOrders = requireProviderMethod(availabilityProvider, "buildWorkOrders");
        workOrders = validateWorkOrders(await buildWorkOrders({
          appointment: { ...appointment, status: normalizedCreateMode },
          option: refreshedOption,
          request,
          customer,
          property,
          actor,
          context: {
            ...context,
            notificationRecipients,
            appointmentState: normalizedCreateMode,
            ...(backdatedMetadata || {}),
          },
          now,
        }), identity.appointmentId);
      } catch (error) {
        throw providerError(error, "buildWorkOrders");
      }
      let projectWrite = null;
      let sourceWrite = null;
      if (currentOffer.followUpContext || context.sourcePartialAppointmentId) {
        if (!projectIntegration) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'Remaining-work integration is not configured.');
        const original = await projectIntegration.validateFollowUpCommit({ transaction, offer: currentOffer, appointment, actor, context });
        const { remainingWorkLinkPatch } = require('./bookingPartialCompletion');
        sourceWrite = { ref: db.collection(collections.appointments).doc(original.id),
          patch: remainingWorkLinkPatch({ original, followUpAppointmentId: identity.appointmentId, actor,
            requestId: context.officeRequestId, now, serverTimestamp }) };
        workOrders = workOrders.map(order => ({ ...order, sourcePartialAppointmentId: original.id,
          sourcePartialOutcomeRevision: currentOffer.followUpContext.sourcePartialOutcomeRevision, workRelationship: 'remaining_work_follow_up' }));
      }
      if (currentOffer.projectContext) {
        if (!projectIntegration) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Central Project booking is not configured.", { reason: "project_booking_not_active" });
        projectWrite = await projectIntegration.prepareCommit({ transaction, appointment, workOrders,
          boundContext: currentOffer.projectContext, actor, context, now });
      }
      const workOrderIds = workOrders.map((item) => item.id);
      const actorInfo = actorFields(actor);
      const appointmentRecord = compactObject({
        ...appointment,
        ...(currentOffer.projectContext ? { projectContext: currentOffer.projectContext } : {}),
        ...(currentOffer.followUpContext ? { sourcePartialAppointmentId: currentOffer.followUpContext.sourcePartialAppointmentId,
          sourcePartialOutcomeRevision: currentOffer.followUpContext.sourcePartialOutcomeRevision, workRelationship: 'remaining_work_follow_up' } : {}),
        status: normalizedCreateMode,
        notificationRecipients,
        workOrderIds,
        capacityLockIds: locks.map((lock) => lock.id),
        ...(backdatedMetadata
          ? {
            ...backdatedMetadata,
            backdated: true,
            backdatedRecordedAtIso: now.toISOString(),
          }
          : {}),
        ...(temporaryHold
          ? {
            heldAtIso: now.toISOString(),
            holdPolicy: "manual-confirm-or-cancel",
          }
          : { confirmedAtIso: now.toISOString() }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // All Project reads/validation are complete before ANY write. These commit or roll back
      // together with the canonical appointment, every Van Work Order and capacity lock.
      if (projectWrite) {
        transaction.create(projectWrite.linkRef, projectWrite.linkData);
        transaction.create(projectWrite.eventRef, projectWrite.eventData);
      }
      if (sourceWrite) transaction.set(sourceWrite.ref, sourceWrite.patch, { merge: true });
      transaction.set(appointmentRef, appointmentRecord);
      workOrders.forEach((workOrder) => {
        transaction.set(db.collection(collections.workOrders).doc(workOrder.id), compactObject({
          ...workOrder,
          bookingAuthorityVersion: BOOKING_AUTHORITY_VERSION,
          bookingOfferId: canonicalOfferId,
          createdAt: workOrder.createdAt || now.toISOString(),
          updatedAt: now.toISOString(),
        }));
      });
      lockSnapshots.forEach(({ lock, lockRef }) => {
        transaction.set(lockRef, compactObject({
          ...lock,
          appointmentId: identity.appointmentId,
          active: true,
          createdAtIso: now.toISOString(),
          updatedAtIso: now.toISOString(),
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
            heldAtIso: now.toISOString(),
            heldAt: serverTimestamp(),
          }
          : {
            bookedAtIso: now.toISOString(),
            bookedAt: serverTimestamp(),
          }),
        updatedAtIso: now.toISOString(),
        updatedAt: serverTimestamp(),
      }), { merge: true });
      transaction.set(idempotencyRef, compactObject({
        id: identity.idempotencyKeyHash,
        appointmentId: identity.appointmentId,
        offerId: canonicalOfferId,
        offerVersion: Number(offerVersion),
        optionId: cleanText(optionId, 180),
        createMode: normalizedCreateMode,
        operation: temporaryHold ? "createTemporaryHold" : "createAppointment",
        ...actorInfo,
        createdAtIso: now.toISOString(),
        createdAt: serverTimestamp(),
      }));

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
  assertBackdatedCreateIntent,
  assertCustomerPropertyRelationship,
  backdatedOfferMetadata,
  canonicalOfferIdentity,
  compactObject,
  createBookingAuthority,
  createModeFromAppointment,
  normalizeCreateMode,
  notificationRecipientsFrom,
  requestFingerprint,
  validateCapacityLocks,
  validateWorkOrders,
};
