'use strict';
const crypto = require('node:crypto');
const { fault, hash, validateConfig } = require('./quickbooksConnectionService');
const { createReportsService, REALM } = require('./quickbooksReportsService');
const { catalogInput } = require('./quickbooksCatalogFormat');
const TTL = 5 * 60 * 1000;
const entities = new Set(['Customer', 'Item']);
const id = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 180 &&
  !/[\/\\\u0000-\u001f\u007f]/.test(value) && !['.', '..'].includes(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = value => Number.isSafeInteger(value) && value >= 0 && value < 1e9;
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
const sourceValues = row => [row.id, row.name, row.active, row.email || null, row.sku || null, row.type || null];
const targetValues = row => [row.id, row.name, row.active, row.email ?? null, row.company ?? null, row.currency ?? null,
  row.parentId ?? null, row.isJob ?? null, row.type ?? null, row.sku ?? null, row.incomeAccountId ?? null, row.expenseAccountId ?? null, row.assetAccountId ?? null];
const fingerprint = values => hash(JSON.stringify(values));
const sourceHash = row => fingerprint(sourceValues(row));
const targetHash = row => fingerprint(targetValues(row));
const keyFor = (entity, identity) => fingerprint([entity, identity]);
function sourceRow(entity, identity, value) {
  if (!value) throw fault(409, 'link-source-missing');
  if ((value.active !== undefined && typeof value.active !== 'boolean') ||
    (value.email != null && typeof value.email !== 'string') || (value.sku != null && typeof value.sku !== 'string')) throw fault(409, 'link-source-invalid');
  const name = entity === 'Customer' ? value.name || value.legalName || value.company || identity :
    typeof (value.name || value.label) === 'string' ? (value.name || value.label).trim().replace(/\s+/g, ' ').slice(0, 220) || identity : identity;
  if (typeof name !== 'string' || !name.trim()) throw fault(409, 'link-source-invalid');
  return entity === 'Customer' ? { id: identity, name, active: value.active !== false, ...(value.email ? { email: value.email } : {}) } :
    { id: identity, name, active: value.active !== false, ...(value.sku ? { sku: value.sku } : {}), type: value.itemType === 'Producto' ? 'Producto' : 'Servicio' };
}
function compatible(entity, source, target) {
  if (!source.active || !target.active) throw fault(409, 'link-inactive');
  if (entity === 'Customer' && (target.parentId || target.isJob)) throw fault(409, 'link-customer-hierarchy');
  if (entity === 'Item' && !(source.type === 'Servicio' ? target.type === 'Service' : ['Inventory', 'NonInventory'].includes(target.type))) throw fault(409, 'link-item-type');
}
function createLinksService({ db, config, requireOwner, fetchImpl = fetch, now = Date.now }) {
  const root = db.collection('integrationPrivate').doc('quickbooksProduction');
  const links = root.collection('catalogLinks'), targets = root.collection('catalogLinkTargets'), intents = root.collection('catalogLinkIntents');
  const reports = createReportsService({ db, config, requireOwner, fetchImpl, now });
  const configId = hash(JSON.stringify([config.realmId, config.ownerUid, config.clientId, config.clientSecret, config.encryptionKey, config.redirectUri, config.returnUrl]));
  const erpRef = (entity, identity) => db.collection(entity === 'Customer' ? 'clients' : 'services').doc(identity);
  async function context(uid, tx) {
    validateConfig(config);
    if (config.realmId !== REALM || config.catalogEnabled !== true) throw fault(503, 'catalog-not-configured');
    await requireOwner(uid, tx);
    const record = (await tx.get(root)).data();
    if (!record?.credentials || record.configId !== configId || record.connection?.realmId !== REALM || !record.connection.version || record.disconnect) throw fault(409, 'production-not-connected');
    if (record.attempt && record.attempt.status !== 'completed') throw fault(409, 'authorization-cleanup-required');
    if (record.reportRecoveryDigest === hash(JSON.stringify(record.credentials)) || record.operation?.refreshing) throw fault(409, 'reauthorization-required');
    return record.connection;
  }
  function validateStored(link, entity, erpId) {
    if (link && (link.schemaVersion !== 1 || link.entity !== entity || link.erpId !== erpId || link.realmId !== REALM || link.environment !== 'production' ||
      !['confirmed', 'revoked'].includes(link.status) || !version(link.version) || link.version < 1 || !id(link.qboId) || !digest(link.sourceHash) || !digest(link.targetHash))) throw fault(409, 'link-record-invalid');
    return link;
  }
  function publicLink(link, entity, erpId, source, connection) {
    if (!link) return { entity, erpId, status: 'unlinked', version: 0 };
    validateStored(link, entity, erpId);
    return { entity, erpId, qboId: link.qboId, status: link.status, version: link.version, sourceHash: link.sourceHash, targetHash: link.targetHash,
      updatedAt: link.updatedAt, verifiedAt: link.verifiedAt,
      needsReview: link.status === 'confirmed' && (!source || !source.active || sourceHash(source) !== link.sourceHash || connection.version !== link.connectionVersion) };
  }
  async function list(uid, body) {
    if (!exact(body, ['action', 'entity', 'erpIds']) || !entities.has(body.entity) || !Array.isArray(body.erpIds) || !body.erpIds.length || body.erpIds.length > 100 ||
      body.erpIds.some(value => !id(value)) || new Set(body.erpIds).size !== body.erpIds.length) throw fault(400, 'invalid-link-request');
    return db.runTransaction(async tx => {
      const connection = await context(uid, tx);
      const records = await Promise.all(body.erpIds.map(async erpId => {
        const link = validateStored((await tx.get(links.doc(keyFor(body.entity, erpId)))).data(), body.entity, erpId);
        const value = link?.status === 'confirmed' ? (await tx.get(erpRef(body.entity, erpId))).data() : null;
        return publicLink(link, body.entity, erpId, value ? sourceRow(body.entity, erpId, value) : null, connection);
      }));
      return { records, environment: 'production', realmId: REALM, accountingWritesEnabled: false, syncEnabled: false };
    });
  }
  async function prepare(uid, body) {
    if (!exact(body, ['action', 'entity', 'erpId', 'qboId', 'startPosition', 'sourceHash', 'targetHash', 'expectedVersion']) || !entities.has(body.entity) ||
      !id(body.erpId) || !id(body.qboId) || !digest(body.sourceHash) || !digest(body.targetHash) || !version(body.expectedVersion)) throw fault(400, 'invalid-link-request');
    const input = catalogInput({ entity: body.entity, startPosition: body.startPosition });
    const linkRef = links.doc(keyFor(body.entity, body.erpId)), targetRef = targets.doc(keyFor(body.entity, body.qboId));
    async function preflight(tx, expectedConnection) {
      const connection = await context(uid, tx);
      if (expectedConnection && connection.version !== expectedConnection) throw fault(409, 'link-observation-stale');
      const source = sourceRow(body.entity, body.erpId, (await tx.get(erpRef(body.entity, body.erpId))).data());
      const link = validateStored((await tx.get(linkRef)).data(), body.entity, body.erpId), claim = (await tx.get(targetRef)).data();
      if ((link?.version || 0) !== body.expectedVersion) throw fault(409, 'link-version-conflict');
      if (link?.status === 'confirmed' && link.qboId !== body.qboId) throw fault(409, 'link-revoke-first');
      if (link?.status === 'confirmed' && !claim) throw fault(409, 'link-target-conflict');
      if (claim && (claim.erpId !== body.erpId || claim.entity !== body.entity || claim.qboId !== body.qboId || link?.status !== 'confirmed' || claim.version !== link.version)) throw fault(409, 'link-target-conflict');
      if (sourceHash(source) !== body.sourceHash) throw fault(409, 'link-source-changed');
      if (!source.active) throw fault(409, 'link-inactive');
      return { connection, source };
    }
    const before = await db.runTransaction(tx => preflight(tx));
    // Reuse the unchanged fixed-page GET reader and its shared OAuth/rate lease.
    const observation = await reports.catalog(uid, input);
    const target = observation.catalog.records.find(row => row.id === body.qboId);
    if (!target || targetHash(target) !== body.targetHash) throw fault(409, 'link-target-changed');
    compatible(body.entity, before.source, target);
    const intentId = crypto.randomBytes(24).toString('hex');
    return db.runTransaction(async tx => {
      const { connection, source } = await preflight(tx, before.connection.version);
      const expiresAt = now() + TTL;
      tx.create(intents.doc(intentId), { schemaVersion: 1, actorId: uid, entity: body.entity, erpId: body.erpId, qboId: body.qboId,
        sourceHash: body.sourceHash, targetHash: body.targetHash, expectedVersion: body.expectedVersion, connectionVersion: connection.version,
        realmId: REALM, environment: 'production', verifiedAt: observation.fetchedAt, expiresAt, status: 'pending' });
      return { intentId, entity: body.entity, source, target, expiresAt: new Date(expiresAt).toISOString(), verifiedAt: observation.fetchedAt,
        expectedVersion: body.expectedVersion, environment: 'production', realmId: REALM, accountingWritesEnabled: false, syncEnabled: false };
    });
  }
  async function confirm(uid, body) {
    if (!exact(body, ['action', 'intentId', 'acknowledgeIdentity']) || !/^[a-f0-9]{48}$/.test(body.intentId || '') || body.acknowledgeIdentity !== true) throw fault(400, 'invalid-link-request');
    return db.runTransaction(async tx => {
      const connection = await context(uid, tx), intentRef = intents.doc(body.intentId), intent = (await tx.get(intentRef)).data();
      if (!intent || intent.actorId !== uid || intent.schemaVersion !== 1 || intent.realmId !== REALM || intent.environment !== 'production' || !entities.has(intent.entity) ||
        !id(intent.erpId) || !id(intent.qboId) || !version(intent.expectedVersion) || !digest(intent.sourceHash) || !digest(intent.targetHash)) throw fault(409, 'link-observation-stale');
      const linkRef = links.doc(keyFor(intent.entity, intent.erpId)), targetRef = targets.doc(keyFor(intent.entity, intent.qboId));
      const link = validateStored((await tx.get(linkRef)).data(), intent.entity, intent.erpId), claim = (await tx.get(targetRef)).data();
      const value = (await tx.get(erpRef(intent.entity, intent.erpId))).data(), source = value ? sourceRow(intent.entity, intent.erpId, value) : null;
      if (intent.status === 'confirmed') {
        if (link?.lastOperationId !== body.intentId || link.status !== 'confirmed' || claim?.erpId !== intent.erpId || claim.entity !== intent.entity || claim.qboId !== intent.qboId || claim.version !== link.version) throw fault(409, 'link-version-conflict');
        return { link: publicLink(link, intent.entity, intent.erpId, source, connection), replayed: true };
      }
      if (intent.status !== 'pending' || !Number.isFinite(intent.expiresAt) || intent.expiresAt <= now() || connection.version !== intent.connectionVersion) throw fault(409, 'link-observation-stale');
      if (!source || !source.active || sourceHash(source) !== intent.sourceHash) throw fault(409, 'link-source-changed');
      if ((link?.version || 0) !== intent.expectedVersion) throw fault(409, 'link-version-conflict');
      if (link?.status === 'confirmed' && link.qboId !== intent.qboId) throw fault(409, 'link-revoke-first');
      if (link?.status === 'confirmed' && !claim) throw fault(409, 'link-target-conflict');
      if (claim && (claim.entity !== intent.entity || claim.qboId !== intent.qboId || claim.erpId !== intent.erpId || link?.status !== 'confirmed' || claim.version !== link.version)) throw fault(409, 'link-target-conflict');
      const next = { schemaVersion: 1, entity: intent.entity, erpId: intent.erpId, qboId: intent.qboId, realmId: REALM, environment: 'production',
        status: 'confirmed', version: intent.expectedVersion + 1, sourceHash: intent.sourceHash, targetHash: intent.targetHash,
        connectionVersion: intent.connectionVersion, verifiedAt: intent.verifiedAt, updatedAt: new Date(now()).toISOString(), actorId: uid, lastOperationId: body.intentId };
      tx.set(linkRef, next); tx.set(targetRef, { entity: intent.entity, erpId: intent.erpId, qboId: intent.qboId, version: next.version });
      tx.set(intentRef, { ...intent, status: 'confirmed', confirmedVersion: next.version });
      tx.create(linkRef.collection('history').doc(String(next.version)), { ...next, action: 'confirmed' });
      return { link: publicLink(next, intent.entity, intent.erpId, source, connection), replayed: false };
    });
  }
  async function revoke(uid, body) {
    if (!exact(body, ['action', 'entity', 'erpId', 'expectedVersion', 'requestId']) || !entities.has(body.entity) || !id(body.erpId) ||
      !version(body.expectedVersion) || !/^[a-f0-9-]{36}$/.test(body.requestId || '')) throw fault(400, 'invalid-link-request');
    return db.runTransaction(async tx => {
      const connection = await context(uid, tx), linkRef = links.doc(keyFor(body.entity, body.erpId));
      const link = validateStored((await tx.get(linkRef)).data(), body.entity, body.erpId);
      if (!link) throw fault(409, 'link-version-conflict');
      if (link.status === 'revoked' && link.lastOperationId === body.requestId && link.version === body.expectedVersion + 1) return { link: publicLink(link, body.entity, body.erpId, null, connection), replayed: true };
      if (link.version !== body.expectedVersion || link.status !== 'confirmed') throw fault(409, 'link-version-conflict');
      const targetRef = targets.doc(keyFor(body.entity, link.qboId)), claim = (await tx.get(targetRef)).data();
      if (!claim || claim.entity !== body.entity || claim.qboId !== link.qboId || claim.erpId !== body.erpId || claim.version !== link.version) throw fault(409, 'link-target-conflict');
      const next = { ...link, status: 'revoked', version: link.version + 1, updatedAt: new Date(now()).toISOString(), actorId: uid, lastOperationId: body.requestId };
      tx.set(linkRef, next); tx.delete(targetRef); tx.create(linkRef.collection('history').doc(String(next.version)), { ...next, action: 'revoked' });
      return { link: publicLink(next, body.entity, body.erpId, null, connection), replayed: false };
    });
  }
  return { async execute(uid, body) {
    if (!body || !['list', 'prepare', 'confirm', 'revoke'].includes(body.action)) throw fault(400, 'invalid-link-request');
    const result = await ({ list, prepare, confirm, revoke })[body.action](uid, body);
    return { ...result, environment: 'production', realmId: REALM, accountingWritesEnabled: false, syncEnabled: false };
  } };
}
module.exports = { createLinksService, sourceRow, sourceHash, targetHash, keyFor, TTL };
