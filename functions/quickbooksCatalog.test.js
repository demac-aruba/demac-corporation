'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createConnectionService, seal, open, hash, RETURN, CALLBACK } = require('./quickbooksConnectionService');
const { createReportsService, REALM } = require('./quickbooksReportsService');
const { createReportsHttpHandler } = require('./quickbooksReportsHttp');
const { catalogInput, normalizeCatalog } = require('./quickbooksCatalogFormat');
const PATH = 'integrationPrivate/quickbooksProduction';
const input = { entity: 'Customer', startPosition: 1 };
const customer = { Id: '1', DisplayName: 'Synthetic customer', Active: true, CurrencyRef: { value: 'AWG' }, Job: false,
  PrimaryEmailAddr: { Address: 'synthetic@example.test' }, Balance: 135, Notes: 'private discarded field' };
const page = (entity = 'Customer', rows = [customer], start = 1) => ({ QueryResponse: { [entity]: structuredClone(rows), startPosition: start, maxResults: rows.length } });
function fixture({ expired = false, enabled = true } = {}) {
  let time = Date.parse('2026-10-14T12:00:00Z');
  const config = { enabled: true, catalogEnabled: enabled, ownerUid: 'owner', realmId: REALM,
    clientId: 'synthetic-client', clientSecret: 'synthetic-secret', encryptionKey: Buffer.alloc(32, 11).toString('base64'), redirectUri: CALLBACK, returnUrl: RETURN };
  const configId = hash(JSON.stringify([config.realmId, config.ownerUid, config.clientId, config.clientSecret, config.encryptionKey, config.redirectUri, config.returnUrl]));
  const db = new ReferenceDb({ 'users/owner': { active: true, role: 'owner' }, 'users/other': { active: true, role: 'admin' },
    [PATH]: { configId, credentials: seal({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', accessExpiresAt: time + (expired ? -1 : 3600000) }, config),
      attempt: { status: 'completed' }, connection: { realmId: REALM, version: 'one', companyName: 'Synthetic company' } } });
  const transact = db.runTransaction.bind(db); let queue = Promise.resolve();
  db.runTransaction = fn => { const result = queue.then(() => transact(fn)); queue = result.catch(() => {}); return result; };
  const calls = []; const logs = []; let provider = async () => Response.json(page());
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return provider(url, options); };
  const now = () => time;
  const connection = createConnectionService({ db, config, now, fetchImpl });
  const service = createReportsService({ db, config, now, fetchImpl, requireOwner: connection.requireOwner });
  const handler = createReportsHttpHandler({ db, getConfig: () => config, now, fetchImpl,
    verifyIdToken: async token => { if (token === 'revoked') throw Error('private token'); return { uid: token }; }, log: entry => logs.push(entry) });
  async function http({ body = input, uid = 'owner', method = 'POST', path = '/catalog', origin = new URL(RETURN).origin, size = 100 } = {}) {
    const res = response(); await handler({ method, path, body, rawBody: { length: size }, get: key =>
      ({ origin, authorization: uid ? `Bearer ${uid}` : '', 'content-type': 'application/json' })[key] }, res); return res;
  }
  return { config, db, calls, logs, service, connection, http, now, advance: ms => { time += ms; }, provider: fn => { provider = fn; } };
}
test('fixed customer/item/account GETs project only identity/configuration and audit metadata', async () => {
  const f = fixture();
  for (const [entity, row] of [['Customer', customer], ['Item', { Id: '2', Name: 'Synthetic service', Active: false, Type: 'Service', Sku: 'DEMO', UnitPrice: 135 }],
    ['Account', { Id: '3', Name: 'Synthetic income', Active: true, AccountType: 'Income', CurrentBalance: 600 }]]) {
    f.provider(async () => Response.json(page(entity, [row])));
    const result = await f.service.catalog('owner', { entity, startPosition: 1 });
    assert.equal(result.accountingWritesEnabled, false); assert.equal(result.syncEnabled, false); assert.equal(result.catalog.records[0].id, row.Id);
    assert.doesNotMatch(JSON.stringify(result), /Balance|UnitPrice|Notes|synthetic-access|synthetic-secret|private discarded/);
    const call = f.calls.at(-1); const url = new URL(call.url);
    assert.equal(url.origin, 'https://quickbooks.api.intuit.com'); assert.equal(url.pathname, `/v3/company/${REALM}/query`);
    assert.equal(url.searchParams.get('query'), `SELECT * FROM ${entity} WHERE Active IN (true, false) ORDERBY Id STARTPOSITION 1 MAXRESULTS 100`);
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.body, undefined); assert.equal(call.options.redirect, 'error');
    f.advance(5000);
  }
  assert.doesNotMatch(JSON.stringify([...f.db.records]), /Synthetic customer|Synthetic service|Synthetic income|synthetic@example|private discarded/);
});
test('HTTP owner, revoked session, disabled flag, origins, route/method and payload size fail before provider reads', async () => {
  const f = fixture();
  for (const [options, status] of [[{ uid: '' }, 401], [{ uid: 'revoked' }, 401], [{ uid: 'other' }, 403], [{ method: 'GET' }, 405],
    [{ method: 'DELETE' }, 405], [{ path: '/catalog/Customer' }, 404], [{ origin: 'https://evil.example' }, 403], [{ size: 9000 }, 400]]) {
    assert.equal((await f.http(options)).statusCode, status);
  }
  f.db.records.set('users/owner', { active: false, role: 'owner' }); assert.equal((await f.http()).statusCode, 403);
  assert.equal(f.calls.length, 0);
  const disabled = fixture({ enabled: false }); assert.equal((await disabled.http()).body.error, 'catalog-not-configured'); assert.equal(disabled.calls.length, 0);
  const ok = await fixture().http(); assert.equal(ok.statusCode, 200); assert.equal(ok.headers['Cache-Control'], 'private, no-store');
});
test('query injection, tenant override, unsupported entities and invalid page positions never reach Intuit', async () => {
  for (const body of [{ ...input, query: 'SELECT * FROM Invoice' }, { ...input, realmId: 'other' }, { ...input, entity: 'Invoice' },
    { ...input, entity: '__proto__' }, { ...input, entity: 'Customer DELETE' }, ...[0, -1, 2, 1.5, '1', 100001, NaN].map(startPosition => ({ ...input, startPosition }))]) {
    assert.throws(() => catalogInput(body)); const f = fixture(); assert.equal((await f.http({ body })).statusCode, 400); assert.equal(f.calls.length, 0);
  }
});
test('pagination accepts empty endings, proves no silent full-page completion and rejects inconsistent/duplicate rows', () => {
  assert.equal(normalizeCatalog({ QueryResponse: {} }, input).endOfCurrentQuery, true);
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...customer, Id: String(i + 1) }));
  const first = normalizeCatalog(page('Customer', rows), input); assert.equal(first.nextStartPosition, 101); assert.equal(first.endOfCurrentQuery, false);
  const last = normalizeCatalog(page('Customer', rows, 99901), { ...input, startPosition: 99901 }); assert.equal(last.atLimit, true); assert.equal(last.endOfCurrentQuery, false);
  for (const mutate of [d => { d.Fault = {}; }, d => { d.QueryResponse.Item = []; }, d => { d.QueryResponse.startPosition = 101; },
    d => { d.QueryResponse.maxResults = 100; }, d => { d.QueryResponse.Customer[0].Active = 'true'; }, d => { d.QueryResponse.Customer[0].Id = ''; },
    d => { d.QueryResponse.Customer[0].PrimaryEmailAddr = 'private'; }, d => { d.QueryResponse.Customer.push(customer); d.QueryResponse.maxResults = 2; }]) {
    const data = page(); mutate(data); assert.throws(() => normalizeCatalog(data, input), { safeCode: 'invalid-catalog-response' });
  }
});
test('catalog and reports serialize with OAuth; duplicate clicks cannot start concurrent reads', async () => {
  const f = fixture(); let finish; let started;
  const entered = new Promise(resolve => { started = resolve; }); const wait = new Promise(resolve => { finish = resolve; });
  f.provider(async () => { started(); await wait; return Response.json(page()); });
  const first = f.service.catalog('owner', input); await entered;
  await assert.rejects(f.service.catalog('owner', input), { safeCode: 'report-busy' });
  await assert.rejects(f.service.report('owner', { report: 'ProfitAndLoss', startDate: '2026-10-01', endDate: '2026-10-14', basis: 'Accrual' }), { safeCode: 'report-busy' });
  await assert.rejects(f.connection.start('owner', { proofHash: 'a'.repeat(64) }));
  finish(); await first; assert.equal(f.calls.length, 1);
  await assert.rejects(f.service.catalog('owner', input), { safeCode: 'report-rate-limited' });
});
test('expired access refreshes once; uncertain rotation stops any catalog replay', async () => {
  const f = fixture({ expired: true });
  f.provider(async url => Response.json(url.includes('/tokens/') ? { access_token: 'synthetic-new', refresh_token: 'synthetic-new-refresh', token_type: 'bearer', expires_in: 3600 } : page()));
  await f.service.catalog('owner', input); assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.method, 'POST');
  assert.equal(open(f.db.records.get(PATH).credentials, f.config).refreshToken, 'synthetic-new-refresh');
  assert.equal(f.calls[1].options.method, 'GET');
  const uncertain = fixture({ expired: true }); uncertain.provider(async () => { throw Error('private provider failure'); });
  await assert.rejects(uncertain.service.catalog('owner', input), { safeCode: 'reauthorization-required' }); uncertain.advance(10000);
  await assert.rejects(uncertain.service.catalog('owner', input), { safeCode: 'reauthorization-required' }); assert.equal(uncertain.calls.length, 1);
});
test('owner revocation or connection replacement during GET prevents disclosure; malformed results/logs contain no provider text', async () => {
  for (const change of [f => f.db.records.set('users/owner', { active: false, role: 'owner' }),
    f => f.db.records.set(PATH, { ...f.db.records.get(PATH), connection: { realmId: REALM, version: 'changed' } })]) {
    const f = fixture(); f.provider(async () => { change(f); return Response.json(page()); });
    const res = await f.http(); assert.ok(res.statusCode >= 400); assert.doesNotMatch(JSON.stringify(res.body), /Synthetic customer|synthetic@example/);
  }
  const f = fixture(); f.provider(async () => Response.json({ Fault: { private: 'private provider value' } }));
  const res = await f.http(); assert.equal(res.body.error, 'invalid-catalog-response');
  assert.doesNotMatch(JSON.stringify([res.body, f.logs, [...f.db.records]]), /private provider value|Synthetic customer/);
});
