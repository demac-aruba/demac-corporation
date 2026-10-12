'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createSandboxService, sealTokens, hash } = require('./quickbooksSandboxService');
const { createSandboxReports, normalizeReport, openTokens } = require('./quickbooksSandboxReports');
const { createSandboxHttpHandler } = require('./quickbooksSandboxHttp');
const PATH = 'integrationPrivate/quickbooksSandbox';
const config = { enabled: true, clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  encryptionKey: Buffer.alloc(32, 11).toString('base64'), realmId: '1234567890123456',
  redirectUri: 'https://us-central1-demo-demac.cloudfunctions.net/quickbooksSandbox/callback', returnUrl: 'https://erp.example.test/integrations/' };
const input = { action: 'report', report: 'ProfitAndLoss', startDate: '2026-10-01', endDate: '2026-10-12', basis: 'Accrual' };
const row = values => values.map(value => ({ value }));
function reportData(request = input) {
  return { Header: { ReportName: request.report, Currency: 'USD', ReportBasis: request.basis, StartPeriod: request.startDate,
    EndPeriod: request.endDate, Time: '2026-10-12T18:00:00-04:00', Option: [{ Name: 'NoReportData', Value: 'false' }] },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: { Row: [{ type: 'Section', Header: { ColData: row(['Income', '']) }, Rows: { Row: [
    { type: 'Data', ColData: row(['Synthetic service', '1234.50']) },
  ] }, Summary: { ColData: row(['Total Income', '1234.50']) } }] } };
}
function fixture({ expired = false, patch = {} } = {}) {
  let time = Date.parse('2026-10-12T22:00:00Z');
  const db = new ReferenceDb({ 'users/owner': { active: true, role: 'owner' }, 'users/finance': { active: true, role: 'accounting' },
    [PATH]: { credentials: sealTokens({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', accessExpiresAt: time + (expired ? -1 : 3600000) }, config.encryptionKey, config.realmId),
      connection: { realmId: config.realmId, companyName: 'Synthetic test company', connectedAt: '2026-10-12T22:00:00Z' }, ...patch } });
  const transact = db.runTransaction.bind(db); let queue = Promise.resolve();
  db.runTransaction = fn => { const result = queue.then(() => transact(fn)); queue = result.catch(() => {}); return result; };
  const calls = []; const logs = [];
  let provider = async url => Response.json(url.includes('/tokens/')
    ? { access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', token_type: 'bearer', expires_in: 3600 }
    : reportData({ ...input, report: new URL(url).pathname.split('/').at(-1) }));
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return provider(url, options); };
  const now = () => time;
  const service = createSandboxService({ db, config, fetchImpl, now });
  const reports = createSandboxReports({ db, config, fetchImpl, now, requireAdmin: service.requireAdmin });
  const handler = createSandboxHttpHandler({ db, getConfig: () => config, fetchImpl, now,
    verifyIdToken: async token => { if (token === 'revoked') throw Error('private'); return { uid: token }; }, log: data => logs.push(data) });
  async function http(uid = 'owner', body = input, origin = 'https://erp.example.test') {
    const res = response();
    await handler({ method: 'POST', path: '/', body, get: key => ({ origin, authorization: uid ? `Bearer ${uid}` : '', 'content-type': 'application/json' })[key] }, res);
    return res;
  }
  return { db, calls, logs, service, reports, http, now, advance: ms => { time += ms; }, provider: fn => { provider = fn; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('three allowlisted reports use only fixed sandbox GETs and preserve provider totals without persisting report contents', async () => {
  const f = fixture();
  for (const report of ['ProfitAndLoss', 'BalanceSheet', 'AgedReceivables']) {
    const result = await f.reports.report('owner', { ...input, report });
    assert.equal(result.environment, 'sandbox'); assert.equal(result.syncEnabled, false);
    assert.equal(result.report.rows.at(-1).values[1], '1234.50');
    assert.equal(result.report.rows[1].depth, 1); assert.equal(result.report.currency, 'USD');
    const { url, options } = f.calls.at(-1); const u = new URL(url);
    assert.equal(u.origin, 'https://sandbox-quickbooks.api.intuit.com');
    assert.equal(u.pathname, `/v3/company/${config.realmId}/reports/${report}`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.equal(u.searchParams.get(report === 'AgedReceivables' ? 'report_date' : 'end_date'), input.endDate);
    assert.equal(u.searchParams.has('start_date'), report === 'ProfitAndLoss');
    assert.doesNotMatch(JSON.stringify(result), /synthetic-access|synthetic-refresh|ciphertext/);
    f.advance(5000);
  }
  assert.equal(f.calls.length, 3);
  assert.doesNotMatch(JSON.stringify([...f.db.records]), /1234.50|Synthetic service|synthetic-access/);
  assert.equal([...f.db.records.keys()].filter(key => key.includes('/audit/')).length, 3);
});

test('report HTTP preserves authentication, active role, CORS, no-store and redacted error boundaries', async () => {
  const f = fixture();
  for (const uid of ['', 'revoked']) assert.equal((await f.http(uid)).statusCode, 401);
  for (const uid of ['finance', 'unknown']) assert.equal((await f.http(uid)).statusCode, 403);
  assert.equal((await f.http('owner', input, 'https://evil.example')).statusCode, 403);
  f.db.records.set('users/owner', { active: false, role: 'owner' });
  assert.equal((await f.http()).statusCode, 403); assert.equal(f.calls.length, 0);
  f.db.records.set('users/owner', { active: true, role: 'owner' });
  const response = await f.http(); assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.doesNotMatch(JSON.stringify(f.logs), /private|synthetic/);
});

test('invalid report names, dates, range, basis and injected tenant/URL/query fields fail before provider access', async () => {
  for (const patch of [{ report: 'Invoice' }, { report: '__proto__' }, { startDate: '2026-02-30' }, { endDate: 'bad' },
    { startDate: '2027-01-01' }, { startDate: '2020-01-01' }, { basis: 'invented' }, { realmId: 'other' },
    { url: 'https://quickbooks.api.intuit.com' }, { query: 'select * from Invoice' }, { report: 'AgedReceivables', basis: 'Cash' }]) {
    const f = fixture(); assert.equal((await f.http('owner', { ...input, ...patch })).statusCode, 400); assert.equal(f.calls.length, 0);
  }
  for (const patch of [{ connection: { realmId: 'another-company' } }, { credentials: null }, { reauthorizationRequired: true }, { credentialConfigId: 'other-app' }]) {
    const f = fixture({ patch }); assert.equal((await f.http()).statusCode, 409); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); const denied = createSandboxReports({ db: f.db, config: { ...config, enabled: false }, requireAdmin: f.service.requireAdmin });
  await assert.rejects(denied.report('owner', input), { safeCode: 'not-configured' });
});

test('expired tokens rotate once, newest credentials persist encrypted, and subsequent GET uses renewed access', async () => {
  const f = fixture({ expired: true }); await f.reports.report('owner', input);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(f.calls[0].options.body).get('grant_type'), 'refresh_token');
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer synthetic-new-access');
  const record = f.db.records.get(PATH); const tokens = openTokens(record.credentials, config);
  assert.equal(tokens.refreshToken, 'synthetic-new-refresh'); assert.equal(tokens.accessExpiresAt, f.now() + 3600000);
  assert.doesNotMatch(JSON.stringify(record), /synthetic-new/);
  f.advance(5000); await f.reports.report('owner', input); assert.equal(f.calls.length, 3);
});

test('overlapping reads and OAuth starts cannot race a token refresh', async () => {
  const f = fixture({ expired: true }); const entered = deferred(); const release = deferred();
  f.provider(async url => {
    if (!url.includes('/tokens/')) return Response.json(reportData());
    entered.resolve(); await release.promise;
    return Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', token_type: 'bearer', expires_in: 3600 });
  });
  const first = f.reports.report('owner', input); await entered.promise;
  await assert.rejects(f.reports.report('owner', input), { safeCode: 'report-busy' });
  await assert.rejects(f.service.start('owner', hash('proof')), { safeCode: 'report-busy' });
  release.resolve(); await first; assert.equal(f.calls.filter(call => call.url.includes('/tokens/')).length, 1);
});

test('uncertain refresh failures require reconnect and are never retried with old credentials', async () => {
  for (const provider of [async () => { throw Error('secret-server-body'); }, async () => new Response('private-body', { status: 400 }),
    async () => Response.json({ access_token: 'bad' }), async () => new Response('{malformed')]) {
    const f = fixture({ expired: true }); f.provider(provider);
    assert.equal((await f.http()).body.error, 'reauthorization-required');
    assert.equal(f.db.records.get(PATH).reauthorizationRequired, true);
    f.advance(100000); assert.equal((await f.http()).body.error, 'reauthorization-required');
    assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(f.logs), /secret-server|private-body/);
  }
  const stale = fixture({ patch: { reportOperation: { expiresAt: 1, refreshing: true } } });
  assert.equal((await stale.http()).body.error, 'reauthorization-required'); assert.equal(stale.calls.length, 0);
});

test('fresh OAuth reconnect clears uncertain refresh marker and binds credentials to current configuration', async () => {
  const f = fixture({ patch: { reauthorizationRequired: true, credentialConfigId: 'stale', reportOperation: { expiresAt: 1, refreshing: true } } });
  const proof = Buffer.alloc(32, 7).toString('base64url');
  const start = await f.service.start('owner', hash(proof));
  f.provider(async url => Response.json(url.includes('/tokens/')
    ? { access_token: 'replacement', refresh_token: 'replacement-refresh', token_type: 'bearer', expires_in: 3600 }
    : { CompanyInfo: { Id: '1', CompanyName: 'Synthetic renewed' } }));
  const { ticket } = await f.service.callback({ state: new URL(start.authorizationUrl).searchParams.get('state'), code: 'synthetic', realmId: config.realmId });
  await f.service.finish('owner', ticket, proof);
  assert.equal(f.db.records.get(PATH).reauthorizationRequired, false); assert.equal(f.db.records.get(PATH).reportOperation, null);
  f.provider(async () => Response.json(reportData())); await f.reports.report('owner', input);
});

test('revocation during rotation persists new credentials but prevents financial GET and disclosure', async () => {
  const f = fixture({ expired: true });
  f.provider(async () => {
    f.db.records.set('users/owner', { role: 'owner', active: false });
    return Response.json({ access_token: 'saved-access', refresh_token: 'saved-refresh', token_type: 'bearer', expires_in: 3600 });
  });
  assert.equal((await f.http()).statusCode, 403); assert.equal(f.calls.length, 1);
  assert.equal(openTokens(f.db.records.get(PATH).credentials, config).refreshToken, 'saved-refresh');
  assert.equal(f.db.records.get(PATH).reauthorizationRequired, false);
});

test('late refresh cannot overwrite a newer grant or clear its state', async () => {
  const f = fixture({ expired: true }); const replacement = { credentials: { version: 'newer' }, connection: { realmId: config.realmId }, reportOperation: null };
  f.provider(async () => {
    f.db.records.set(PATH, replacement);
    return Response.json({ access_token: 'late', refresh_token: 'late-refresh', token_type: 'bearer', expires_in: 3600 });
  });
  assert.equal((await f.http()).statusCode, 409); assert.deepEqual(f.db.records.get(PATH), replacement); assert.equal(f.calls.length, 1);
});

test('report failure can be retried, but denied/expired grants require reauthorization; revoked actor receives no report', async () => {
  const f = fixture(); f.provider(async () => new Response('private', { status: 503 }));
  assert.equal((await f.http()).statusCode, 502); assert.equal(f.db.records.get(PATH).reauthorizationRequired, false);
  f.advance(5000); f.provider(async () => Response.json(reportData())); assert.equal((await f.http()).statusCode, 200);
  assert.equal((await f.http()).statusCode, 429);
  f.advance(5000); f.provider(async () => new Response('private', { status: 401 }));
  assert.equal((await f.http()).body.error, 'reauthorization-required');
  const revoked = fixture(); revoked.provider(async () => {
    revoked.db.records.set('users/owner', { role: 'owner', active: false }); return Response.json(reportData());
  });
  const denied = await revoked.http(); assert.equal(denied.statusCode, 403); assert.equal(denied.body.report, undefined);
});

test('malformed, mismatched, truncated and oversized reports never turn into fabricated zero balances', async () => {
  for (const mutate of [data => { data.Header.EndPeriod = '2026-01-01'; }, data => { data.Header.Currency = ''; },
    data => { data.Header.ReportBasis = 'Cash'; }, data => { data.Header.ReportName = 'BalanceSheet'; },
    data => { data.Rows.Row[0].Summary.ColData.pop(); }, data => { delete data.Rows; },
    data => { data.Rows.Row[0].Rows.Row[0].type = 'Unknown'; }, data => { data.Columns.Column[0].Columns = {}; }]) {
    const data = reportData(); mutate(data); assert.throws(() => normalizeReport(data, input), { safeCode: 'invalid-report-response' });
  }
  const noData = reportData(); delete noData.Rows; noData.Header.Option[0].Value = 'true';
  assert.equal(normalizeReport(noData, input).noData, true); assert.deepEqual(normalizeReport(noData, input).rows, []);
  const f = fixture(); f.provider(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  assert.equal((await f.http()).body.error, 'report-too-large'); assert.equal(f.db.records.get(PATH).reportOperation, null);
});
