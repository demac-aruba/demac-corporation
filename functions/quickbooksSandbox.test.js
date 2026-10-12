'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createSandboxService, validateConfig, sealTokens, hash } = require('./quickbooksSandboxService');
const { createSandboxHttpHandler } = require('./quickbooksSandboxHttp');

const PATH = 'integrationPrivate/quickbooksSandbox';
const proof = Buffer.alloc(32, 7).toString('base64url');
const config = { enabled: true, clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  encryptionKey: Buffer.alloc(32, 9).toString('base64'), realmId: '1234567890123456',
  redirectUri: 'https://us-central1-demo-demac.cloudfunctions.net/quickbooksSandbox/callback', returnUrl: 'https://erp.example.test/integrations/' };

function fixture(extra = {}) {
  const db = new ReferenceDb({ 'users/owner': { role: 'admin', active: true },
    'users/other': { role: 'owner', active: true }, 'users/finance': { role: 'accounting', active: true },
    'users/inactive': { role: 'admin', active: false }, ...extra });
  // Firestore serializes conflicting transactions. The test store queues transactions and
  // enforces read-before-write so concurrent callbacks actually observe each other's claims.
  const transact = db.runTransaction.bind(db); let queue = Promise.resolve();
  db.runTransaction = fn => { const result = queue.then(() => transact(fn)); queue = result.catch(() => {}); return result; };
  let time = Date.parse('2026-10-12T21:30:00Z');
  const calls = []; const logs = [];
  let provider = async url => ({ ok: true, json: async () => url.includes('/tokens/bearer')
    ? { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600 }
    : { CompanyInfo: { Id: '1', CompanyName: 'Synthetic sandbox', Country: 'US' } } });
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return provider(url, options); };
  const now = () => time;
  let currentConfig = { ...config };
  const service = createSandboxService({ db, config: currentConfig, fetchImpl, now });
  const handler = createSandboxHttpHandler({ db, fetchImpl, now, getConfig: () => currentConfig,
    verifyIdToken: async token => { if (token === 'revoked') throw new Error('secret-in-error'); return { uid: token }; }, log: event => logs.push(event) });
  async function call({ uid = 'owner', method = 'GET', path = '/', body, query = {}, origin = 'https://erp.example.test', contentType = 'application/json' } = {}) {
    const res = response();
    await handler({ method, path, query, body, get: name => ({ origin, authorization: uid ? `Bearer ${uid}` : '', 'content-type': contentType })[name] || '' }, res);
    return res;
  }
  async function start(uid = 'owner') {
    const result = await service.start(uid, hash(proof));
    return new URL(result.authorizationUrl).searchParams.get('state');
  }
  async function authorize(state) { return service.callback({ state: state || await start(), code: 'synthetic-code', realmId: config.realmId }); }
  return { db, service, calls, logs, call, start, authorize, now, advance: ms => { time += ms; },
    provider: fn => { provider = fn; }, configure: value => { currentConfig = { ...currentConfig, ...value }; } };
}

test('configuration fails closed and does not accept unsafe redirects or invalid encryption keys', () => {
  assert.equal(validateConfig(config), config);
  for (const patch of [{ enabled: false }, { clientSecret: '' }, { realmId: '12x' }, { encryptionKey: 'bad' },
    { returnUrl: 'http://erp.example.test/integrations/' }, { returnUrl: 'https://evil:pass@erp.example.test/integrations/' },
    { returnUrl: 'https://erp.example.test/integrations/?next=evil' }, { redirectUri: 'https://api.example.test/other' }]) {
    assert.throws(() => validateConfig({ ...config, ...patch }), { safeCode: 'not-configured' });
  }
});

test('HTTP auth, profile, origin and method checks cover reads and writes', async () => {
  const f = fixture();
  for (const uid of ['', 'revoked']) assert.equal((await f.call({ uid })).statusCode, 401);
  for (const uid of ['unknown', 'finance', 'inactive']) {
    assert.equal((await f.call({ uid })).statusCode, 403);
    assert.equal((await f.call({ uid, method: 'POST', body: { action: 'start', proofHash: hash(proof) } })).statusCode, 403);
  }
  assert.equal((await f.call({ origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await f.call({ method: 'OPTIONS' })).statusCode, 204);
  assert.equal((await f.call({ method: 'PUT' })).statusCode, 405);
  assert.equal((await f.call({ method: 'POST', body: { action: 'start', proofHash: hash(proof) }, contentType: 'text/plain' })).statusCode, 400);
  assert.equal(f.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret-in-error|Bearer/);
});

test('disabled service exposes only not-configured status and denies OAuth', async () => {
  const f = fixture(); f.configure({ enabled: false });
  assert.equal((await f.call()).body.configured, false);
  assert.equal((await f.call({ method: 'POST', body: { action: 'start', proofHash: hash(proof) } })).statusCode, 503);
  assert.equal(f.calls.length, 0);
});

test('successful OAuth needs same ERP actor, browser proof and completion ticket; only safe status leaves server', async () => {
  const f = fixture();
  const start = await f.service.start('owner', hash(proof));
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin, 'https://appcenter.intuit.com');
  assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  const { ticket } = await f.authorize(url.searchParams.get('state'));
  assert.equal((await f.service.status('owner')).connection, null);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].url, `https://sandbox-quickbooks.api.intuit.com/v3/company/${config.realmId}/companyinfo/${config.realmId}`);
  assert.equal(f.calls[1].options.method, 'GET');
  assert.equal(f.calls[0].options.redirect, 'error');
  for (const args of [['other', ticket, proof], ['owner', ticket, Buffer.alloc(32, 8).toString('base64url')], ['owner', proof, proof]]) {
    await assert.rejects(f.service.finish(...args), { safeCode: 'invalid-state' });
  }
  const finished = await f.service.finish('owner', ticket, proof);
  assert.equal(finished.connection.companyName, 'Synthetic sandbox');
  assert.equal(finished.connection.realmId, config.realmId); // CompanyInfo.Id is "1", not realm.
  assert.equal(finished.syncEnabled, false);
  assert.deepEqual(await f.service.finish('owner', ticket, proof), finished);
  assert.doesNotMatch(JSON.stringify(finished), /synthetic-access|synthetic-refresh|ciphertext|proofHash|ticketHash/);
  assert.doesNotMatch(JSON.stringify([...f.db.records]), /synthetic-access|synthetic-refresh/);
  const audits = [...f.db.records].filter(([path]) => path.includes('/audit/'));
  assert.equal(audits.length, 3);
  assert.equal(audits.at(-1)[1].actorId, 'owner');
  assert.equal(f.calls.length, 2); // Finish retries never re-exchange authorization codes.
});

test('AES-GCM credentials authenticate ciphertext and realm; nonce is fresh', () => {
  const tokens = { accessToken: 'synthetic-token' };
  const first = sealTokens(tokens, config.encryptionKey, config.realmId);
  assert.notEqual(first.iv, sealTokens(tokens, config.encryptionKey, config.realmId).iv);
  const open = (realm, tag = first.tag) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), Buffer.from(first.iv, 'base64'));
    decipher.setAAD(Buffer.from(`quickbooks:sandbox:${realm}`)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(first.ciphertext, 'base64')), decipher.final()]).toString());
  };
  assert.deepEqual(open(config.realmId), tokens);
  assert.throws(() => open('another-realm'));
  assert.throws(() => open(config.realmId, Buffer.alloc(16).toString('base64')));
});

test('slow company verification does not extend the stored access-token lifetime', async () => {
  const f = fixture(); const obtainedAt = f.now();
  f.provider(async url => {
    if (url.includes('/tokens/bearer')) return { ok: true, json: async () => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600 }) };
    f.advance(10000);
    return { ok: true, json: async () => ({ CompanyInfo: { Id: '1', CompanyName: 'Synthetic sandbox' } }) };
  });
  await f.authorize();
  const envelope = f.db.records.get(PATH).attempt.pending.credentials;
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`quickbooks:sandbox:${config.realmId}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const tokens = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString());
  assert.equal(tokens.accessExpiresAt, obtainedAt + 3600000);
});

test('wrong realm, duplicate query values and cancellation never reach provider or replace old connection', async () => {
  for (const patch of [{ realmId: '9999999999999999' }, { realmId: [config.realmId, config.realmId] }, { error: 'access_denied' }]) {
    const old = { realmId: config.realmId, companyName: 'Previous verification' };
    const f = fixture({ [PATH]: { connection: old, credentials: { ciphertext: 'old-encrypted-value' } } });
    const result = await f.service.callback({ state: await f.start(), code: 'synthetic-code', realmId: config.realmId, ...patch });
    assert.ok(result.error);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.db.records.get(PATH).connection, old);
    assert.equal(f.db.records.get(PATH).credentials.ciphertext, 'old-encrypted-value');
  }
});

test('unknown, expired, superseded and concurrent callback states fail; one exchange wins', async () => {
  const f = fixture(); const old = await f.start(); const state = await f.start();
  await assert.rejects(f.authorize(old), { safeCode: 'invalid-state' });
  const results = await Promise.allSettled([f.authorize(state), f.authorize(state)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.calls.length, 2);
  const newer = await f.start(); f.advance(600001);
  await assert.rejects(f.authorize(newer), { safeCode: 'invalid-state' });
  await assert.rejects(f.authorize(proof), { safeCode: 'invalid-state' });
});

test('in-flight callback is fenced after expiry and new start; provider errors are redacted', async () => {
  const f = fixture(); let release; let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.provider(async () => { entered(); await new Promise(resolve => { release = resolve; }); throw new Error('provider-secret-body'); });
  const state = await f.start(); const running = f.authorize(state); await waiting;
  await assert.rejects(f.start(), { safeCode: 'connection-busy' });
  f.advance(600001); const newer = await f.start(); release();
  const result = await running;
  assert.equal(result.error, 'provider-unavailable');
  assert.equal(f.db.records.get(PATH).attempt.id, hash(newer));
  assert.equal(f.db.records.get(PATH).attempt.status, 'started');
  assert.doesNotMatch(JSON.stringify([...f.db.records]), /provider-secret-body/);
});

test('deactivated owner and changed config cannot finish a grant', async () => {
  const f = fixture(); const { ticket } = await f.authorize();
  f.db.records.set('users/owner', { role: 'admin', active: false });
  await assert.rejects(f.service.finish('owner', ticket, proof), { safeCode: 'admin-required' });
  f.db.records.set('users/owner', { role: 'admin', active: true });
  const changed = createSandboxService({ db: f.db, config: { ...config, encryptionKey: Buffer.alloc(32, 4).toString('base64') }, now: f.now });
  await assert.rejects(changed.finish('owner', ticket, proof), { safeCode: 'invalid-state' });
  f.advance(600001);
  await assert.rejects(f.service.finish('owner', ticket, proof), { safeCode: 'invalid-state' });
});

test('callback HTTP redirects only a completion ticket in fragment, never provider tokens', async () => {
  const f = fixture(); const state = await f.start();
  const res = await f.call({ uid: '', path: '/callback', origin: '', query: { state, code: 'synthetic-code', realmId: config.realmId } });
  assert.equal(res.statusCode, 302);
  const destination = new URL(res.headers.Location);
  assert.equal(destination.origin, 'https://erp.example.test');
  assert.equal(destination.search, '');
  assert.match(destination.hash, /^#qbo_ticket=/);
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.doesNotMatch(JSON.stringify(res), /synthetic-code|synthetic-access|synthetic-refresh/);
  assert.equal((await f.call({ path: '/callback', method: 'POST' })).statusCode, 405);
});

test('malformed provider token and missing CompanyInfo fail without committing credentials', async () => {
  for (const body of [{}, { access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: '3600' }]) {
    const f = fixture(); f.provider(async () => ({ ok: true, json: async () => body }));
    assert.equal((await f.authorize()).error, 'invalid-provider-response');
    assert.equal(f.db.records.get(PATH).connection, undefined);
  }
  const f = fixture();
  f.provider(async url => ({ ok: true, json: async () => url.includes('/tokens/bearer')
    ? { access_token: 'x', refresh_token: 'y', token_type: 'bearer', expires_in: 3600 } : { CompanyInfo: { Id: '1' } } }));
  assert.equal((await f.authorize()).error, 'company-verification-failed');
  assert.equal(f.db.records.get(PATH).credentials, undefined);
});
