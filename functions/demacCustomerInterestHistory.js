'use strict';

const { hashId, cleanText } = require('./bookingSchedulingPrimitives');
const { customerSemanticContent, messageMediaType } = require('./demacCustomerTurn');
const { documentId, failure } = require('./mayaOperationsReadModel');

const HISTORY_VERSION = 1;
const MAX_MESSAGES = 40;
const MAX_TEXT = 24000;
const MAX_AGE_MS = 30 * 86400000; // Recovery coverage, NOT expiration of the customer's preference.

function digest(value) { return hashId(JSON.stringify(value), 64); }
function recentIds(conversation) {
  const recent = conversation.recentMessages;
  if (!Array.isArray(recent) || !recent.length) throw failure('history_incomplete', 'Canonical recent message references are required.');
  const ids = recent.slice(-MAX_MESSAGES).map(item => documentId(item?.id));
  if (new Set(ids).size !== ids.length) throw failure('history_incomplete', 'Duplicate recent message references require review.');
  return ids;
}
function messageEvidence(message) {
  const direction = message.direction;
  if (!['inbound', 'outbound'].includes(direction)) throw failure('history_incomplete', 'Unknown message direction.');
  const at = Date.parse(message.whatsappTimestamp || '');
  const received = Date.parse(message.firstIngestedAtIso || '');
  if (!Number.isFinite(at) || !Number.isFinite(received)) throw failure('history_incomplete', 'Message age is not verified.');
  const type = messageMediaType(message) || 'text';
  const voice = ['audio', 'voice'].includes(type);
  const text = direction === 'inbound' ? customerSemanticContent(message, 6001) : cleanText(message.text || message.mediaCaption || message.reactionEmoji, 6001);
  const opaque = !text || (voice && (direction !== 'inbound' || message.transcriptionStatus !== 'completed'))
    || !['text', 'reaction', 'audio', 'voice'].includes(type);
  if (text.length > 6000) throw failure('history_too_large', 'A message exceeds the recovery review limit.');
  return { id: documentId(message.id), direction, at: new Date(at).toISOString(), receivedAt: new Date(received).toISOString(),
    customerInputVersion: direction === 'inbound' ? message.customerInputVersion : null,
    type, text, opaque, transcriptionVersion: voice ? cleanText(message.transcriptionVersion, 80) : '' };
}
async function loadHistoryWindow(reader, conversation, now = new Date()) {
  const ids = recentIds(conversation);
  const snapshots = await Promise.all(ids.map(id => reader.collection('whatsappMessages').doc(id).get()));
  const all = snapshots.map(snapshot => {
    if (!snapshot.exists) throw failure('history_incomplete', 'An original message is missing.');
    const message = { ...snapshot.data(), id: snapshot.id };
    if (message.conversationId !== conversation.id || message.communicationAccountId !== conversation.communicationAccountId
      || (message.messageId && message.messageId !== snapshot.id)) throw failure('history_identity_mismatch', 'A message does not belong to this conversation and account.');
    return messageEvidence(message);
  });
  const cutoff = now.getTime() - MAX_AGE_MS;
  if (all.some(message => Date.parse(message.at) > now.getTime() || Date.parse(message.receivedAt) > now.getTime())) {
    throw failure('history_incomplete', 'Message chronology cannot be verified.');
  }
  const entries = all.filter(message => Date.parse(message.at) >= cutoff && Date.parse(message.receivedAt) >= cutoff)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (!entries.length || entries.some(message => message.opaque)) throw failure('history_incomplete', 'Recent context includes unreadable media or no reviewable messages.');
  if (entries.reduce((total, message) => total + message.text.length, 0) > MAX_TEXT) throw failure('history_too_large', 'The recent conversation exceeds the bounded review limit.');
  const inbound = entries.filter(message => message.direction === 'inbound');
  if (!inbound.length || inbound.some((message, index) => !Number.isSafeInteger(message.customerInputVersion) || message.customerInputVersion < 1
    || (index > 0 && message.customerInputVersion !== inbound[index - 1].customerInputVersion + 1))
    || inbound.at(-1).customerInputVersion !== conversation.customerInputVersion) {
    throw failure('history_incomplete', 'The recent customer-turn sequence is incomplete or reordered.');
  }
  return { version: HISTORY_VERSION, entries, latestInbound: inbound.at(-1),
    fingerprint: digest(entries), coverage: { maxMessages: MAX_MESSAGES, maxAgeDays: MAX_AGE_MS / 86400000, completeHistory: false } };
}
function interestMaterial(record) {
  return { id: record.id, customerId: record.customerId, propertyId: record.propertyId, appointmentId: record.appointmentId || '',
    communicationAccountId: record.communicationAccountId, conversationId: record.conversationId, state: record.state,
    lastSourceMessageId: record.lastSourceMessageId, interestFingerprint: record.interestFingerprint, bookingInterest: record.bookingInterest };
}
async function recoveredInterestIsCurrent({ reader, record, conversation }) {
  const review = record.interestReview;
  if (!review || review.version !== HISTORY_VERSION || review.customerInputVersion !== conversation.customerInputVersion
    || review.ownershipVersion !== conversation.ownershipVersion || review.materialFingerprint !== digest(interestMaterial(record))) return false;
  try {
    const window = await loadHistoryWindow(reader, conversation);
    return review.windowFingerprint === window.fingerprint && window.entries.some(message => message.id === record.lastSourceMessageId && message.direction === 'inbound');
  } catch { return false; }
}
module.exports = { HISTORY_VERSION, MAX_MESSAGES, MAX_TEXT, MAX_AGE_MS, digest, interestMaterial, loadHistoryWindow, messageEvidence, recentIds, recoveredInterestIsCurrent };
