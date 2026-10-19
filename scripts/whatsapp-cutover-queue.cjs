'use strict';
// Owner authorization: 19 October 2026, 09:34:15 Aruba. Never resend the backlog.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const CUTOFF = '2026-10-19T13:34:15.000Z';
const REASON = 'owner-requested-20261019-cutover';
const LIMIT = 400;
function millis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
}
function obsolete(record) {
  const at = millis(record.createdAt) || millis(record.createdAtIso);
  return !at || at < Date.parse(CUTOFF);
}
function tombstone(record, at) {
  const result = { status: 'cancelled', cancellationReason: REASON, cutoffIso: CUTOFF,
    cancelledAt: at, updatedAt: at, payloadRemoved: true, priorStatus: record.status,
    priorSentPartCount: Number(record.messageIndex || 0) };
  // Retain only identifiers needed by existing idempotency, projections and ordering.
  for (const key of ['provider','to','createdAt','createdAtIso','notificationType','recipientType','recipientId','workOrderId','appointmentId','vanId','scheduleDate']) {
    if (record[key] !== undefined) result[key] = record[key];
  }
  return result;
}
function plan(docs) {
  assert.ok(docs.length <= LIMIT, 'Queue exceeds atomic cutover bound');
  const old = docs.filter(doc => obsolete(doc.data()));
  assert.ok(old.every(doc => doc.data().status !== 'processing'), 'Old command in flight: do not discard or deploy');
  const locks = new Map();
  for (const doc of old) {
    const d = doc.data();
    const to = String(d.to || d.phone || d.recipient || '').trim();
    if (to) locks.set(crypto.createHash('sha256').update(to).digest('hex'), to);
  }
  assert.ok(old.length + locks.size + 1 <= 490, 'Atomic write bound exceeded');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(old.map(doc => [doc.id, doc.data()]).sort(([a],[b]) => a.localeCompare(b)))).digest('hex');
  const counts = {};
  for (const doc of old) counts[doc.data().status] = (counts[doc.data().status] || 0) + 1;
  return { old, locks, fingerprint, summary: { cutoffIso: CUTOFF, discardCount: old.length, preserveNewCount: docs.length - old.length, priorStatuses: counts } };
}
function query(db) { return db.collection('whatsappOutboundQueue').where('status','in',['queued','processing','failed']).limit(LIMIT + 1); }
async function discardBacklog({ db, FieldValue, execute = false, expectedFingerprint, sourceSha = 'local-dry-run' }) {
  if (!execute) {
    const p = plan((await query(db).get()).docs);
    return { ...p.summary, dryRun: true, fingerprint: p.fingerprint };
  }
  assert.match(expectedFingerprint || '', /^[a-f0-9]{64}$/, 'Reviewed dry-run fingerprint required');
  return db.runTransaction(async tx => {
    const p = plan((await tx.get(query(db))).docs);
    assert.equal(p.fingerprint, expectedFingerprint, 'Old queue changed after dry-run');
    const lockRows = [];
    for (const id of p.locks.keys()) {
      const ref = db.collection('whatsappOutboundDispatchLocks').doc(id);
      lockRows.push({ ref, snapshot: await tx.get(ref) });
    }
    const auditRef = db.collection('businessSettings').doc('whatsapp').collection('incidentActions').doc('20261019-cutover');
    const audit = await tx.get(auditRef);
    const ids = new Set(p.old.map(doc => doc.id));
    const at = FieldValue.serverTimestamp();
    for (const doc of p.old) tx.set(doc.ref, tombstone(doc.data(), at));
    let releasedLocks = 0;
    for (const { ref, snapshot } of lockRows) {
      if (ids.has(snapshot.data()?.activeQueueId)) {
        tx.set(ref, { activeQueueId: null, updatedAt: at }, { merge: true });
        releasedLocks++;
      }
    }
    tx.set(auditRef, { cutoffIso: CUTOFF, action: REASON, status: 'complete', sourceSha,
      discardedTotal: Number(audit.data()?.discardedTotal || 0) + p.old.length,
      lastDiscardCount: p.old.length, releasedLocks, verifiedAt: at,
      authorization: 'Owner explicitly requested deployment and removal of all earlier pending messages.' }, { merge: true });
    return { ...p.summary, dryRun: false, releasedLocks };
  });
}
module.exports = { CUTOFF, REASON, obsolete, tombstone, plan, discardBacklog };
