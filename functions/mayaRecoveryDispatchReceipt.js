'use strict';
const { digest } = require('./demacCustomerInterestHistory');
function recoveryDispatchFingerprint(queueId, item) {
  const keys = ['provider', 'channel', 'outboundClass', 'communicationAccountId', 'conversationId', 'to', 'text', 'media',
    'expectedOwnershipVersion', 'expectedCustomerInputVersion', 'recoveryDispatchVersion',
    'recoveryOfferId', 'recoveryOfferVersion', 'recoveryOfferFingerprint', 'recoveryContactPolicyFingerprint'];
  return digest({ queueId, payload: Object.fromEntries(keys.map(key => [key, item[key] ?? null])) });
}
function recoveryClaimIsUnchanged(queueId, item) {
  return item?.recoveryDispatchVersion === 1 && typeof item.recoveryDispatchFingerprint === 'string'
    && item.recoveryDispatchFingerprint === recoveryDispatchFingerprint(queueId, item)
    && Number.isFinite(Date.parse(item.recoveryDispatchAttemptedAtIso || ''));
}
module.exports = { recoveryDispatchFingerprint, recoveryClaimIsUnchanged };
