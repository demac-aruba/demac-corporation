'use strict';

const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getFunctions } = require('firebase-admin/functions');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onTaskDispatched } = require('firebase-functions/tasks');
const { createMayaRecoveryCoordinator } = require('./mayaRecoveryCoordinator');
const { cancellationGeneration, TASK_NAME } = require('./mayaRecoveryAutomationPolicy');

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret('OPENAI_API_KEY');
// Cloud Tasks is only a wake-up transport; it contains no customer text, offer
// selection or scheduling authority. No task is enqueued during module loading.
const coordinator = createMayaRecoveryCoordinator({ db, taskQueue: {
  enqueue: (payload, options) => getFunctions(app).taskQueue(TASK_NAME).enqueue(payload, options),
} });

async function handleCancellationChange(event, service = coordinator) {
  const after = event.data?.after;
  const before = event.data?.before;
  if (!after?.exists) return { scheduled: false, reason: 'deleted_or_missing' };
  const appointment = { ...after.data(), id: after.id };
  const generation = cancellationGeneration(appointment);
  const previous = before?.exists ? cancellationGeneration({ ...before.data(), id: before.id }) : null;
  if (!generation || generation === previous) return { scheduled: false, reason: 'not_new_cancellation' };
  return service.scheduleCancellation({ cancelledAppointmentId: appointment.id, generation });
}

async function handleRecoveryOfferChange(event, service = coordinator) {
  const after = event.data?.after;
  const before = event.data?.before;
  if (!after?.exists) return { scheduled: false, reason: 'deleted_or_missing' };
  const offer = after.data();
  const old = before?.exists ? before.data() : null;
  const r = offer.recovery;
  if (!r?.automation || !['accepted', 'declined'].includes(r.state)
    || (old?.version === offer.version && old?.recovery?.state === r.state)) {
    return { scheduled: false, reason: 'not_new_recovery_result' };
  }
  // The worker, not this possibly duplicated/out-of-order event, decides whether
  // the opening can continue, using its recorded generation and exact offer.
  return service.scheduleCancellation({ cancelledAppointmentId: r.cancellationId, generation: r.automation.generation });
}

exports.startMayaRecoveryAfterCancellation = onDocumentWritten({
  document: 'appointments/{appointmentId}', region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, retry: true,
}, event => handleCancellationChange(event));
exports.continueMayaRecoveryAfterOffer = onDocumentWritten({
  document: 'bookingOffers/{offerId}', region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, retry: true,
}, event => handleRecoveryOfferChange(event));
exports.processMayaRecoveryOpening = onTaskDispatched({
  region: 'us-central1', memory: '512MiB', timeoutSeconds: 180, secrets: [openAiApiKey],
  retryConfig: { maxAttempts: 5, minBackoffSeconds: 15, maxBackoffSeconds: 300, maxDoublings: 4 },
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
}, request => coordinator.run(request.data || {}));

module.exports.handleCancellationChange = handleCancellationChange;
module.exports.handleRecoveryOfferChange = handleRecoveryOfferChange;
