'use strict';
const { hashId } = require('./bookingSchedulingPrimitives');
const { customerSemanticContent, messageMediaType } = require('./demacCustomerTurn');

// Hash the full normalized content already persisted in the canonical message.
// This does not expose it to another model or duplicate it in the Case. In
// particular an edited suffix cannot remain authorized just because the original
// short quote still occurs near the beginning of the message.
function interestSourceFingerprint(message = {}) {
  return hashId(JSON.stringify({
    version: 1,
    id: message.id || message.messageId || '',
    account: message.communicationAccountId || '',
    conversationId: message.conversationId || '',
    direction: message.direction || '',
    customerInputVersion: message.customerInputVersion ?? null,
    mediaType: messageMediaType(message),
    transcriptionStatus: message.transcriptionStatus || '',
    transcriptionVersion: message.transcriptionVersion || '',
    content: customerSemanticContent(message, Number.MAX_SAFE_INTEGER),
  }), 40);
}
module.exports = { interestSourceFingerprint };
