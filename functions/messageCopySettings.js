'use strict';
const crypto = require('node:crypto');
const { CATALOG, defaultsFor, validateFields } = require('./messageCopy');
const { copyRef } = require('./messageCopyStore');
const fault = (status, code) => Object.assign(new Error(code), { status, code });
function requireAdmin(snapshot) {
  const profile = snapshot.data() || {};
  const role = String(profile.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!snapshot.exists || profile.active !== true || !['admin', 'owner', 'super_admin', 'superadmin'].includes(role)) throw fault(403, 'admin-required');
  return profile;
}
function projectRecord(id, language, snapshot) {
  if (!snapshot.exists) return { id, language, revision: 0, fields: defaultsFor(id, language), updatedAt: null, updatedByName: null };
  const data = snapshot.data();
  if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt)) || typeof data.updatedByName !== 'string') throw fault(409, 'invalid-saved-template');
  let fields;
  try { fields = validateFields(id, language, data.fields); } catch { throw fault(409, 'invalid-saved-template'); }
  return { id, language, revision: data.revision, fields, updatedAt: data.updatedAt, updatedByName: data.updatedByName };
}
function createMessageCopySettings({ db, now = () => new Date() }) {
  async function execute(uid, request) {
    if (!uid) throw fault(401, 'sign-in-required');
    const userRef = db.collection('users').doc(uid);
    await requireAdmin(await userRef.get());
    if (request.action === 'list') {
      const records = await Promise.all(CATALOG.flatMap(item => item.languages.map(async language => projectRecord(item.id, language, await copyRef(db, item.id, language).get()))));
      return { records };
    }
    const { id, language } = request;
    const ref = copyRef(db, id, language);
    if (request.action === 'history') {
      const snapshot = await ref.collection('history').orderBy('revision', 'desc').limit(20).get();
      return { records: snapshot.docs.map(doc => projectRecord(id, language, doc)) };
    }
    if (request.action !== 'save') throw fault(400, 'unsupported-action');
    const fields = validateFields(id, language, request.fields);
    const { expectedRevision, requestId } = request;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId || '')) throw fault(400, 'invalid-request');
    const digest = crypto.createHash('sha256').update(JSON.stringify({ uid, id, language, fields, expectedRevision })).digest('hex');
    const receiptRef = ref.collection('requests').doc(requestId);
    return db.runTransaction(async tx => {
      const [user, current, receipt] = await Promise.all([tx.get(userRef), tx.get(ref), tx.get(receiptRef)]);
      const actor = requireAdmin(user), record = projectRecord(id, language, current);
      if (receipt.exists) {
        if (receipt.data().digest !== digest) throw fault(409, 'request-conflict');
        return { record, savedRevision: receipt.data().revision, replayed: true };
      }
      if (record.revision !== expectedRevision) throw fault(409, 'revision-conflict');
      const revision = expectedRevision + 1;
      const next = { schemaVersion: 1, revision, fields, updatedAt: now().toISOString(), updatedById: uid, updatedByName: String(actor.name || actor.displayName || 'Administrator').slice(0,100) };
      tx.set(ref, next);
      tx.create(ref.collection('history').doc(String(revision).padStart(10, '0')), next);
      tx.create(receiptRef, { digest, revision, createdAt: next.updatedAt });
      return { record: { id, language, revision, fields, updatedAt: next.updatedAt, updatedByName: next.updatedByName }, savedRevision: revision, replayed: false };
    });
  }
  return { execute };
}
module.exports = { createMessageCopySettings, requireAdmin };
