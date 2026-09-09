'use strict';

const { randomUUID } = require('node:crypto');
const { createCustomerInterestRecovery } = require('./demacCustomerInterestRecovery');
const { createMayaRecoveryMatching, recoveryTarget } = require('./mayaRecoveryMatching');
const { createMayaRecoveryOfferService, transactionView, read, originalOwnership } = require('./mayaRecoveryOfferService');
const { createMayaRecoveryOfferOutbound, configuredContactPolicy, recoveryQueueId, assertQueueIdentity } = require('./mayaRecoveryOfferOutbound');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
const { digest } = require('./demacCustomerInterestHistory');
const { documentId } = require('./mayaOperationsReadModel');
const P = require('./mayaRecoveryOfferPolicy');
const A = require('./mayaRecoveryAutomationPolicy');
const need = P.requireCondition;
const REVIEW_CODES = new Set(['interest_recovery_disabled', 'permission_denied', 'stale_context', 'context_missing',
  'history_incomplete', 'history_identity_mismatch', 'history_too_large', 'identity_mismatch', 'scope_too_large',
  'invalid_request', 'evidence_missing', 'interest_review_failed', 'appointment_changed', 'interest_not_found',
  'idempotency_conflict', 'not_cancelled', 'invalid_cancellation', 'target_elapsed', 'configuration_missing']);
function expectedFailure(error) { return REVIEW_CODES.has(error?.code) || /^recovery_[a-z_]+$/.test(error?.code || ''); }
function taskIdentity(data) {
  need(data && !Array.isArray(data) && Object.keys(data).length === 2
    && typeof data.generation === 'string' && /^[a-f0-9]{64}$/i.test(data.generation), 'recovery_automation_task_invalid');
  return { cancelledAppointmentId: documentId(data.cancelledAppointmentId), generation: data.generation };
}

function createMayaRecoveryCoordinator({ db, taskQueue, clock = () => new Date(),
  reviewFactory = createCustomerInterestRecovery, offerFactory = createMayaRecoveryOfferService,
  outboundFactory = createMayaRecoveryOfferOutbound } = {}) {
  need(db && typeof db.runTransaction === 'function', 'recovery_transaction_required');
  async function load(reader, payload) {
    const [settings, comms, cancellation] = await Promise.all([
      read(reader, 'businessSettings', 'customer-agent'), read(reader, 'businessSettings', 'whatsapp'),
      read(reader, 'appointments', payload.cancelledAppointmentId),
    ]);
    const configured = A.configuredAutomation(settings || {}, clock());
    const contact = configuredContactPolicy(settings).policy;
    const account = String(comms?.communicationAccountId || '').trim().toLowerCase();
    need(account, 'recovery_account_changed');
    need(A.cancellationGeneration(cancellation) === payload.generation, 'recovery_automation_generation_changed');
    const target = recoveryTarget(cancellation, clock());
    need(Date.parse(cancellation.cancelledAtIso) >= Date.parse(configured.policy.activeSince), 'recovery_automation_historical_cancellation');
    const stored = cancellation.mayaRecoveryAutomation;
    if (stored !== undefined) A.validateAutomationState(stored, payload.generation, account);
    need(!stored || stored.policyFingerprint === configured.fingerprint, 'recovery_automation_policy_changed');
    return { settings, account, cancellation, target, configured, contact,
      state: stored || { version: A.VERSION, generation: payload.generation, account,
        policyFingerprint: configured.fingerprint, status: 'running', history: [] } };
  }
  async function schedule(payload, at = clock()) {
    need(taskQueue && typeof taskQueue.enqueue === 'function', 'recovery_automation_task_transport_missing');
    await taskQueue.enqueue(taskIdentity(payload), {
      scheduleDelaySeconds: Math.max(0, Math.ceil((at.getTime() - clock().getTime()) / 1000)),
      dispatchDeadlineSeconds: 180,
    });
  }
  async function scheduleCancellation({ cancelledAppointmentId, generation }) {
    const payload = taskIdentity({ cancelledAppointmentId, generation });
    try {
      await db.runTransaction(transaction => load(transactionView(db, transaction).db, payload), { readOnly: true });
    } catch (error) {
      if (expectedFailure(error)) return { scheduled: false, reason: error.code };
      throw error;
    }
    await schedule(payload);
    return { scheduled: true };
  }
  async function claim(payload) {
    return db.runTransaction(async transaction => {
      const current = await load(transactionView(db, transaction).db, payload);
      if (A.TERMINAL_STATES.has(current.state.status)) return { done: true, status: current.state.status };
      const leaseUntil = Date.parse(current.state.leaseUntilIso || '');
      if (current.state.leaseToken && leaseUntil > clock().getTime()) return { busy: true, until: new Date(leaseUntil) };
      const token = randomUUID();
      const state = { ...current.state, status: 'running', leaseToken: token,
        leaseUntilIso: new Date(clock().getTime() + A.LEASE_MS).toISOString(), updatedAtIso: clock().toISOString() };
      transaction.set(db.collection('appointments').doc(payload.cancelledAppointmentId), { mayaRecoveryAutomation: state }, { merge: true });
      return { ...current, state, token, payload };
    });
  }
  async function assertFence(reader, scope) {
    const current = await load(reader, scope.payload);
    need(current.state.leaseToken === scope.token && Date.parse(current.state.leaseUntilIso) > clock().getTime(),
      'recovery_automation_stale_worker');
    return current;
  }
  function fencedDb(scope) {
    return { collection: db.collection.bind(db), runTransaction: (callback, options) => db.runTransaction(async transaction => {
      const current = await assertFence(transactionView(db, transaction).db, scope);
      let prepared = null;
      const guarded = { get: transaction.get.bind(transaction), set: (ref, value, writeOptions) => {
        if (ref.path === `bookingOffers/${P.recoveryOfferId(current.account, scope.payload.cancelledAppointmentId)}`
          && value?.status === 'recovery_pending' && value.recovery?.state === 'prepared' && Number.isSafeInteger(value.version)) {
          need(!prepared && current.state.history.length < current.configured.policy.maxOffers
            && current.state.history.at(-1)?.outcome !== 'pending', 'recovery_automation_offer_limit');
          need(value.recovery.cancellationId === scope.payload.cancelledAppointmentId
            && value.recovery.account === current.account, 'recovery_automation_offer_changed');
          const automation = { version: A.VERSION, generation: scope.payload.generation,
            policyFingerprint: current.configured.fingerprint };
          value = { ...value, recovery: { ...value.recovery, automation } };
          value.recovery.fingerprint = P.offerFingerprint(value);
          prepared = { offerId: ref.id, offerVersion: value.version, caseId: value.recovery.caseId,
            conversationId: value.recovery.conversationId, fingerprint: value.recovery.fingerprint,
            preparedAtIso: clock().toISOString(), expiresAt: value.expiresAt, outcome: 'pending',
            date: value.options[0].date, time: value.options[0].time };
        }
        return transaction.set(ref, value, writeOptions);
      } };
      const result = await callback(guarded);
      if (prepared) transaction.set(db.collection('appointments').doc(scope.payload.cancelledAppointmentId), {
        mayaRecoveryAutomation: { ...current.state, history: [...current.state.history, prepared], updatedAtIso: clock().toISOString() },
      }, { merge: true });
      return result;
    }, options) };
  }
  async function finish(scope, status, reason, details = {}) {
    return db.runTransaction(async transaction => {
      const current = await assertFence(transactionView(db, transaction).db, scope);
      const state = { ...current.state, ...details, status, reason, leaseToken: null, leaseUntilIso: null, updatedAtIso: clock().toISOString() };
      transaction.set(db.collection('appointments').doc(scope.payload.cancelledAppointmentId), { mayaRecoveryAutomation: state }, { merge: true });
      return { processed: true, status, reason, offersRecorded: state.history.length, capacityReserved: false };
    });
  }
  async function releaseAfterError(scope, error) {
    // Releasing our own orchestration lease must not overwrite a newer worker or
    // touch any canonical scheduling fields, even after the policy is revoked.
    await db.runTransaction(async transaction => {
      const ref = db.collection('appointments').doc(scope.payload.cancelledAppointmentId);
      const snapshot = await transaction.get(ref);
      const state = snapshot.data()?.mayaRecoveryAutomation;
      if (!snapshot.exists || state?.leaseToken !== scope.token || state.generation !== scope.payload.generation) return;
      transaction.set(ref, { mayaRecoveryAutomation: { ...state, leaseToken: null, leaseUntilIso: null,
        status: expectedFailure(error) ? 'review_required' : 'running',
        reason: expectedFailure(error) ? error.code : 'transient_processing_failure', updatedAtIso: clock().toISOString() } }, { merge: true });
    });
  }
  async function currentOffer(scope, guarded) {
    return guarded.runTransaction(async transaction => {
      const reader = transactionView(guarded, transaction).db;
      const current = await load(reader, scope.payload);
      const entry = current.state.history.at(-1);
      const offer = await read(reader, 'bookingOffers', P.recoveryOfferId(current.account, scope.payload.cancelledAppointmentId));
      if (!entry) { need(!offer, 'recovery_automation_unowned_offer'); return { current, offer: null }; }
      need(offer && offer.id === entry.offerId && offer.version === entry.offerVersion
        && offer.recovery?.fingerprint === entry.fingerprint, 'recovery_automation_offer_changed');
      const r = P.assertOffer(offer, entry.offerVersion);
      need(r.automation?.generation === scope.payload.generation && r.automation.policyFingerprint === current.configured.fingerprint,
        'recovery_automation_offer_changed');
      need((['prepared', 'sent'].includes(r.state) && offer.status === 'recovery_pending' && !r.response)
        || (r.state === 'accepted' && offer.status === 'booked' && r.response?.decision === 'accept')
        || (r.state === 'declined' && offer.status === 'declined' && r.response?.decision === 'decline'),
      'recovery_automation_result_unproven');
      const queue = r.outbound?.queueId ? await read(reader, 'whatsappOutboundQueue', r.outbound.queueId) : null;
      need(!r.outbound || queue, 'recovery_automation_lost_queue');
      if (queue) {
        need(queue.id === recoveryQueueId(offer.id, offer.version), 'recovery_automation_offer_changed');
        assertQueueIdentity(queue.id, queue, offer, digest(current.contact));
        if (['sent', 'delivered', 'read'].includes(queue.status)) {
          const proof = await deliveryProof(reader, offer, queue.id, documentId(queue.messageId), clock());
          if (r.delivery) need(digest(proof) === digest(r.delivery), 'recovery_delivery_changed');
        }
      }
      if (r.response) need(queue && ['sent', 'delivered', 'read'].includes(queue.status) && r.delivery,
        'recovery_automation_result_unproven');
      if (r.state === 'accepted') {
        const [appointment, source, record] = await Promise.all([
          read(reader, 'appointments', r.appointmentId), read(reader, 'whatsappMessages', r.response.messageId),
          read(reader, 'communicationCases', r.caseId),
        ]);
        need(appointment?.status === 'confirmed' && appointment.offerId === offer.id && appointment.offerVersion === offer.version
          && appointment.selectedOptionId === offer.options[0].id
          && P.originalFingerprint(appointment) === r.response.canonicalFingerprint
          && source?.mayaRecoveryCompletion?.offerId === offer.id && source.mayaRecoveryCompletion.offerVersion === offer.version
          && source.mayaRecoveryCompletion.responseFingerprint === digest(r.response)
          && record?.state === 'FULFILLED' && record.fulfillment?.offerId === offer.id
          && record.fulfillment.offerVersion === offer.version && record.fulfillment.appointmentId === appointment.id,
        'recovery_automation_result_unproven');
        await originalOwnership(reader, appointment);
      }
      return { current, entry, offer, queue };
    }, { readOnly: true });
  }
  async function closePrevious(scope, guarded, offer, outcome) {
    await guarded.runTransaction(async transaction => {
      const reader = transactionView(guarded, transaction).db;
      const current = await load(reader, scope.payload);
      const latest = await read(reader, 'bookingOffers', offer.id);
      need(digest(latest) === digest(offer), 'recovery_automation_offer_changed');
      const conversation = await read(reader, 'communicationConversations', offer.recovery.conversationId);
      const history = current.state.history.map((entry, index) => index === current.state.history.length - 1
        ? { ...entry, outcome, closedAtIso: clock().toISOString(),
          responseMessageId: offer.recovery.response?.messageId || null,
          deliveryMessageId: offer.recovery.delivery?.messageId || null,
          responseFingerprint: offer.recovery.response ? digest(offer.recovery.response) : null }
        : entry);
      transaction.set(db.collection('appointments').doc(scope.payload.cancelledAppointmentId), {
        mayaRecoveryAutomation: { ...current.state, history, updatedAtIso: clock().toISOString() },
      }, { merge: true });
      if (outcome !== 'accepted' && conversation?.mayaRecoveryOffer?.id === offer.id
        && conversation.mayaRecoveryOffer.version === offer.version) {
        transaction.set(db.collection('communicationConversations').doc(conversation.id), { mayaRecoveryOffer: null }, { merge: true });
      }
    });
  }
  async function waitForOffer(scope, offer) {
    const at = new Date(Date.parse(offer.expiresAt) + 1000);
    await schedule(scope.payload, at);
    return finish(scope, 'waiting_reply', 'offer_pending', { nextWakeAtIso: at.toISOString() });
  }
  async function discover(scope, guarded, current) {
    const reviewed = new Set(); const issues = [];
    const alreadyContacted = new Set(current.state.history.map(entry => entry.conversationId));
    const review = reviewFactory({ db: guarded, clock });
    for (const phone of current.configured.phones) {
      const conversations = await guarded.runTransaction(async transaction => transaction.get(guarded.collection('communicationConversations')
        .where('communicationAccountId', '==', current.account).where('phone', '==', phone).limit(2)), { readOnly: true });
      if (conversations.docs.length > 1) { issues.push('duplicate_selected_phone_conversations'); continue; }
      if (!conversations.docs.length) continue;
      const snapshot = conversations.docs[0];
      if (alreadyContacted.has(snapshot.id)) continue;
      const conversation = snapshot.data();
      if (conversation.mayaRecoveryOffer) {
        const pending = await read(guarded, 'bookingOffers', conversation.mayaRecoveryOffer.id);
        if (!pending || P.isOpen(pending, clock())) { issues.push('conversation_has_pending_offer'); continue; }
      }
      try {
        const result = await review.recover({ conversationId: snapshot.id, communicationAccountId: current.account });
        need(result?.success === true, 'recovery_automation_history_unverified');
        reviewed.add(snapshot.id);
      } catch (error) {
        if (!expectedFailure(error)) throw error;
        issues.push(error.code);
      }
    }
    const inspector = createMayaRecoveryMatching({ db: guarded, clock });
    let afterId = ''; let examined = 0; const candidates = [];
    do {
      const page = await inspector.inspect({ cancelledAppointmentId: scope.payload.cancelledAppointmentId,
        afterId, pageSize: Math.min(10, current.configured.policy.maxCases - examined) });
      examined += page.examined;
      for (const row of page.rows) {
        if (row.status !== 'compatible_for_review') continue;
        const candidate = await guarded.runTransaction(async transaction => {
          const reader = transactionView(guarded, transaction).db;
          const record = await read(reader, 'communicationCases', row.caseId);
          if (!record || !reviewed.has(record.conversationId) || alreadyContacted.has(record.conversationId)) return null;
          const source = await read(reader, 'whatsappMessages', record.lastSourceMessageId);
          const at = Date.parse(source?.whatsappTimestamp || '');
          need(source?.direction === 'inbound' && source.conversationId === record.conversationId
            && source.communicationAccountId === current.account && Number.isFinite(at) && at <= clock().getTime(),
          'recovery_automation_ranking_unproven');
          return { caseId: record.id, conversationId: record.conversationId, at, afterId };
        }, { readOnly: true });
        if (candidate) candidates.push(candidate);
      }
      afterId = page.nextCursor || '';
      if (afterId && examined >= current.configured.policy.maxCases) return { candidates: [], issues: ['candidate_scan_limit'], examined };
    } while (afterId);
    candidates.sort((a, b) => a.at - b.at || a.caseId.localeCompare(b.caseId));
    return { candidates, issues: [...new Set(issues)].slice(0, 10), examined };
  }
  async function run(data) {
    const payload = taskIdentity(data);
    let scope;
    try { scope = await claim(payload); } catch (error) {
      if (expectedFailure(error)) return { processed: false, reason: error.code };
      throw error;
    }
    if (scope.done) return { processed: false, reason: 'already_terminal', status: scope.status };
    if (scope.busy) { await schedule(payload, new Date(scope.until.getTime() + 1000)); return { processed: false, reason: 'worker_busy' }; }
    const guarded = fencedDb(scope);
    try {
      let { current, entry, offer, queue } = await currentOffer(scope, guarded);
      // A retry may occur after the accepted history entry committed but before
      // finalization. It must finish that result, never start candidate discovery.
      if (offer?.recovery.state === 'accepted') {
        need(['pending', 'accepted'].includes(entry?.outcome), 'recovery_automation_result_unproven');
        if (entry.outcome === 'pending') await closePrevious(scope, guarded, offer, 'accepted');
        return await finish(scope, 'completed', 'opening_filled');
      }
      if (entry?.outcome === 'pending') {
        if (offer.recovery.state === 'declined') {
          await closePrevious(scope, guarded, offer, 'declined');
        } else if (!P.isOpen(offer, clock())) {
          need(!queue || (queue.status === 'queued' && !queue.processingStartedAt && !queue.recoveryDispatchAttemptedAtIso)
            || ['sent', 'delivered', 'read'].includes(queue.status), 'recovery_automation_delivery_uncertain');
          await closePrevious(scope, guarded, offer, 'expired');
        } else {
          if (!queue && !offer.recovery.delivery) {
            need(!offer.recovery.outbound, 'recovery_automation_lost_queue');
            await outboundFactory({ db: guarded, clock }).enqueue({ offerId: offer.id, offerVersion: offer.version });
          } else need(queue && ['queued', 'processing', 'sent', 'delivered', 'read'].includes(queue.status)
            || offer.recovery.delivery, 'recovery_automation_delivery_uncertain');
          return await waitForOffer(scope, offer);
        }
        ({ current } = await currentOffer(scope, guarded));
      }
      if (current.state.history.length >= current.configured.policy.maxOffers) return await finish(scope, 'exhausted', 'configured_offer_limit');
      const next = A.nextContactTime(current.contact, clock());
      const openingAt = Date.parse(`${current.target.date}T${current.target.time}:00-04:00`);
      if (!next || next.getTime() >= openingAt) return await finish(scope, 'exhausted', 'no_contact_window_before_opening');
      if (next.getTime() > clock().getTime()) {
        await schedule(payload, next);
        return await finish(scope, 'waiting_contact', 'outside_contact_hours', { nextWakeAtIso: next.toISOString() });
      }
      const found = await discover(scope, guarded, current);
      if (!found.candidates.length) return await finish(scope, found.issues.length ? 'review_required' : 'exhausted',
        found.issues[0] || 'no_compatible_candidate', { examined: found.examined, reviewReasons: found.issues });
      const selected = found.candidates[0];
      const prepared = await offerFactory({ db: guarded, clock }).prepare({ cancelledAppointmentId: payload.cancelledAppointmentId,
        caseId: selected.caseId, ...(selected.afterId ? { afterId: selected.afterId } : {}) });
      await outboundFactory({ db: guarded, clock }).enqueue({ offerId: prepared.offerId, offerVersion: prepared.offerVersion });
      // Await inside this try: follow-up transport or final-state failures must
      // reach releaseAfterError rather than abandoning a live worker lease.
      return await waitForOffer(scope, { expiresAt: prepared.expiresAt });
    } catch (error) {
      await releaseAfterError(scope, error);
      if (expectedFailure(error)) return { processed: false, status: 'review_required', reason: error.code };
      throw error;
    }
  }
  return { run, scheduleCancellation };
}
module.exports = { createMayaRecoveryCoordinator, taskIdentity, expectedFailure };
