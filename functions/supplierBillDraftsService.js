'use strict';
const { createHash } = require('node:crypto');
const { openDraft, evaluateLine } = require('./supplierBillCosting');
const hash = value => createHash('sha256').update(value).digest('hex');
const fault = (status, code) => Object.assign(new Error(code), { status, safeCode: code });
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const revisionId = version => String(version).padStart(10, '0');
const versionIsValid = value => Number.isSafeInteger(value) && value >= 0 && value < 1000000000;
const norm = text => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
const WRITE_ROLES = new Set(['admin', 'owner', 'super_admin', 'superadmin', 'inventory', 'warehouse']);
const READ_ROLES = new Set([...WRITE_ROLES, 'supervisor', 'operations', 'accounting', 'finance', 'project_manager']);
function validateDraft(raw) {
  if (!exact(raw, ['version','supplier','invoiceNumber','origin','currency','generalImport','wire','lines']) ||
      !Array.isArray(raw.lines) || raw.lines.some(row => !exact(row, ['description','use','quantity','unitCost','importOverride','marketing','profit','operations','finalPrice','confirmed']) || typeof row.confirmed !== 'boolean')) throw fault(400, 'invalid-draft');
  let draft;
  try { draft = openDraft(JSON.stringify(raw)); } catch { throw fault(400, 'invalid-draft'); }
  draft.supplier = draft.supplier.trim(); draft.invoiceNumber = draft.invoiceNumber.trim();
  if (!draft.supplier || !draft.invoiceNumber) throw fault(400, 'supplier-and-number-required');
  // These are draft selections, never permission to publish a catalog price.
  const calculations = draft.lines.map((line, index) => {
    const result = evaluateLine(draft, line);
    line.confirmed = raw.lines[index].confirmed && !!line.description.trim() && !!result.quote?.allocation && !result.error;
    return result;
  });
  const snapshot = JSON.parse(JSON.stringify(calculations, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  return { draft, calculations: snapshot };
}
function createSupplierBillDraftService({ db, enabled = false, now = Date.now }) {
  const records = db.collection('supplierBillDrafts');
  const claims = db.collection('supplierBillDraftClaims');
  const operations = db.collection('supplierBillDraftOperations');
  async function actor(tx, uid, write = false) {
    if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) throw fault(401, 'sign-in-required');
    const profile = (await tx.get(db.collection('users').doc(uid))).data();
    const role = typeof profile?.role === 'string' ? profile.role : '';
    if (profile?.active !== true || !(write ? WRITE_ROLES : READ_ROLES).has(role)) throw fault(403, 'draft-access-denied');
    return { uid, name: typeof profile.name === 'string' ? profile.name.slice(0, 160) : uid, canWrite: WRITE_ROLES.has(role) };
  }
  const claimKey = draft => hash(JSON.stringify([norm(draft.supplier), norm(draft.invoiceNumber)]));
  function stored(record, draftId) {
    if (!record || record.id !== draftId || record.schemaVersion !== 1 || record.status !== 'draft' || !versionIsValid(record.version) || record.version < 1) throw fault(409, 'draft-needs-review');
    return record;
  }
  async function execute(uid, body) {
    if (!object(body)) throw fault(400, 'invalid-request');
    if (body.action === 'status' && exact(body, ['action'])) {
      return db.runTransaction(async tx => ({ enabled, ...(await actor(tx, uid)), inventoryWrites: false, accountingWrites: false }));
    }
    if (!enabled) throw fault(503, 'drafts-not-active');
    if (body.action === 'list' && exact(body, ['action', 'after']) && (body.after === null || id(body.after))) {
      return db.runTransaction(async tx => {
        const currentActor = await actor(tx, uid);
        let query = records.orderBy('__name__').limit(21);
        if (body.after) query = query.startAfter(body.after);
        const batch = await tx.get(query);
        const rows = batch.docs.slice(0, 20).map(doc => {
          const value = stored(doc.data(), doc.id);
          return { id: value.id, version: value.version, supplier: value.draft.supplier, invoiceNumber: value.draft.invoiceNumber, currency: value.draft.currency, updatedAt: value.updatedAt, updatedBy: value.updatedBy, lineCount: value.draft.lines.length };
        });
        return { rows, next: batch.docs.length > 20 ? rows.at(-1).id : null, canWrite: currentActor.canWrite };
      });
    }
    if (body.action === 'read' && exact(body, ['action', 'id']) && id(body.id)) {
      return db.runTransaction(async tx => {
        const currentActor = await actor(tx, uid);
        const result = (await tx.get(records.doc(body.id))).data();
        if (!result) throw fault(404, 'draft-not-found');
        return { record: stored(result, body.id), canWrite: currentActor.canWrite };
      });
    }
    if (body.action === 'history' && exact(body, ['action', 'id', 'beforeVersion']) && id(body.id) && (body.beforeVersion === null || versionIsValid(body.beforeVersion))) {
      return db.runTransaction(async tx => {
        await actor(tx, uid);
        const record = (await tx.get(records.doc(body.id))).data();
        if (!record) throw fault(404, 'draft-not-found');
        stored(record, body.id);
        const top = Math.min(record.version, body.beforeVersion === null ? record.version : body.beforeVersion - 1);
        const versions = Array.from({ length: Math.min(20, Math.max(0, top)) }, (_, index) => top - index);
        const snapshots = await Promise.all(versions.map(value => tx.get(records.doc(body.id).collection('revisions').doc(revisionId(value)))));
        const rows = snapshots.map((snapshot, index) => {
          const value = snapshot.data();
          if (!value || value.version !== versions[index]) throw fault(409, 'draft-needs-review');
          return { version: value.version, at: value.updatedAt, actor: value.updatedBy, reason: value.reason, supplier: value.draft.supplier, invoiceNumber: value.draft.invoiceNumber };
        });
        return { rows, next: top > 20 ? top - 19 : null };
      });
    }
    if (body.action !== 'save' || !exact(body, ['action','id','requestId','expectedVersion','draft','reason']) || !id(body.id) || !id(body.requestId) || !versionIsValid(body.expectedVersion) || typeof body.reason !== 'string' || body.reason.length > 500) throw fault(400, 'invalid-request');
    const { draft, calculations } = validateDraft(body.draft);
    const reason = body.reason.trim();
    if (body.expectedVersion > 0 && !reason) throw fault(400, 'reason-required');
    // Stable serialization of known fields. Submitted confirmations participate in replay identity too.
    const fingerprint = hash(JSON.stringify([body.id, body.expectedVersion, draft, body.draft.lines.map(line => line.confirmed), reason]));
    const operationRef = operations.doc(hash(JSON.stringify([uid, body.requestId])));
    const recordRef = records.doc(body.id), nextClaimKey = claimKey(draft);
    return db.runTransaction(async tx => {
      const currentActor = await actor(tx, uid, true);
      const prior = (await tx.get(operationRef)).data();
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw fault(409, 'request-payload-conflict');
        return { ...prior.result, replayed: true };
      }
      const before = (await tx.get(recordRef)).data();
      if (before) stored(before, body.id);
      const nextClaimRef = claims.doc(nextClaimKey);
      const nextClaim = (await tx.get(nextClaimRef)).data();
      const oldClaimRef = before ? claims.doc(claimKey(before.draft)) : null;
      const oldClaim = oldClaimRef && oldClaimRef.id !== nextClaimRef.id ? (await tx.get(oldClaimRef)).data() : nextClaim;
      const revisionRef = recordRef.collection('revisions').doc(revisionId(body.expectedVersion + 1));
      const priorRevision = await tx.get(revisionRef);
      const at = new Date(now()).toISOString();
      // Persist a terminal rejection as a fence, so an earlier uncertain request
      // cannot later commit after the operator has been told it was rejected.
      function reject(code, conflictId = null) {
        const result = { accepted: false, code, conflictId };
        tx.set(operationRef, { fingerprint, actorId: uid, at, result });
        return result;
      }
      if ((before?.version || 0) !== body.expectedVersion) return reject('draft-version-conflict', before?.id || null);
      if (nextClaim && nextClaim.draftId !== body.id) return reject('duplicate-draft-reference', nextClaim.draftId);
      if (priorRevision.exists || (!before && nextClaim)) throw fault(409, 'draft-needs-review');
      if (before && oldClaim?.draftId !== body.id) throw fault(409, 'draft-needs-review');
      const version = body.expectedVersion + 1;
      const record = { schemaVersion: 1, id: body.id, version, status: 'draft', draft, calculations,
        createdAt: before?.createdAt || at, createdBy: before?.createdBy || { uid, name: currentActor.name },
        updatedAt: at, updatedBy: { uid, name: currentActor.name }, reason,
        catalogLinks: 'pending', inventoryStatus: 'not-received', accountingStatus: 'not-sent' };
      const result = { accepted: true, id: body.id, version };
      if (oldClaimRef && oldClaimRef.id !== nextClaimRef.id) tx.delete(oldClaimRef);
      tx.set(nextClaimRef, { draftId: body.id });
      tx.set(recordRef, record);
      tx.set(revisionRef, record);
      tx.set(operationRef, { fingerprint, actorId: uid, at, result });
      return result;
    });
  }
  return { execute };
}
module.exports = { createSupplierBillDraftService, fault, validateDraft };
