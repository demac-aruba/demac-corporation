const crypto = require('node:crypto');
const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require('./bookingAuthorityCore');

function stable(value) {
  if (value && typeof value.toJSON === 'function') return stable(value.toJSON());
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => [key, stable(value[key])]));
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function appointmentStateToken(appointment) {
  const { lifecycleToken, ...state } = appointment;
  return `ba1-${digest(state)}`;
}
function assertAppointmentToken(appointment, expected) {
  if (typeof expected !== 'string' || !/^ba1-[a-f0-9]{64}$/.test(expected)) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Reload the appointment before changing it.', { reason: 'appointment_token_required' });
  }
  if (appointmentStateToken(appointment) !== expected) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      'This appointment changed after it was loaded. Reload and review the current work before changing it.',
      { reason: 'appointment_version_conflict' });
  }
}
function lifecycleActorId(actor) {
  const id = cleanText(actor?.id || actor?.userId, 160);
  if (!id) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
    'An authenticated Office actor is required.', { reason: 'lifecycle_actor_required' });
  return id;
}
function assertLifecycleContext(offer, appointment, actor, changeKind) {
  const binding = offer?.lifecycleContext;
  if (!binding || binding.version !== 1 || binding.appointmentId !== appointment.id
      || binding.actorId !== lifecycleActorId(actor) || binding.changeKind !== changeKind) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Obtain a new change offer for this appointment and operator.', { reason: 'lifecycle_offer_mismatch' });
  }
  assertAppointmentToken(appointment, binding.expectedAppointmentToken);
}
function assertSameLifecycleContext(left, right) {
  if (digest(left || null) !== digest(right || null)) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'This availability request belongs to a different appointment change.', { reason: 'lifecycle_offer_conflict' });
  }
}
function assertCreationOffer(offer, context = {}) {
  if (offer?.lifecycleContext) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
    'An appointment change offer cannot create a new booking or hold.', { reason: 'lifecycle_offer_not_creation' });
  if (Boolean(offer?.followUpContext) !== Boolean(context.sourcePartialAppointmentId)
      || (offer?.followUpContext && (offer.followUpContext.sourcePartialAppointmentId !== context.sourcePartialAppointmentId
        || offer.followUpContext.sourcePartialOutcomeRevision !== context.sourcePartialOutcomeRevision))) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Use the remaining-work workflow and its original offer.', { reason: 'remaining_work_offer_conflict' });
  }
}
function lifecycleIntent({ action, requestId, actor, data }) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,240}$/.test(requestId)) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      'A stable requestId is required for this appointment change.', { reason: 'lifecycle_request_required' });
  }
  const actorId = lifecycleActorId(actor);
  return { id: `BL-${digest({ actorId, requestId })}`, actorId, requestId, action,
    requestHash: digest({ action, data }) };
}
function replayLifecycle(receipt, intent, appointment) {
  if (!receipt) return null;
  if (receipt.version !== 1 || receipt.actorId !== intent.actorId || receipt.action !== intent.action
      || receipt.requestId !== intent.requestId || receipt.requestHash !== intent.requestHash
      || receipt.result?.appointmentId !== appointment.id) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'This requestId was already used for another appointment change.', { reason: 'lifecycle_request_conflict' });
  }
  return { ...receipt.result, appointment, replayed: true, customerNotificationRecommended: false };
}
function lifecycleReceipt(intent, result, occurredAt) {
  const { appointment, ...acknowledgement } = result;
  return { ...intent, version: 1, occurredAt, result: acknowledgement };
}
module.exports = { appointmentStateToken, assertAppointmentToken, lifecycleActorId,
  assertLifecycleContext, assertSameLifecycleContext, assertCreationOffer, lifecycleIntent,
  replayLifecycle, lifecycleReceipt };
