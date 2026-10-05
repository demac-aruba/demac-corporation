'use strict';

function currentBundlePart(record) {
  if (record.type !== 'booking-reference-bundle') return null;
  if (!Array.isArray(record.messages) || !record.messages.length || record.messages.length > 41) throw new Error('Invalid booking reference message bundle.');
  const index = Number(record.messageIndex || 0);
  if (!Number.isInteger(index) || index < 0 || index >= record.messages.length) throw new Error('Invalid booking reference cursor.');
  return { ...record.messages[index], index };
}

function bundleAcknowledgement(record, messageId) {
  const part = currentBundlePart(record);
  if (!part) return null;
  const nextIndex = part.index + 1;
  return {
    status: nextIndex < record.messages.length ? 'queued' : 'sent',
    messageIndex: nextIndex,
    sentMessageIds: [...(record.sentMessageIds || []), messageId],
    partAttempts: 0,
    retryAfterIso: null,
  };
}

function bundleFailure(record, now = new Date()) {
  if (record.type !== 'booking-reference-bundle') return { status: 'failed' };
  const retry = Number(record.partAttempts || 0) < 3;
  return { status: retry ? 'queued' : 'failed', retryAfterIso: retry ? new Date(now.getTime() + 30000).toISOString() : null };
}

async function dependencyReady({ transaction, db, record }) {
  if (!record.dependsOnQueueId) return true;
  if (typeof record.dependsOnQueueId !== 'string' || record.dependsOnQueueId.includes('/')) return false;
  const parent = await transaction.get(db.collection('whatsappOutboundQueue').doc(record.dependsOnQueueId));
  return parent.exists && parent.data().status === 'sent' && parent.data().to === record.to;
}

module.exports = { currentBundlePart, bundleAcknowledgement, bundleFailure, dependencyReady };
