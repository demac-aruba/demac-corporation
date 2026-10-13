'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createConnectionService, validateConfig, hash, seal, open, RETURN, CALLBACK } = require('./quickbooksConnectionService');
const { createConnectionHttpHandler } = require('./quickbooksConnectionHttp');
const PATH = 'integrationPrivate/quickbooksProduction';
const config = { enabled: true, ownerUid: 'owner', realmId: '1234567890123456', clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  encryptionKey: Buffer.alloc(32, 8).toString('base64'), redirectUri: CALLBACK, returnUrl: RETURN };
const proof = Buffer.alloc(32, 2).toString('base64url');
function fixture(patch = {}) {
  let time = Date.parse('2026-10-13T02:30:00Z');
  const cfg = { ...config, ...patch };
  const db = new ReferenceDb({ 'users/owner': { active: true, role: 'owner' }, 'users/admin': { active: true, role: 'admin' },
    'users/finance': { active: true, role: 'accounting' }, 'integrationPrivate/quickbooksSandbox': { unchanged: 'sandbox' },
    'appointments/real-example': { unchanged: 'customer-data' } });
  const transact = db.runTransaction.bind(db); let queue = Promise.resolve();
  db.runTransaction = fn => { const result = queue.then(() => transact(fn)); queue = result.catch(() => {}); return result; };
  const calls = []; const logs = [];
  let provider = async url => url.includes('/tokens/revoke') ? new Response('{}', { status: 200 }) : Response.json(url.includes('/tokens/bearer')
    ? { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600 }
    : { CompanyInfo: { Id: '1', CompanyName: 'Synthetic DEMAC test', Country: 'AW' } });
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return provider(url, options); };
  const now = () => time;
  const service = createConnectionService({ db, config: cfg, fetchImpl, now, log: item => logs.push(item) });
  const handler = createConnectionHttpHandler({ db, getConfig: () => cfg, fetchImpl, now, log: item => logs.push(item),
    verifyIdToken: async token => { if (token === 'revoked') throw Error('private-error'); return { uid: token }; } });
  async function http({ uid = 'owner', method = 'GET', path = '/', origin = 'https://demac-aruba.com', body, query, contentType = 'application/json' } = {}) {
    const res = response();
    await handler({ method, path, body, query, get: key => ({ origin, authorization: uid ? `Bearer ${uid}` : '', 'content-type': contentType })[key] }, res);
    return res;
  }
  async function begin() { const result = await service.start('owner', hash(proof)); return new URL(result.authorizationUrl).searchParams.get('state'); }
  async function authorize(state) { return service.callback({ state: state || await begin(), realmId: cfg.realmId, code: 'synthetic-code' }); }
  async function connect() { const { ticket } = await authorize(); return service.finish('owner', ticket, proof); }
  return { db, cfg, calls, logs, service, http, begin, authorize, connect, now, advance: ms => { time += ms; }, provider: fn => { provider = fn; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('production configuration is explicit, fixed-company, fixed-callback and separate from sandbox', () => {
  for (const patch of [{ enabled: false }, { ownerUid: '' }, { realmId: '9341458478454738' }, { realmId: 'bad' }, { clientId: '' },
    { clientSecret: '' }, { encryptionKey: 'x' }, { redirectUri: 'https://untrusted.example/callback' }, { returnUrl: RETURN + '?redirect=evil' }]) {
    assert.throws(() => validateConfig({ ...config, ...patch }), { safeCode: 'not-configured' });
  }
});

test('disabled connection reads no integration record, invokes no provider and rejects mutation', async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.service.status('owner')).configured, false);
  assert.equal((await f.http({ method: 'POST', body: { action: 'start', proofHash: hash(proof) } })).statusCode, 503);
  assert.equal(f.calls.length, 0); assert.equal(f.db.records.has(PATH), false);
});

test('fresh designated-owner authorization, method, origin, input and no-store boundaries', async () => {
  const f = fixture();
  for (const uid of ['', 'revoked']) assert.equal((await f.http({ uid })).statusCode, 401);
  for (const uid of ['finance', 'unknown', 'admin']) assert.equal((await f.http({ uid })).statusCode, 403);
  assert.equal((await f.http({ origin: 'https://untrusted.example' })).statusCode, 403);
  assert.equal((await f.http({ method: 'DELETE' })).statusCode, 405);
  assert.equal((await f.http({ path: '/disconnect' })).statusCode, 404);
  assert.equal((await f.http({ path: '/callback', method: 'POST' })).statusCode, 405);
  for (const body of [{ action: 'report' }, { action: 'start', realmId: 'other', proofHash: hash(proof) }, [], { action: '__proto__' }]) {
    assert.equal((await f.http({ method: 'POST', body })).statusCode, 400);
  }
  assert.equal((await f.http({ method: 'POST', body: { action: 'start' }, contentType: 'text/plain' })).statusCode, 400);
  const res = await f.http(); assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer'); assert.equal(f.calls.length, 0);
  f.db.records.set('users/owner', { active: false, role: 'owner' }); assert.equal((await f.http()).statusCode, 403);
  assert.doesNotMatch(JSON.stringify(f.logs), /private-error|synthetic-secret|Bearer/);
});

test('OAuth requires same owner, browser proof and explicit completion; only CompanyInfo GET is allowed', async () => {
  const f = fixture(); const { ticket } = await f.authorize();
  const before = await f.service.status('owner'); assert.equal(before.phase, 'confirmation-pending'); assert.equal(before.connection, null);
  await assert.rejects(f.service.finish('admin', ticket, proof), { safeCode: 'owner-required' });
  await assert.rejects(f.service.finish('owner', ticket, Buffer.alloc(32, 7).toString('base64url')), { safeCode: 'invalid-state' });
  const result = await f.service.finish('owner', ticket, proof); assert.equal(result.phase, 'connected'); assert.equal(result.syncEnabled, false);
  assert.equal(result.connection.realmId, config.realmId); assert.equal(result.accountingWritesEnabled, false);
  assert.deepEqual(await f.service.finish('owner', ticket, proof), result);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.method, 'GET');
  assert.equal(f.calls[1].url, `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/companyinfo/${config.realmId}`);
  assert.equal(f.calls[0].options.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-access|synthetic-refresh|ciphertext|proofHash|ticketHash/);
  assert.doesNotMatch(JSON.stringify([...f.db.records]), /synthetic-access|synthetic-refresh/);
});

test('wrong company, cancelled consent and duplicate query values never exchange credentials', async () => {
  for (const patch of [{ realmId: '999999999' }, { realmId: [config.realmId, config.realmId] }, { error: 'access_denied' }, { code: ['a', 'b'] }]) {
    const f = fixture(); const state = await f.begin();
    const result = await f.service.callback({ state, code: 'synthetic-code', realmId: config.realmId, ...patch });
    assert.ok(result.error); assert.equal(f.calls.length, 0); assert.equal((await f.service.status('owner')).phase, 'disconnected');
  }
});

test('expired, superseded and replayed states fail; one concurrent callback wins', async () => {
  const f = fixture(); const state = await f.begin(); f.advance(5001); const next = await f.begin();
  await assert.rejects(f.authorize(state), { safeCode: 'invalid-state' });
  const result = await Promise.allSettled([f.authorize(next), f.authorize(next)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.length, 2);
  const expired = fixture(); const old = await expired.begin(); expired.advance(600001);
  await assert.rejects(expired.authorize(old), { safeCode: 'invalid-state' }); assert.equal(expired.calls.length, 0);
});

test('credentials are production-bound AES-GCM; wrong realm, key and modified ciphertext fail closed', () => {
  const tokens = { refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access' };
  const envelope = seal(tokens, config); assert.deepEqual(open(envelope, config), tokens);
  assert.notEqual(seal(tokens, config).iv, envelope.iv);
  for (const cfg of [{ ...config, realmId: 'other' }, { ...config, encryptionKey: Buffer.alloc(32, 3).toString('base64') }]) {
    assert.throws(() => open(envelope, cfg), { safeCode: 'credential-recovery-required' });
  }
});

test('callback redirect carries only opaque ticket, with no code or tokens', async () => {
  const f = fixture(); const state = await f.begin();
  const res = await f.http({ uid: '', path: '/callback', origin: '', query: { state, realmId: config.realmId, code: 'synthetic-code' } });
  assert.equal(res.statusCode, 302); assert.ok(res.headers.Location.startsWith(RETURN + '#qbo_production_ticket='));
  assert.doesNotMatch(JSON.stringify(res), /synthetic-code|synthetic-access|synthetic-refresh/);
});

test('company verification failure retains encrypted issued token for explicit cleanup', async () => {
  const f = fixture(); f.provider(async url => Response.json(url.includes('/tokens/bearer')
    ? { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600 } : { CompanyInfo: {} }));
  assert.equal((await f.authorize()).error, 'company-verification-failed');
  const status = await f.service.status('owner'); assert.equal(status.phase, 'confirmation-pending'); assert.ok(status.disconnectVersion);
  await assert.rejects(f.begin(), { safeCode: 'authorization-cleanup-required' });
  f.provider(async () => new Response('{}', { status: 200 }));
  assert.equal((await f.service.disconnect('owner', status.disconnectVersion)).phase, 'disconnected');
});

test('GET status never revokes; explicit disconnect revokes refresh token and preserves all customer/sandbox data', async () => {
  const f = fixture(); const status = await f.connect(); const count = f.calls.length;
  await f.http({ query: { disconnect: 'true', realmId: 'different' } }); assert.equal(f.calls.length, count);
  const result = await f.service.disconnect('owner', status.disconnectVersion);
  assert.equal(result.phase, 'disconnected'); assert.equal(result.connection, null);
  const request = f.calls.at(-1); assert.equal(request.url, 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke');
  assert.equal(request.options.method, 'POST'); assert.deepEqual(JSON.parse(request.options.body), { token: 'synthetic-refresh' });
  assert.equal(f.db.records.get(PATH).credentials, null); assert.equal(f.db.records.get(PATH).attempt, null);
  assert.deepEqual(f.db.records.get('integrationPrivate/quickbooksSandbox'), { unchanged: 'sandbox' });
  assert.deepEqual(f.db.records.get('appointments/real-example'), { unchanged: 'customer-data' });
  assert.deepEqual(await f.service.disconnect('owner', status.disconnectVersion), result); assert.equal(f.calls.length, count + 1);
});

test('stale disconnect cannot revoke a newer company authorization', async () => {
  const f = fixture(); const old = await f.connect(); f.advance(5001); const newer = await f.connect();
  assert.notEqual(old.disconnectVersion, newer.disconnectVersion); const count = f.calls.length;
  await assert.rejects(f.service.disconnect('owner', old.disconnectVersion), { safeCode: 'stale-connection' });
  assert.equal(f.calls.length, count); assert.equal((await f.service.status('owner')).phase, 'connected');
});

test('uncertain revocation suspends access and blocks reconnect until explicit retry succeeds', async () => {
  for (const provider of [async () => { throw Error('private-provider-body'); }, async () => new Response('private', { status: 400 }),
    async () => new Response('', { status: 202 })]) {
    const f = fixture(); const connected = await f.connect(); f.provider(provider);
    await assert.rejects(f.service.disconnect('owner', connected.disconnectVersion), { safeCode: 'revocation-pending' });
    const pending = await f.service.status('owner'); assert.equal(pending.phase, 'disconnect-pending'); assert.equal(pending.connection, null);
    assert.equal(f.calls.length, 3); await assert.rejects(f.begin(), { safeCode: 'authorization-cleanup-required' });
    await f.service.status('owner'); assert.equal(f.calls.length, 3);
    f.provider(async () => new Response('{}', { status: 200 }));
    assert.equal((await f.service.disconnect('owner', pending.disconnectVersion)).phase, 'disconnected');
    assert.doesNotMatch(JSON.stringify(f.logs), /private-provider-body|synthetic-refresh/);
  }
});

test('lost final database response recovers without repeating confirmed revocation', async () => {
  const f = fixture(); const connected = await f.connect();
  const tx = f.db.runTransaction.bind(f.db); let failOnce = true;
  f.db.runTransaction = async fn => {
    const current = f.db.records.get(PATH);
    if (current?.disconnect?.remaining.length === 0 && failOnce) { failOnce = false; throw Error('transient'); }
    return tx(fn);
  };
  await assert.rejects(f.service.disconnect('owner', connected.disconnectVersion), { safeCode: 'revocation-pending' });
  assert.equal(f.db.records.get(PATH).disconnect.remaining.length, 0);
  assert.equal((await f.service.disconnect('owner', connected.disconnectVersion)).phase, 'disconnected');
  assert.equal(f.calls.filter(call => call.url.includes('/revoke')).length, 1);
});

test('disconnect and reconnect serialize; concurrent disconnect makes only one provider call', async () => {
  const f = fixture(); const connected = await f.connect(); const entered = deferred(); const release = deferred();
  f.provider(async () => { entered.resolve(); await release.promise; return new Response('{}', { status: 200 }); });
  const first = f.service.disconnect('owner', connected.disconnectVersion); await entered.promise;
  await assert.rejects(f.service.disconnect('owner', connected.disconnectVersion), { safeCode: 'connection-busy' });
  await assert.rejects(f.begin(), { safeCode: 'authorization-cleanup-required' });
  release.resolve(); await first; assert.equal(f.calls.filter(call => call.url.includes('/revoke')).length, 1);
});

test('in-flight OAuth excludes disconnect and completion after owner deactivation', async () => {
  const f = fixture(); const connected = await f.connect(); f.advance(5001); const state = await f.begin();
  const entered = deferred(); const release = deferred();
  f.provider(async () => { entered.resolve(); await release.promise; throw Error('private'); });
  const flow = f.authorize(state); await entered.promise;
  await assert.rejects(f.service.disconnect('owner', connected.disconnectVersion), { safeCode: 'connection-busy' });
  release.resolve(); await flow;
  const g = fixture(); const { ticket } = await g.authorize(); g.db.records.set('users/owner', { active: false, role: 'owner' });
  await assert.rejects(g.service.finish('owner', ticket, proof), { safeCode: 'owner-required' });
});

test('pending new grant cleanup revokes both issued and prior credentials, invalidates finish', async () => {
  const f = fixture(); await f.connect(); f.advance(5001); const { ticket } = await f.authorize();
  const pending = await f.service.status('owner');
  await f.service.disconnect('owner', pending.disconnectVersion);
  assert.equal(f.calls.filter(call => call.url.includes('/revoke')).length, 2);
  await assert.rejects(f.service.finish('owner', ticket, proof), { safeCode: 'invalid-state' });
});

test('safe diagnostic includes bounded Intuit trace ID but no raw provider body', async () => {
  const f = fixture(); f.provider(async () => new Response('secret-provider-body', { status: 400, headers: { intuit_tid: '1-abc-123' } }));
  assert.equal((await f.authorize()).error, 'provider-rejected');
  assert.equal(f.logs[0].intuitTid, '1-abc-123'); assert.equal(f.logs[0].providerStatus, 400);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret-provider-body|synthetic-code|synthetic-secret/);
});

test('configuration change cannot read or revoke credentials belonging to previous configuration', async () => {
  const f = fixture(); const connected = await f.connect();
  const different = createConnectionService({ db: f.db, config: { ...config, clientSecret: 'rotated-secret' } });
  await assert.rejects(different.status('owner'), { safeCode: 'configuration-changed' });
  await assert.rejects(different.disconnect('owner', connected.disconnectVersion), { safeCode: 'configuration-changed' });
});

test('owner deactivation during exchange retains cleanup tokens but prevents the company read', async () => {
  const f = fixture(); f.provider(async () => {
    f.db.records.set('users/owner', { active: false, role: 'owner' });
    return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600 });
  });
  assert.equal((await f.authorize()).error, 'owner-required'); assert.equal(f.calls.length, 1);
  assert.ok(f.db.records.get(PATH).attempt.issuedCredentials);
  assert.equal(f.db.records.get(PATH).connection, undefined);
});

test('unauthorized disconnect never calls Intuit or removes existing credentials', async () => {
  const f = fixture(); const connected = await f.connect(); const before = JSON.stringify(f.db.records.get(PATH));
  await assert.rejects(f.service.disconnect('admin', connected.disconnectVersion), { safeCode: 'owner-required' });
  f.db.records.set('users/owner', { active: false, role: 'owner' });
  await assert.rejects(f.service.disconnect('owner', connected.disconnectVersion), { safeCode: 'owner-required' });
  assert.equal(JSON.stringify(f.db.records.get(PATH)), before); assert.equal(f.calls.length, 2);
});

test('malformed and oversized provider bodies fail without leaking or accepting credentials', async () => {
  for (const body of ['{malformed', 'x'.repeat(128 * 1024 + 1), '{}', 'null']) {
    const f = fixture(); f.provider(async () => new Response(body));
    assert.ok((await f.authorize()).error); assert.equal(f.db.records.get(PATH).connection, undefined);
    assert.equal(f.db.records.get(PATH).credentials, undefined);
  }
});
