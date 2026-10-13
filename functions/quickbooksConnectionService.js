'use strict';
// Isolated production authorization. No financial reports or accounting-write API exists here.
const crypto = require('node:crypto');
const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API = 'https://quickbooks.api.intuit.com/v3/company/';
const RETURN = 'https://demac-aruba.com/quickbooks/connect/';
const CALLBACK = 'https://us-central1-demac-corporation.cloudfunctions.net/quickbooksConnection/callback';
const DOCUMENT = 'quickbooksProduction';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const opaque = () => crypto.randomBytes(32).toString('base64url');
const isOpaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const fault = (status, safeCode) => Object.assign(new Error(safeCode), { status, safeCode });
function validateConfig(config) {
  if (config.enabled !== true || !/^\d{6,30}$/.test(config.realmId || '') || config.realmId === '9341458478454738' ||
    typeof config.ownerUid !== 'string' || !config.ownerUid || config.ownerUid.length > 128 ||
    !config.clientId || !config.clientSecret || !/^[A-Za-z0-9+/]{43}=$/.test(config.encryptionKey || '') ||
    config.returnUrl !== RETURN || config.redirectUri !== CALLBACK) throw fault(503, 'not-configured');
  return config;
}
function seal(tokens, config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), iv);
  cipher.setAAD(Buffer.from(`quickbooks:production:${config.realmId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]).toString('base64');
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext };
}
function open(envelope, config) {
  try {
    if (envelope?.version !== 1 || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 100000) throw Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`quickbooks:production:${config.realmId}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const tokens = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]));
    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || tokens.refreshToken.length > 16384) throw Error();
    return tokens;
  } catch { throw fault(409, 'credential-recovery-required'); }
}
const baseStatus = { environment: 'production', syncEnabled: false, accountingWritesEnabled: false };
function createConnectionService({ db, config, fetchImpl = fetch, now = Date.now, log = () => {} }) {
  const ref = db.collection('integrationPrivate').doc(DOCUMENT);
  const configId = hash(JSON.stringify([config.realmId, config.ownerUid, config.clientId, config.clientSecret,
    config.encryptionKey, config.redirectUri, config.returnUrl]));
  async function requireOwner(uid, tx) {
    const user = db.collection('users').doc(uid);
    const profile = (await (tx ? tx.get(user) : user.get())).data();
    if (profile?.active !== true || !['owner', 'admin', 'superadmin', 'super_admin'].includes(
      String(profile.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_')) ||
      (config.ownerUid && uid !== config.ownerUid)) throw fault(403, 'owner-required');
  }
  function audit(tx, id, action, uid, outcome) {
    tx.create(ref.collection('audit').doc(`${id}-${action}`), { action, actorId: uid, outcome,
      environment: 'production', at: new Date(now()).toISOString() });
  }
  function project(record = {}) {
    const connection = record.connection;
    return { ...baseStatus, configured: true, expectedRealmId: config.realmId,
      phase: record.disconnect ? 'disconnect-pending' : record.attempt?.issuedCredentials ? 'confirmation-pending' : connection ? 'connected' : 'disconnected',
      disconnectVersion: record.disconnect?.version || (record.attempt?.issuedCredentials ? record.attempt.id : connection?.version) || null,
      connection: connection ? { realmId: connection.realmId, companyName: connection.companyName,
        country: connection.country, verifiedAt: connection.verifiedAt, connectedAt: connection.connectedAt } : null };
  }
  function checkRecord(record) {
    if (record?.configId && record.configId !== configId && (record.connection || record.credentials || record.disconnect || record.attempt?.issuedCredentials)) {
      throw fault(409, 'configuration-changed');
    }
  }
  async function status(uid) {
    await requireOwner(uid);
    try { validateConfig(config); } catch { return { ...baseStatus, configured: false, phase: 'not-configured', connection: null, disconnectVersion: null }; }
    const record = (await ref.get()).data(); checkRecord(record); return project(record);
  }
  async function provider(url, options, stage, json = true) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { log({ stage, code: 'provider-unavailable' }); throw fault(502, 'provider-unavailable'); }
    const tid = response.headers?.get('intuit_tid');
    const diagnostic = { stage, providerStatus: response.status,
      ...(typeof tid === 'string' && /^[A-Za-z0-9:-]{1,128}$/.test(tid) ? { intuitTid: tid } : {}) };
    if (!response.ok || (!json && response.status !== 200)) {
      if (response.body) await response.body.cancel().catch(() => {});
      log({ ...diagnostic, code: 'provider-rejected' }); throw fault(502, 'provider-rejected');
    }
    if (!json) { if (response.body) await response.body.cancel().catch(() => {}); return; }
    try {
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) { await reader.cancel(); throw Error(); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { log({ ...diagnostic, code: 'invalid-provider-response' }); throw fault(502, 'invalid-provider-response'); }
  }
  const basicHeaders = () => ({ Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, Accept: 'application/json' });
  async function start(uid, proofHash) {
    validateConfig(config);
    if (typeof proofHash !== 'string' || !/^[a-f0-9]{64}$/.test(proofHash)) throw fault(400, 'invalid-request');
    const state = opaque(); const id = hash(state);
    await db.runTransaction(async tx => {
      await requireOwner(uid, tx); const record = (await tx.get(ref)).data() || {}; checkRecord(record);
      if (record.disconnect || record.attempt?.issuedCredentials) throw fault(409, 'authorization-cleanup-required');
      if (record.operation?.expiresAt > now()) throw fault(409, 'connection-busy');
      if (record.lastStartAt > now() - 5000) throw fault(429, 'rate-limited');
      tx.set(ref, { ...record, configId, lastStartAt: now(), operation: null,
        attempt: { id, uid, proofHash, configId, status: 'started', expiresAt: now() + 600000 } });
      audit(tx, id, 'started', uid, 'pending');
    });
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: CALLBACK,
      response_type: 'code', scope: 'com.intuit.quickbooks.accounting', state }).toString();
    return { authorizationUrl: url.toString() };
  }
  async function callback(query) {
    validateConfig(config);
    if (!isOpaque(query.state)) throw fault(400, 'invalid-state');
    const id = hash(query.state);
    const attempt = await db.runTransaction(async tx => {
      const record = (await tx.get(ref)).data(); checkRecord(record); const pending = record?.attempt;
      if (!pending || pending.id !== id || pending.configId !== configId || pending.status !== 'started' || pending.expiresAt <= now() ||
        record.disconnect || record.operation?.expiresAt > now()) throw fault(400, 'invalid-state');
      await requireOwner(pending.uid, tx);
      tx.set(ref, { ...record, attempt: { ...pending, status: 'exchanging' }, operation: { id, expiresAt: now() + 90000 } });
      return pending;
    });
    try {
      if (query.error) throw fault(400, 'authorization-cancelled');
      if (query.realmId !== config.realmId) throw fault(400, 'wrong-company');
      if (typeof query.code !== 'string' || !query.code || query.code.length > 4096) throw fault(400, 'invalid-request');
      const tokens = await provider(TOKEN, { method: 'POST', headers: { ...basicHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: CALLBACK }).toString() }, 'exchange');
      if (![tokens.access_token, tokens.refresh_token].every(value => typeof value === 'string' && value.length > 0 && value.length <= 16384) ||
        String(tokens.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || tokens.expires_in > 86400) throw fault(502, 'invalid-provider-response');
      const credentials = seal({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessExpiresAt: now() + tokens.expires_in * 1000 }, config);
      // Persist issued tokens for cleanup even if company verification or browser completion fails.
      await db.runTransaction(async tx => {
        const record = (await tx.get(ref)).data();
        if (record?.attempt?.id !== id || record.operation?.id !== id) throw fault(409, 'invalid-state');
        tx.set(ref, { ...record, attempt: { ...record.attempt, issuedCredentials: credentials } });
      });
      await requireOwner(attempt.uid);
      const info = await provider(`${API}${config.realmId}/companyinfo/${config.realmId}`, {
        method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } }, 'company-verification');
      const company = info?.CompanyInfo;
      // CompanyInfo.Id is an entity ID, not the realm. Realm is pinned before code exchange.
      if (typeof company?.Id !== 'string' || !company.Id || typeof company.CompanyName !== 'string' || !company.CompanyName.trim()) throw fault(502, 'company-verification-failed');
      const verifiedAt = new Date(now()).toISOString(); const ticket = opaque();
      await db.runTransaction(async tx => {
        await requireOwner(attempt.uid, tx); const record = (await tx.get(ref)).data();
        if (record?.attempt?.id !== id || record.operation?.id !== id || record.operation.expiresAt <= now() || record.attempt.expiresAt <= now()) throw fault(409, 'invalid-state');
        tx.set(ref, { ...record, operation: null, attempt: { ...record.attempt, status: 'awaiting-finish', ticketHash: hash(ticket),
          company: { realmId: config.realmId, companyName: company.CompanyName.slice(0, 200),
            country: typeof company.Country === 'string' ? company.Country.slice(0, 80) : null, verifiedAt } } });
        audit(tx, id, 'verified', attempt.uid, 'awaiting-browser-confirmation');
      });
      return { ticket };
    } catch (error) {
      const code = error.safeCode || 'connection-failed';
      await db.runTransaction(async tx => {
        const record = (await tx.get(ref)).data();
        if (record?.attempt?.id !== id || record.attempt.status !== 'exchanging') return;
        tx.set(ref, { ...record, operation: null, attempt: { ...record.attempt, status: 'failed' } });
        audit(tx, id, 'failed', attempt.uid, code);
      });
      return { error: code };
    }
  }
  async function finish(uid, ticket, proof) {
    validateConfig(config);
    if (!isOpaque(ticket) || !isOpaque(proof)) throw fault(400, 'invalid-request');
    return db.runTransaction(async tx => {
      await requireOwner(uid, tx); const record = (await tx.get(ref)).data(); checkRecord(record); const attempt = record?.attempt;
      if (!attempt || record.disconnect || attempt.configId !== configId || attempt.uid !== uid || attempt.expiresAt <= now() ||
        attempt.ticketHash !== hash(ticket) || attempt.proofHash !== hash(proof)) throw fault(400, 'invalid-state');
      if (attempt.status === 'completed') return project(record);
      if (attempt.status !== 'awaiting-finish' || !attempt.issuedCredentials || attempt.company?.realmId !== config.realmId) throw fault(400, 'invalid-state');
      const { issuedCredentials, company, ...completed } = attempt;
      const next = { ...record, credentials: issuedCredentials, connection: { ...company, version: opaque(), connectedBy: uid, connectedAt: new Date(now()).toISOString() },
        operation: null, attempt: { ...completed, status: 'completed' } };
      tx.set(ref, next); audit(tx, attempt.id, 'connected', uid, 'identity-verified-accounting-disabled'); return project(next);
    });
  }
  async function disconnect(uid, version) {
    validateConfig(config);
    if (typeof version !== 'string' || !/^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/.test(version)) throw fault(400, 'invalid-request');
    const id = opaque();
    const remaining = await db.runTransaction(async tx => {
      await requireOwner(uid, tx); const record = (await tx.get(ref)).data() || {}; checkRecord(record);
      if (!record.connection && !record.disconnect && !record.attempt?.issuedCredentials && record.lastDisconnectedVersion === version) return null;
      if (project(record).disconnectVersion !== version) throw fault(409, 'stale-connection');
      if (record.operation?.expiresAt > now() || (record.disconnect?.state === 'revoking' && record.disconnect.expiresAt > now())) throw fault(409, 'connection-busy');
      const queue = record.disconnect?.remaining || [record.attempt?.issuedCredentials, record.credentials].filter(Boolean);
      if (!queue.length && !record.disconnect) throw fault(409, 'credential-recovery-required');
      const next = { ...record, credentials: null, connection: null, attempt: null, operation: null,
        disconnect: { id, version, remaining: queue, state: 'revoking', expiresAt: now() + 90000 } };
      tx.set(ref, next); audit(tx, id, 'disconnect-started', uid, 'access-suspended'); return queue;
    });
    if (!remaining) return status(uid);
    try {
      for (let index = 0; index < remaining.length; index++) {
        const tokens = open(remaining[index], config);
        await provider(REVOKE, { method: 'POST', headers: { ...basicHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokens.refreshToken }) }, 'revocation', false);
        await db.runTransaction(async tx => {
          const record = (await tx.get(ref)).data();
          if (record?.disconnect?.id !== id) throw fault(409, 'stale-connection');
          tx.set(ref, { ...record, disconnect: { ...record.disconnect, remaining: remaining.slice(index + 1) } });
        });
      }
      await db.runTransaction(async tx => {
        const record = (await tx.get(ref)).data();
        if (record?.disconnect?.id !== id) throw fault(409, 'stale-connection');
        tx.set(ref, { ...record, disconnect: null, lastDisconnectedVersion: version });
        audit(tx, id, 'disconnected', uid, 'provider-revocation-confirmed');
      });
    } catch {
      await db.runTransaction(async tx => {
        const record = (await tx.get(ref)).data(); if (record?.disconnect?.id !== id) return;
        tx.set(ref, { ...record, disconnect: { ...record.disconnect, state: 'pending', expiresAt: now() } });
        audit(tx, id, 'disconnect-pending', uid, 'provider-revocation-unconfirmed');
      });
      throw fault(409, 'revocation-pending');
    }
    return status(uid);
  }
  return { requireOwner, status, start, callback, finish, disconnect };
}
module.exports = { createConnectionService, validateConfig, fault, hash, seal, open, RETURN, CALLBACK };
