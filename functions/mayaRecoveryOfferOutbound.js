'use strict';

// One producer for the existing Communication Authority queue, never a sender.
const { FieldValue } = require('firebase-admin/firestore');
const { digest, recoveredInterestIsCurrent } = require('./demacCustomerInterestHistory');
const { customerSemanticContent } = require('./demacCustomerTurn');
const { arubaDateParts } = require('./bookingSchedulingPrimitives');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { documentId, timeKey } = require('./mayaOperationsReadModel');
const { transactionView, currentPilot, unchangedBasis, originalOwnership, selectOption, read, pointerMatches } = require('./mayaRecoveryOfferService');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;
const PREFIX = 'MRO-';
const VERSION = 1;

function recoveryQueueId(offerId, version) {
  return `${PREFIX}${digest([offerId, version]).toUpperCase()}`;
}
function isRecoveryOutbound(queueId, item = {}) {
  return String(queueId || '').startsWith(PREFIX)
    || ['recoveryDispatchVersion', 'recoveryOfferId', 'recoveryOfferVersion', 'recoveryOfferFingerprint']
      .some(key => Object.prototype.hasOwnProperty.call(item, key));
}
function configuredContactPolicy(settings) {
  need(settings?.recoveryOutreachEnabled === true, 'recovery_outreach_disabled');
  const policy = settings.recoveryContactPolicy;
  const keys = ['version', 'provider', 'timezone', 'windows', 'cooldownMinutes', 'minimumRemainingSeconds'];
  need(policy && !Array.isArray(policy) && Object.keys(policy).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(policy, key))
    && policy.version === VERSION && policy.provider === 'wacli' && policy.timezone === 'America/Aruba'
    && Number.isSafeInteger(policy.cooldownMinutes) && policy.cooldownMinutes >= 1 && policy.cooldownMinutes <= 10080
    && Number.isSafeInteger(policy.minimumRemainingSeconds) && policy.minimumRemainingSeconds >= 30 && policy.minimumRemainingSeconds <= 600
    && Array.isArray(policy.windows) && policy.windows.length >= 1 && policy.windows.length <= 21,
  'recovery_contact_policy_missing');
  for (const window of policy.windows) {
    need(window && !Array.isArray(window) && Object.keys(window).length === 3
      && Number.isInteger(window.weekday) && window.weekday >= 0 && window.weekday <= 6
      && timeKey(window.start) && timeKey(window.end) && window.start < window.end,
    'recovery_contact_policy_missing');
  }
  return { policy, fingerprint: digest(policy) };
}
function assertContactTime(policy, offer, now) {
  const current = arubaDateParts(now);
  const weekday = new Date(`${current.date}T00:00:00Z`).getUTCDay();
  need(policy.windows.some(window => window.weekday === weekday && current.time >= window.start && current.time < window.end),
    'recovery_contact_window_closed');
  need(Date.parse(offer.expiresAt) - now.getTime() >= policy.minimumRemainingSeconds * 1000,
    'recovery_offer_too_close_to_expiry');
}
function assertQueueIdentity(queueId, queue, offer, policyFingerprint) {
  const r = offer.recovery;
  need(queueId === recoveryQueueId(offer.id, offer.version) && queue.recoveryDispatchVersion === VERSION
    && queue.provider === 'wacli' && queue.outboundClass === 'conversation_maya'
    && queue.communicationAccountId === r.account && queue.conversationId === r.conversationId
    && queue.to === r.phone && queue.text === r.messageText && !queue.media
    && queue.expectedOwnershipVersion === r.ownershipVersion && queue.expectedCustomerInputVersion === r.customerInputVersion
    && queue.recoveryOfferId === offer.id && queue.recoveryOfferVersion === offer.version
    && queue.recoveryOfferFingerprint === r.fingerprint && queue.recoveryContactPolicyFingerprint === policyFingerprint,
  'recovery_outbound_identity_changed');
  need(r.outbound?.queueId === queueId && r.outbound?.policyFingerprint === policyFingerprint,
    'recovery_outbound_pointer_changed');
}
async function preparedDispatchContext(reader, offer, now) {
  const r = P.assertOffer(offer, offer?.version);
  need(P.isOpen(offer, now) && r.state === 'prepared' && !r.delivery && !r.response, 'recovery_offer_not_dispatchable');
  const pilot = await currentPilot(reader, r.conversationId);
  const configured = configuredContactPolicy(pilot.settings);
  need(pilot.settings.autoRescheduleEnabled === true, 'recovery_reschedule_disabled');
  need(pilot.conversation.provider === 'wacli' && pointerMatches(pilot.conversation, offer)
    && pilot.conversation.customerInputVersion === r.customerInputVersion,
  'recovery_customer_turn_changed');
  assertContactTime(configured.policy, offer, now);
  const basis = await unchangedBasis(reader, offer, pilot);
  const record = basis.record;
  const source = await read(reader, 'whatsappMessages', record.lastSourceMessageId);
  const event = Array.isArray(record.interestHistory) ? record.interestHistory.at(-1) : null;
  need(source && source.direction === 'inbound' && source.conversationId === r.conversationId
    && source.communicationAccountId === r.account && event?.action === 'register' && event.messageId === source.id
    && event.customerInputVersion === source.customerInputVersion && event.ownershipVersion === r.ownershipVersion
    && typeof record.bookingInterest?.sourceQuote === 'string' && record.bookingInterest.sourceQuote.trim().length >= 3
    && customerSemanticContent(source, 8000).includes(record.bookingInterest.sourceQuote.trim()),
  'recovery_interest_evidence_changed');
  need(record.interestReview
    ? await recoveredInterestIsCurrent({ reader, record, conversation: pilot.conversation, now })
    : source.customerInputVersion === pilot.conversation.customerInputVersion,
  'recovery_interest_requires_review');
  await originalOwnership(reader, basis.original);
  const selection = await selectOption(reader, { get: ref => ref.get() }, createSchedulingProvider({ db: reader }),
    basis.original, basis.cancellation, now);
  need(P.optionFingerprint(selection.option) === P.optionFingerprint(offer.options[0])
    && digest(selection.request) === digest(offer.request), 'recovery_option_changed');
  return { pilot, ...configured };
}
function createMayaRecoveryOfferOutbound({ db, clock = () => new Date() } = {}) {
  need(db && typeof db.runTransaction === 'function', 'transaction_required');
  async function enqueue(args = {}) {
    need(args && !Array.isArray(args) && Object.keys(args).length === 2
      && Object.prototype.hasOwnProperty.call(args, 'offerId') && Object.prototype.hasOwnProperty.call(args, 'offerVersion'),
    'invalid_recovery_dispatch');
    documentId(args.offerId);
    return db.runTransaction(async transaction => {
      const reader = transactionView(db, transaction).db;
      const now = clock();
      const offer = await read(reader, 'bookingOffers', args.offerId);
      const r = P.assertOffer(offer, args.offerVersion);
      const queueId = recoveryQueueId(offer.id, offer.version);
      const existing = await read(reader, 'whatsappOutboundQueue', queueId);
      const { pilot, policy, fingerprint } = await preparedDispatchContext(reader, offer, now);
      if (existing) {
        assertQueueIdentity(queueId, existing, offer, fingerprint);
        need(['queued', 'processing', 'sent', 'delivered', 'read'].includes(existing.status), 'recovery_dispatch_requires_reconciliation');
        return { success: true, replayed: true, queueId, status: existing.status, capacityReserved: false };
      }
      need(!r.outbound, 'recovery_dispatch_requires_reconciliation');
      const prior = pilot.conversation.mayaRecoveryLastQueuedAtIso;
      if (prior !== undefined && prior !== null) {
        const lastAt = Date.parse(prior);
        need(Number.isFinite(lastAt) && lastAt <= now.getTime()
          && now.getTime() - lastAt >= policy.cooldownMinutes * 60000, 'recovery_contact_cooldown');
      }
      const queuedAtIso = now.toISOString();
      transaction.set(db.collection('whatsappOutboundQueue').doc(queueId), {
        provider: 'wacli', channel: 'whatsapp', outboundClass: 'conversation_maya', status: 'queued',
        communicationAccountId: r.account, conversationId: r.conversationId, to: r.phone, text: r.messageText,
        expectedOwnershipVersion: r.ownershipVersion, expectedCustomerInputVersion: r.customerInputVersion,
        recoveryDispatchVersion: VERSION, recoveryOfferId: offer.id, recoveryOfferVersion: offer.version,
        recoveryOfferFingerprint: r.fingerprint, recoveryContactPolicyFingerprint: fingerprint,
        createdByUserId: 'demac-customer-agent', createdByName: 'Maya', attempts: 0,
        createdAt: FieldValue.serverTimestamp(), createdAtIso: queuedAtIso, updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(db.collection('bookingOffers').doc(offer.id), {
        recovery: { ...r, outbound: { queueId, policyFingerprint: fingerprint, queuedAtIso } },
      }, { merge: true });
      transaction.set(db.collection('communicationConversations').doc(r.conversationId), {
        mayaRecoveryLastQueuedAtIso: queuedAtIso,
      }, { merge: true });
      return { success: true, replayed: false, queueId, status: 'queued', capacityReserved: false };
    });
  }
  return { enqueue };
}
async function recoveryOutboundClaimDecision({ db, transaction, queueId, queueItem = {}, now = new Date() }) {
  if (!isRecoveryOutbound(queueId, queueItem)) return { allowed: true, reason: 'not-recovery-outbound' };
  try {
    // A lost ACK is not evidence that the message was not sent. Do not blindly
    // retransmit this offer after its first claim. Reconcile delivery separately.
    need(queueItem.status === 'queued' && !queueItem.processingStartedAt && !queueItem.recoveryDispatchAttemptedAtIso
      && (queueItem.attempts === undefined || queueItem.attempts === 0), 'recovery_delivery_requires_reconciliation');
    const reader = transactionView(db, transaction).db;
    const offer = await read(reader, 'bookingOffers', documentId(queueItem.recoveryOfferId));
    P.assertOffer(offer, queueItem.recoveryOfferVersion);
    const { fingerprint } = await preparedDispatchContext(reader, offer, now);
    assertQueueIdentity(queueId, queueItem, offer, fingerprint);
    return { allowed: true, reason: 'recovery-offer-current' };
  } catch (error) {
    // Expected denials are safe queue failure reasons. A temporary DB/provider
    // exception aborts the claim transaction instead of destroying a valid job.
    if (error?.code === 'invalid_request' || String(error?.code || '').startsWith('recovery_')) {
      return { allowed: false, reason: 'recovery-offer-blocked', recoveryReason: error.code };
    }
    throw error;
  }
}
module.exports = { VERSION, PREFIX, recoveryQueueId, isRecoveryOutbound, configuredContactPolicy,
  assertContactTime, assertQueueIdentity, preparedDispatchContext, createMayaRecoveryOfferOutbound, recoveryOutboundClaimDecision };
