'use strict';

const { digest } = require('./demacCustomerInterestHistory');
const { configuredAllowlist } = require('./demacCustomerAgentReplyPolicy');
const { arubaDateParts } = require('./bookingSchedulingPrimitives');
const { CANCELLED } = require('./mayaOperationsReadModel');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;
const VERSION = 1;
const LEASE_MS = 240000;
const TASK_NAME = 'processMayaRecoveryOpening';
const TERMINAL_STATES = new Set(['completed', 'exhausted', 'review_required']);

function configuredAutomation(settings = {}, now = new Date()) {
  need(settings.recoveryAutomationEnabled === true, 'recovery_automation_disabled');
  need(settings.enabled !== false && ['autoReplyEnabled', 'bookingInterestEnabled', 'bookingInterestRecoveryEnabled',
    'recoveryOffersEnabled', 'recoveryOutreachEnabled', 'recoveryResponseRoutingEnabled',
    'recoveryConfirmationEnabled', 'autoRescheduleEnabled'].every(key => settings[key] === true),
  'recovery_automation_dependencies_disabled');
  const policy = settings.recoveryAutomationPolicy;
  const keys = ['version', 'activeSince', 'ranking', 'maxConversations', 'maxCases', 'maxOffers'];
  need(policy && !Array.isArray(policy) && Object.keys(policy).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(policy, key))
    && policy.version === VERSION && policy.ranking === 'oldest_verified_request'
    && typeof policy.activeSince === 'string' && Number.isFinite(Date.parse(policy.activeSince))
    && Date.parse(policy.activeSince) <= now.getTime()
    && Number.isSafeInteger(policy.maxConversations) && policy.maxConversations >= 1 && policy.maxConversations <= 5
    && Number.isSafeInteger(policy.maxCases) && policy.maxCases >= 1 && policy.maxCases <= 50
    && Number.isSafeInteger(policy.maxOffers) && policy.maxOffers >= 1 && policy.maxOffers <= 10,
  'recovery_automation_policy_missing');
  const phones = configuredAllowlist(settings).sort();
  need(phones.length > 0 && phones.length <= policy.maxConversations, 'recovery_automation_pilot_scope');
  return { policy, phones, fingerprint: digest({ policy, phones, contact: settings.recoveryContactPolicy || null }) };
}

function cancellationGeneration(appointment) {
  if (!appointment?.id || !CANCELLED.has(String(appointment.status || '').toLowerCase())
    || typeof appointment.cancelledAtIso !== 'string' || !Number.isFinite(Date.parse(appointment.cancelledAtIso))) return null;
  return digest({ id: appointment.id, cancelledAtIso: appointment.cancelledAtIso,
    original: P.originalFingerprint(appointment) });
}

function validateAutomationState(state, generation, account) {
  need(state && state.version === VERSION && state.generation === generation && state.account === account
    && ['running', 'waiting_reply', 'waiting_contact', ...TERMINAL_STATES].includes(state.status)
    && Array.isArray(state.history) && state.history.length <= 10
    && new Set(state.history.map(entry => `${entry.offerId}:${entry.offerVersion}`)).size === state.history.length,
  'recovery_automation_state_changed');
  for (const entry of state.history) {
    need(entry && typeof entry.offerId === 'string' && Number.isSafeInteger(entry.offerVersion) && entry.offerVersion > 0
      && typeof entry.caseId === 'string' && typeof entry.conversationId === 'string'
      && typeof entry.fingerprint === 'string' && Number.isFinite(Date.parse(entry.expiresAt))
      && ['pending', 'accepted', 'declined', 'expired'].includes(entry.outcome), 'recovery_automation_state_changed');
  }
  return state;
}

// Called by the EXISTING outbound claim using its current transaction snapshot.
// Removal of the offer marker cannot bypass the matching cancelled-appointment
// history. No automation state means the existing manual/internal path is unchanged.
function assertAutomatedOfferCurrent({ offer, cancellation, settings, now = new Date() }) {
  const state = cancellation?.mayaRecoveryAutomation;
  const marker = offer?.recovery?.automation;
  if (state === undefined && marker === undefined) return;
  const configured = configuredAutomation(settings, now);
  const generation = cancellationGeneration(cancellation);
  validateAutomationState(state, generation, offer.recovery.account);
  const entry = state.history.at(-1);
  need(state.policyFingerprint === configured.fingerprint && !TERMINAL_STATES.has(state.status)
    && marker?.version === VERSION && marker.generation === generation && marker.policyFingerprint === configured.fingerprint
    && entry?.offerId === offer.id && entry.offerVersion === offer.version
    && entry.caseId === offer.recovery.caseId && entry.conversationId === offer.recovery.conversationId
    && entry.fingerprint === offer.recovery.fingerprint && entry.outcome === 'pending',
  'recovery_automation_offer_changed');
}

function nextContactTime(policy, now) {
  const localDate = arubaDateParts(now).date;
  const candidates = [];
  for (let day = 0; day < 8; day += 1) {
    const date = new Date(Date.parse(`${localDate}T00:00:00Z`) + day * 86400000);
    const dateKey = date.toISOString().slice(0, 10);
    for (const window of policy.windows) {
      if (window.weekday !== date.getUTCDay()) continue;
      const start = Date.parse(`${dateKey}T${window.start}:00-04:00`);
      const end = Date.parse(`${dateKey}T${window.end}:00-04:00`);
      if (end > now.getTime()) candidates.push(Math.max(start, now.getTime()));
    }
  }
  return candidates.length ? new Date(Math.min(...candidates)) : null;
}

module.exports = { VERSION, LEASE_MS, TASK_NAME, TERMINAL_STATES, configuredAutomation,
  cancellationGeneration, validateAutomationState, assertAutomatedOfferCurrent, nextContactTime };
