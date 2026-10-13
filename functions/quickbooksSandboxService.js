'use strict';

const crypto = require('node:crypto');
const DOCUMENT = 'quickbooksSandbox';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
const SCOPE = 'com.intuit.quickbooks.accounting';
const ATTEMPT_MS = 10 * 60 * 1000;
const opaque = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fault = (status, code) => Object.assign(new Error(code), { status, safeCode: code });
const isOpaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const isAdmin = profile => profile?.active === true && ['owner', 'admin', 'superadmin', 'super_admin'].includes(
  String(profile.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_'));

function validateConfig(config) {
  if (!config.enabled) throw fault(503, 'not-configured');
  if (!config.clientId || !config.clientSecret || !/^\d{6,30}$/.test(config.realmId || '')) throw fault(503, 'not-configured');
  if (typeof config.encryptionKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(config.encryptionKey)) throw fault(503, 'not-configured');
  let redirect; let destination;
  try { redirect = new URL(config.redirectUri); destination = new URL(config.returnUrl); } catch { throw fault(503, 'not-configured'); }
  for (const url of [redirect, destination]) {
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) throw fault(503, 'not-configured');
  }
  if (!redirect.pathname.endsWith('/quickbooksSandbox/callback') || destination.pathname !== '/integrations/') throw fault(503, 'not-configured');
  return config;
}

function sealTokens(tokens, key, realmId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  cipher.setAAD(Buffer.from(`quickbooks:sandbox:${realmId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') };
}

function publicStatus(record, config) {
  // Explicit projection: neither the pending handshake nor provider credentials leave the server.
  const connection = record?.connection;
  return { configured: true, environment: 'sandbox', syncEnabled: false, expectedRealmId: config.realmId,
    connection: connection?.realmId === config.realmId ? {
      realmId: connection.realmId, companyName: connection.companyName, country: connection.country,
      verifiedAt: connection.verifiedAt, connectedAt: connection.connectedAt,
    } : null };
}

function createSandboxService({ db, config, fetchImpl = fetch, now = Date.now }) {
  const ref = db.collection('integrationPrivate').doc(DOCUMENT);
  const configId = hash(JSON.stringify([config.realmId, config.clientId, config.redirectUri, config.returnUrl, config.encryptionKey]));
  const userRef = uid => db.collection('users').doc(uid);
  const audit = (tx, id, action, uid, outcome) => tx.create(ref.collection('audit').doc(`${id}-${action}`), {
    actorId: uid, authority: 'active-erp-super-admin', target: `sandbox:${config.realmId}`,
    action, outcome, correlationId: id, at: new Date(now()).toISOString(),
  });
  async function requireAdmin(uid, tx) {
    const snapshot = await (tx ? tx.get(userRef(uid)) : userRef(uid).get());
    if (!isAdmin(snapshot.data())) throw fault(403, 'admin-required');
  }
  async function status(uid) {
    await requireAdmin(uid);
    return publicStatus((await ref.get()).data(), config);
  }
  async function start(uid, proofHash) {
    if (typeof proofHash !== 'string' || !/^[a-f0-9]{64}$/.test(proofHash)) throw fault(400, 'invalid-request');
    const state = opaque(); const id = hash(state);
    await db.runTransaction(async tx => {
      await requireAdmin(uid, tx);
      const record = (await tx.get(ref)).data() || {};
      if (record.reportOperation?.expiresAt > now()) throw fault(409, 'report-busy');
      const previous = record.attempt;
      if (previous?.expiresAt > now() && (previous.status === 'exchanging' ||
        (['started', 'awaiting-finish'].includes(previous.status) && previous.uid !== uid))) throw fault(409, 'connection-busy');
      tx.set(ref, { ...record, attempt: { id, uid, proofHash, configId, status: 'started', expiresAt: now() + ATTEMPT_MS } });
      audit(tx, id, 'started', uid, 'pending');
    });
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: 'code', scope: SCOPE, state }).toString();
    return { authorizationUrl: url.toString() };
  }
  async function providerJson(url, options) {
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw fault(502, 'provider-unavailable');
      return await response.json();
    } catch { throw fault(502, 'provider-unavailable'); }
  }
  async function markFailed(id, uid, code) {
    await db.runTransaction(async tx => {
      const record = (await tx.get(ref)).data();
      if (record?.attempt?.id !== id || record.attempt.status !== 'exchanging') return;
      tx.set(ref, { ...record, attempt: { id, uid, status: 'failed', expiresAt: now() } });
      audit(tx, id, 'failed', uid, code);
    });
  }
  async function callback(query) {
    if (!isOpaque(query.state)) throw fault(400, 'invalid-state');
    const id = hash(query.state);
    const attempt = await db.runTransaction(async tx => {
      const record = (await tx.get(ref)).data();
      const pending = record?.attempt;
      if (pending?.id !== id || pending.configId !== configId || pending.expiresAt <= now() || pending.status !== 'started') throw fault(400, 'invalid-state');
      await requireAdmin(pending.uid, tx);
      tx.set(ref, { ...record, attempt: { ...pending, status: 'exchanging' } });
      return pending;
    });
    try {
      if (query.error) throw fault(400, 'authorization-cancelled');
      // Never exchange a code for a different company, even if its display name looks correct.
      if (typeof query.realmId !== 'string' || query.realmId !== config.realmId) throw fault(400, 'wrong-company');
      if (typeof query.code !== 'string' || !query.code.length || query.code.length > 4096) throw fault(400, 'invalid-request');
      const tokens = await providerJson(TOKEN_URL, { method: 'POST', headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
      }, body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: config.redirectUri }).toString() });
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 16384 ||
        typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || tokens.refresh_token.length > 16384 ||
        String(tokens.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 ||
        tokens.expires_in > 86400) throw fault(502, 'invalid-provider-response');
      const accessExpiresAt = now() + tokens.expires_in * 1000;
      const info = await providerJson(`${SANDBOX_API}${config.realmId}/companyinfo/${config.realmId}`, {
        method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      });
      const company = info?.CompanyInfo;
      // CompanyInfo.Id is the entity ID (often "1"), NOT the OAuth realm ID.
      // Tenant identity is enforced by the exact callback realm and the fixed realm-scoped API URL.
      if (typeof company?.Id !== 'string' || !company.Id || typeof company.CompanyName !== 'string' || !company.CompanyName.trim()) throw fault(502, 'company-verification-failed');
      const verifiedAt = new Date(now()).toISOString();
      const ticket = opaque();
      const pending = { credentialConfigId: hash(JSON.stringify([config.realmId, config.clientId, config.redirectUri, config.encryptionKey])),
        credentials: sealTokens({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
        accessExpiresAt }, config.encryptionKey, config.realmId),
      connection: { realmId: config.realmId, companyName: company.CompanyName.slice(0, 200),
        country: typeof company.Country === 'string' ? company.Country.slice(0, 80) : null, verifiedAt, connectedAt: verifiedAt, connectedBy: attempt.uid } };
      await db.runTransaction(async tx => {
        await requireAdmin(attempt.uid, tx);
        const record = (await tx.get(ref)).data();
        if (record?.attempt?.id !== id || record.attempt.status !== 'exchanging' || record.attempt.expiresAt <= now()) throw fault(409, 'invalid-state');
        tx.set(ref, { ...record, attempt: { ...record.attempt, status: 'awaiting-finish', ticketHash: hash(ticket), pending } });
        audit(tx, id, 'verified', attempt.uid, 'awaiting-browser-confirmation');
      });
      return { ticket };
    } catch (error) {
      const code = error.safeCode || 'connection-failed';
      await markFailed(id, attempt.uid, code);
      return { error: code };
    }
  }
  async function finish(uid, ticket, proof) {
    if (!isOpaque(ticket) || !isOpaque(proof)) throw fault(400, 'invalid-request');
    return db.runTransaction(async tx => {
      await requireAdmin(uid, tx);
      const record = (await tx.get(ref)).data();
      const attempt = record?.attempt;
      if (!attempt || attempt.uid !== uid || attempt.configId !== configId || attempt.expiresAt <= now() || attempt.proofHash !== hash(proof) || attempt.ticketHash !== hash(ticket)) throw fault(400, 'invalid-state');
      if (attempt.status === 'completed') return publicStatus(record, config); // Lost HTTP response; no second exchange/write.
      if (attempt.status !== 'awaiting-finish' || attempt.pending.connection.realmId !== config.realmId) throw fault(400, 'invalid-state');
      const { pending, ...completed } = attempt;
      if (record.reportOperation?.expiresAt > now()) throw fault(409, 'report-busy');
      const next = { ...record, ...pending, reportOperation: null, reauthorizationRequired: false,
        attempt: { ...completed, status: 'completed' } };
      tx.set(ref, next);
      audit(tx, attempt.id, 'connected', uid, 'sandbox-authorized-sync-disabled');
      return publicStatus(next, config);
    });
  }
  return { requireAdmin, status, start, callback, finish };
}

module.exports = { createSandboxService, validateConfig, sealTokens, hash, fault, publicStatus };
