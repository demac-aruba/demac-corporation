'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createConnectionService, seal, hash, RETURN, CALLBACK } = require('./quickbooksConnectionService');
const { createLinksService, sourceRow, sourceHash, targetHash, keyFor, TTL } = require('./quickbooksLinksService');
const { createLinksHttpHandler } = require('./quickbooksLinksHttp');
const { normalizeCatalog } = require('./quickbooksCatalogFormat');
const ROOT = 'integrationPrivate/quickbooksProduction', REALM = '9130352327074466';
const customer = { Id: '10', DisplayName: 'Synthetic customer', Active: true, CurrencyRef: { value: 'AWG' }, Job: false,
  PrimaryEmailAddr: { Address: 'synthetic@example.test' }, Notes: 'private discarded notes' };
const item = { Id: '20', Name: 'Synthetic service', Active: true, Type: 'Service', Sku: 'SVC-DEMO' };
const page = (entity, row, start = 1) => ({ QueryResponse: { [entity]: [structuredClone(row)], startPosition: start, maxResults: 1 } });
function fixture() {
  let time = Date.parse('2026-10-19T13:45:00Z');
  const config = { enabled: true, catalogEnabled: true, ownerUid: 'owner', realmId: REALM,
    clientId: 'synthetic-client', clientSecret: 'synthetic-secret', encryptionKey: Buffer.alloc(32, 11).toString('base64'), redirectUri: CALLBACK, returnUrl: RETURN };
  const configId = hash(JSON.stringify([config.realmId, config.ownerUid, config.clientId, config.clientSecret, config.encryptionKey, config.redirectUri, config.returnUrl]));
  const db = new ReferenceDb({ 'users/owner': { active: true, role: 'owner' }, 'users/other': { active: true, role: 'admin' },
    'clients/erp-one': { name: 'Synthetic customer', email: 'synthetic@example.test', active: true },
    'clients/erp-two': { name: 'Second synthetic customer', active: true },
    'services/erp-item': { label: '  Synthetic   service ', active: true, sku: 'SVC-DEMO', itemType: 'Servicio' },
    [ROOT]: { configId, credentials: seal({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', accessExpiresAt: time + 3600000 }, config),
      attempt: { status: 'completed' }, connection: { realmId: REALM, version: 'one', companyName: 'Synthetic company' } } });
  const transaction = db.runTransaction.bind(db); let queue = Promise.resolve();
  db.runTransaction = fn => { const result = queue.then(() => transaction(fn)); queue = result.catch(() => {}); return result; };
  const calls = [], logs = []; let provider = async url => Response.json(new URL(url).searchParams.get('query').includes('FROM Item') ? page('Item', item) : page('Customer', customer));
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return provider(url, options); };
  const now = () => time, { requireOwner } = createConnectionService({ db, config, fetchImpl, now });
  const service = createLinksService({ db, config, fetchImpl, requireOwner, now });
  const handler = createLinksHttpHandler({ db, getConfig: () => config, fetchImpl, now, log: value => logs.push(value),
    verifyIdToken: async token => { if (token === 'revoked') throw Error('private token failure'); return { uid: token }; } });
  const body = (entity = 'Customer', erpId = 'erp-one', row = customer) => ({ action: 'prepare', entity, erpId, qboId: row.Id, startPosition: 1,
    expectedVersion: 0, sourceHash: sourceHash(sourceRow(entity, erpId, db.records.get((entity === 'Customer' ? 'clients/' : 'services/') + erpId))),
    targetHash: targetHash(normalizeCatalog(page(entity, row), { entity, startPosition: 1 }).records[0]) });
  const call = input => service.execute('owner', input);
  const confirm = prepared => call({ action: 'confirm', intentId: prepared.intentId, acknowledgeIdentity: true });
  const revoke = (expectedVersion = 1, requestId = '12345678-1234-1234-1234-123456789012') => call({ action: 'revoke', entity: 'Customer', erpId: 'erp-one', expectedVersion, requestId });
  const list = (erpIds = ['erp-one'], entity = 'Customer') => call({ action: 'list', entity, erpIds });
  const http = async ({ input = { action: 'list', entity: 'Customer', erpIds: ['erp-one'] }, uid = 'owner', method = 'POST', path = '/', origin = new URL(RETURN).origin, size = 100 } = {}) => {
    const res = response(); await handler({ path, method, body: input, rawBody: { length: size }, get: key => ({ origin, authorization: uid ? `Bearer ${uid}` : '', 'content-type': 'application/json' })[key] }, res); return res;
  };
  return { db, config, calls, logs, body, call, confirm, revoke, list, http, advance: ms => time += ms, provider: fn => provider = fn,
    linkPath: (entity = 'Customer', erpId = 'erp-one') => ROOT + '/catalogLinks/' + keyFor(entity, erpId) };
}
test('prepare observes canonical ERP and a fresh fixed provider page; explicit confirmation persists metadata only', async () => {
  const f = fixture(), originalClient = structuredClone(f.db.records.get('clients/erp-one'));
  assert.deepEqual((await f.list()).records[0], { entity: 'Customer', erpId: 'erp-one', status: 'unlinked', version: 0 });
  assert.equal(f.calls.length, 0);
  const prepared = await f.call(f.body()); assert.equal(prepared.source.name, customer.DisplayName); assert.equal(prepared.target.id, customer.Id);
  assert.equal(f.db.records.has(f.linkPath()), false); assert.equal(prepared.accountingWritesEnabled, false);
  const saved = await f.confirm(prepared); assert.equal(saved.link.status, 'confirmed'); assert.equal(saved.link.version, 1); assert.equal(saved.link.needsReview, false);
  assert.equal((await f.list()).records[0].qboId, '10'); assert.deepEqual(f.db.records.get('clients/erp-one'), originalClient);
  assert.ok(f.db.records.has(f.linkPath() + '/history/1')); assert.equal(f.calls.length, 1);
  const call = f.calls[0], url = new URL(call.url);
  assert.equal(call.options.method, 'GET'); assert.equal(call.options.body, undefined); assert.equal(url.pathname, `/v3/company/${REALM}/query`);
  assert.equal(url.searchParams.get('query'), 'SELECT * FROM Customer WHERE Active IN (true, false) ORDERBY Id STARTPOSITION 1 MAXRESULTS 100');
  const metadata = [...f.db.records].filter(([key]) => key.startsWith(ROOT + '/'));
  assert.doesNotMatch(JSON.stringify([metadata, f.logs]), /Synthetic customer|Synthetic service|synthetic@example|private discarded|synthetic-access|synthetic-secret/);
});
test('duplicate confirmation and revoke replay the same version; old confirmation cannot revive a revoked link', async () => {
  const f = fixture(), prepared = await f.call(f.body());
  const results = await Promise.all([f.confirm(prepared), f.confirm(prepared)]);
  assert.deepEqual(results.map(r => r.link.version), [1, 1]); assert.equal(results[1].replayed, true);
  f.advance(TTL + 1); assert.equal((await f.confirm(prepared)).replayed, true, 'lost response can be recovered after intent expiry');
  assert.equal((await f.revoke()).link.version, 2); assert.equal((await f.revoke()).replayed, true);
  await assert.rejects(f.confirm(prepared), { safeCode: 'link-version-conflict' });
  assert.equal(f.db.records.get(f.linkPath()).status, 'revoked'); assert.ok(f.db.records.has(f.linkPath() + '/history/2'));
  assert.equal([...f.db.records.keys()].filter(key => key.includes('/catalogLinkTargets/')).length, 0);
});
test('two ERP identities cannot claim one QBO identity, including preparations made before either confirmation', async () => {
  const f = fixture(), first = await f.call(f.body()); f.advance(5100);
  const second = await f.call(f.body('Customer', 'erp-two'));
  const results = await Promise.allSettled([f.confirm(first), f.confirm(second)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.safeCode, 'link-target-conflict');
  assert.equal(f.db.records.has(f.linkPath('Customer', 'erp-two')), false);
});
test('same-source concurrent intents conflict; replacement requires revoke and fresh version', async () => {
  const f = fixture(), first = await f.call(f.body()); f.advance(5100); const second = await f.call(f.body());
  await f.confirm(first); await assert.rejects(f.confirm(second), { safeCode: 'link-version-conflict' });
  f.advance(5100); const changed = { ...customer, Id: '11' }; f.provider(async () => Response.json(page('Customer', changed)));
  await assert.rejects(f.call({ ...f.body('Customer', 'erp-one', changed), expectedVersion: 1 }), { safeCode: 'link-revoke-first' });
  await f.revoke(); const prepared = await f.call({ ...f.body('Customer', 'erp-one', changed), expectedVersion: 2 });
  assert.equal((await f.confirm(prepared)).link.version, 3); assert.equal((await f.list()).records[0].qboId, '11');
  await assert.rejects(f.revoke(), { safeCode: 'link-version-conflict' });
});
test('stale ERP/provider observations, changed connection, expiry and lost owner authorization cannot confirm', async () => {
  for (const change of [f => f.db.records.set('clients/erp-one', { name: 'Changed' }),
    f => f.db.records.delete('clients/erp-one'), f => f.db.records.set('users/owner', { active: false, role: 'owner' }),
    f => f.db.records.get(ROOT).connection.version = 'two', f => f.db.records.get(ROOT).disconnect = { version: 'one' },
    f => f.advance(TTL)]) {
    const f = fixture(), prepared = await f.call(f.body()); change(f); await assert.rejects(f.confirm(prepared)); assert.equal(f.db.records.has(f.linkPath()), false);
  }
  const f = fixture(), stale = f.body(); f.db.records.get('clients/erp-one').name = 'Changed';
  await assert.rejects(f.call(stale), { safeCode: 'link-source-changed' }); assert.equal(f.calls.length, 0);
  const g = fixture(); g.provider(async () => Response.json(page('Customer', { ...customer, DisplayName: 'Changed' })));
  await assert.rejects(g.call(g.body()), { safeCode: 'link-target-changed' });
  for (const mutate of [h => h.db.records.get('clients/erp-one').name = 'Changed during GET', h => h.db.records.get(ROOT).connection.version = 'two', h => h.db.records.get('users/owner').active = false]) {
    const h = fixture(); h.provider(async () => { mutate(h); return Response.json(page('Customer', customer)); });
    await assert.rejects(h.call(h.body())); assert.equal([...h.db.records.keys()].some(key => key.includes('/catalogLinkIntents/')), false);
  }
});
test('saved links become review-required when ERP identity changes or connection is replaced', async () => {
  const f = fixture(); await f.confirm(await f.call(f.body())); f.db.records.get('clients/erp-one').name = 'Renamed';
  assert.equal((await f.list()).records[0].needsReview, true);
  const g = fixture(); await g.confirm(await g.call(g.body())); g.db.records.get(ROOT).connection.version = 'two';
  assert.equal((await g.list()).records[0].needsReview, true);
});
test('inactive records, subcustomers and incompatible/group item types are blocked; canonical service/product matches work', async () => {
  for (const [entity, sourceId, row, code] of [['Customer', 'erp-one', { ...customer, Active: false }, 'link-inactive'],
    ['Customer', 'erp-one', { ...customer, Job: true }, 'link-customer-hierarchy'], ['Customer', 'erp-one', { ...customer, ParentRef: { value: '1' } }, 'link-customer-hierarchy'],
    ['Item', 'erp-item', { ...item, Type: 'NonInventory' }, 'link-item-type'], ['Item', 'erp-item', { ...item, Type: 'Group' }, 'link-item-type']]) {
    const f = fixture(); f.provider(async () => Response.json(page(entity, row))); await assert.rejects(f.call(f.body(entity, sourceId, row)), { safeCode: code });
  }
  const f = fixture(); const prepared = await f.call(f.body('Item', 'erp-item', item)); assert.equal(prepared.source.name, 'Synthetic service');
  assert.equal((await f.confirm(prepared)).link.status, 'confirmed');
  const g = fixture(); g.db.records.get('services/erp-item').itemType = 'Producto'; const product = { ...item, Type: 'Inventory' };
  g.provider(async () => Response.json(page('Item', product))); assert.equal((await g.confirm(await g.call(g.body('Item', 'erp-item', product)))).link.status, 'confirmed');
});
test('HTTP denies anonymous/revoked/nonowner origins and malformed payloads; logs expose closed codes only', async () => {
  const f = fixture();
  for (const [options, status] of [[{ uid: '' }, 401], [{ uid: 'other' }, 403], [{ uid: 'revoked' }, 401], [{ method: 'GET' }, 405],
    [{ path: '/unexpected' }, 404], [{ origin: 'https://untrusted.example' }, 403], [{ size: 33000 }, 400],
    [{ input: { action: 'list', entity: 'Invoice', erpIds: ['erp-one'] } }, 400]]) assert.equal((await f.http(options)).statusCode, status);
  for (const input of [{ ...f.body(), realmId: 'other' }, { ...f.body(), erpId: '../users/owner' }, { ...f.body(), startPosition: 2 },
    { action: 'confirm', intentId: 'a'.repeat(48), acknowledgeIdentity: false }, { action: '__proto__' },
    { action: 'list', entity: 'Customer', erpIds: Array(101).fill('erp-one') }, { action: 'list', entity: 'Customer', erpIds: ['erp-one', 'erp-one'] }]) assert.equal((await f.http({ input })).statusCode, 400);
  assert.equal(f.calls.length, 0); assert.equal((await f.http()).headers['Cache-Control'], 'private, no-store');
  f.config.catalogEnabled = false; assert.equal((await f.http()).body.error, 'catalog-not-configured');
  assert.doesNotMatch(JSON.stringify(f.logs), /private token|synthetic-access|Synthetic customer/);
});
test('provider uncertainty and conflicting claims fail closed; no financial source is written', async () => {
  const f = fixture(); f.provider(async () => { throw Error('private provider failure'); });
  const res = await f.http({ input: f.body() }); assert.equal(res.statusCode, 502); assert.equal(res.body.error, 'provider-unavailable');
  assert.doesNotMatch(JSON.stringify([res.body, f.logs]), /private provider/);
  assert.equal([...f.db.records.keys()].some(key => /^(appointments|payments|invoices|commercialProductStock|warehouseInventory)\//.test(key)), false);
  const g = fixture(), prepared = await g.call(g.body()); await g.confirm(prepared);
  g.db.records.set(ROOT + '/catalogLinkTargets/' + keyFor('Customer', '10'), { entity: 'Customer', erpId: 'different', qboId: '10', version: 1 });
  await assert.rejects(g.revoke(), { safeCode: 'link-target-conflict' }); assert.equal(g.db.records.get(g.linkPath()).status, 'confirmed');
});
test('overlapping preparation uses the shared read lease and writes no second intent', async () => {
  const f = fixture(); let release, entered;
  const started = new Promise(resolve => entered = resolve);
  f.provider(async () => { entered(); await new Promise(resolve => release = resolve); return Response.json(page('Customer', customer)); });
  const first = f.call(f.body()); await started;
  await assert.rejects(f.call(f.body('Customer', 'erp-two')), { safeCode: 'report-busy' });
  assert.equal(f.calls.length, 1); release(); await first;
  assert.equal([...f.db.records.keys()].filter(key => key.includes('/catalogLinkIntents/')).length, 1);
});
test('missing or corrupt active claims are never silently repaired by confirmation replay or re-verification', async () => {
  for (const corrupt of [f => f.db.records.delete(ROOT + '/catalogLinkTargets/' + keyFor('Customer', '10')),
    f => f.db.records.get(ROOT + '/catalogLinkTargets/' + keyFor('Customer', '10')).entity = 'Item']) {
    const f = fixture(), prepared = await f.call(f.body()); await f.confirm(prepared); corrupt(f); f.advance(5100);
    await assert.rejects(f.confirm(prepared));
    await assert.rejects(f.call({ ...f.body(), expectedVersion: 1 }), { safeCode: 'link-target-conflict' });
    assert.equal(f.db.records.get(f.linkPath()).version, 1); assert.equal(f.calls.length, 1);
  }
});
