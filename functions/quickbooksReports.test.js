'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createConnectionService, seal, open, hash, RETURN, CALLBACK } = require('./quickbooksConnectionService');
const { createReportsService, REALM } = require('./quickbooksReportsService');
const { normalizeReport, reportValidationIssue, VALIDATION_ISSUES } = require('./quickbooksReportsFormat');
const { createReportsHttpHandler } = require('./quickbooksReportsHttp');
const PATH = 'integrationPrivate/quickbooksProduction';
const config = { enabled: true, ownerUid: 'owner', clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  encryptionKey: Buffer.alloc(32, 11).toString('base64'), realmId: REALM, redirectUri: CALLBACK, returnUrl: RETURN };
const configId = hash(JSON.stringify([config.realmId, config.ownerUid, config.clientId, config.clientSecret, config.encryptionKey, config.redirectUri, config.returnUrl]));
const input = { report: 'ProfitAndLoss', startDate: '2026-10-01', endDate: '2026-10-13', basis: 'Accrual' };
const row = values => values.map(value => ({ value }));
function reportData(request = input) {
  return { Header: { ReportName: request.report, Currency: 'AWG', ReportBasis: request.basis, StartPeriod: request.startDate,
    EndPeriod: request.endDate, Time: '2026-10-13T18:00:00-04:00', Option: [{ Name: 'NoReportData', Value: 'false' }] },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: { Row: [{ type: 'Section', Header: { ColData: row(['Income', '']) }, Rows: { Row: [
    { type: 'Data', ColData: row(['Synthetic service', '1234.50']) },
  ] }, Summary: { ColData: row(['Total Income', '1234.50']) } }] } };
}
function fixture({ expired = false, patch = {} } = {}) {
  let time = Date.parse('2026-10-13T22:00:00Z');
  const db = new ReferenceDb({ 'users/owner': { active: true, role: 'owner' }, 'users/admin': { active: true, role: 'admin' },
    'users/finance': { active: true, role: 'accounting' }, [PATH]: { configId,
      credentials: seal({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', accessExpiresAt: time + (expired ? -1 : 3600000) }, config),
      attempt: { status: 'completed' }, connection: { realmId: REALM, version: 'version-one', companyName: 'Synthetic company', connectedAt: '2026-10-13T22:00:00Z' }, ...patch } });
  const transact = db.runTransaction.bind(db); let queue = Promise.resolve();
  db.runTransaction = fn => { const result = queue.then(() => transact(fn)); queue = result.catch(() => {}); return result; };
  const calls = []; const logs = [];
  let provider = async url => Response.json(url.includes('/tokens/')
    ? { access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', token_type: 'bearer', expires_in: 3600 }
    : reportData({ ...input, report: new URL(url).pathname.split('/').at(-1) }));
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return provider(url, options); };
  const now = () => time;
  const service = createConnectionService({ db, config, fetchImpl, now });
  const reports = createReportsService({ db, config, fetchImpl, now, requireOwner: service.requireOwner });
  const handler = createReportsHttpHandler({ db, getConfig: () => config, fetchImpl, now,
    verifyIdToken: async token => { if (token === 'revoked') throw Error('private'); return { uid: token }; }, log: data => logs.push(data) });
  async function http(uid = 'owner', body = input, origin = 'https://demac-aruba.com', method = 'POST') {
    const res = response(); await handler({ method, path: '/', body, get: key => ({ origin, authorization: uid ? `Bearer ${uid}` : '', 'content-type': 'application/json' })[key] }, res); return res;
  }
  return { db, calls, logs, service, reports, http, now, advance: ms => { time += ms; }, provider: fn => { provider = fn; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('four fixed production GET reports preserve original amounts without persisting contents or exposing credentials', async () => {
  const f = fixture();
  for (const report of ['ProfitAndLoss', 'BalanceSheet', 'AgedReceivables', 'AgedPayables']) {
    const result = await f.reports.report('owner', { ...input, report });
    assert.equal(result.environment, 'production'); assert.equal(result.accountingWritesEnabled, false); assert.equal(result.syncEnabled, false);
    assert.equal(result.report.rows.at(-1).values[1], '1234.50'); assert.equal(result.report.currency, 'AWG');
    const { url, options } = f.calls.at(-1); const u = new URL(url);
    assert.equal(u.origin, 'https://quickbooks.api.intuit.com'); assert.equal(u.pathname, `/v3/company/${REALM}/reports/${report}`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.equal(u.searchParams.get(report.startsWith('Aged') ? 'report_date' : 'end_date'), input.endDate);
    assert.equal(u.searchParams.has('start_date'), report === 'ProfitAndLoss');
    assert.equal(u.searchParams.get('aging_method'), report.startsWith('Aged') ? 'Report_Date' : null);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-access|synthetic-refresh|ciphertext/); f.advance(5000);
  }
  assert.equal(f.calls.length, 4); assert.doesNotMatch(JSON.stringify([...f.db.records]), /1234.50|Synthetic service|synthetic-access/);
});
test('HTTP authenticates revoked sessions, exact owner, fresh active role, CORS and no-store; GET never reads provider', async () => {
  const f = fixture();
  for (const uid of ['', 'revoked']) assert.equal((await f.http(uid)).statusCode, 401);
  for (const uid of ['finance', 'admin', 'unknown']) assert.equal((await f.http(uid)).statusCode, 403);
  assert.equal((await f.http('owner', input, 'https://evil.example')).statusCode, 403);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await f.http('owner', input, undefined, method)).statusCode, 405);
  assert.equal((await f.http('owner', input, undefined, 'OPTIONS')).statusCode, 204);
  f.db.records.set('users/owner', { active: false, role: 'owner' }); assert.equal((await f.http()).statusCode, 403); assert.equal(f.calls.length, 0);
  f.db.records.set('users/owner', { active: true, role: 'owner' });
  const res = await f.http(); assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.doesNotMatch(JSON.stringify(f.logs), /private|synthetic/);
});
test('arbitrary entities, injection, dates, >183-day windows and mixed company/configuration are denied before provider access', async () => {
  for (const patch of [{ report: 'Invoice' }, { report: '__proto__' }, { startDate: '2026-02-30' }, { endDate: 'bad' },
    { startDate: '2027-01-01' }, { startDate: '2026-01-01' }, { basis: 'invented' }, { realmId: 'other' },
    { url: 'https://evil.example' }, { query: 'select * from Invoice' }, { report: 'AgedReceivables', basis: 'Cash' }, { report: 'AgedPayables', basis: 'Cash' }, { action: 'start' }]) {
    const f = fixture(); assert.equal((await f.http('owner', { ...input, ...patch })).statusCode, 400); assert.equal(f.calls.length, 0);
  }
  for (const patch of [{ connection: { realmId: 'another-company' } }, { credentials: null }, { configId: 'different' }, { disconnect: { state: 'pending' } }, { attempt: { status: 'started', expiresAt: 1 } }]) {
    const f = fixture({ patch }); assert.equal((await f.http()).statusCode, 409); assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  for (const change of [{ enabled: false }, { realmId: '9341458478454738' }, { realmId: '1234567890123456' }]) {
    await assert.rejects(createReportsService({ db: f.db, config: { ...config, ...change }, requireOwner: f.service.requireOwner }).report('owner', input), { safeCode: 'not-configured' });
  }
});
test('expiry refresh rotates once and persists latest encrypted credentials before report GET', async () => {
  const f = fixture({ expired: true }); await f.reports.report('owner', input);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(f.calls[0].options.body).get('grant_type'), 'refresh_token');
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer synthetic-new-access');
  const record = f.db.records.get(PATH); assert.equal(open(record.credentials, config).refreshToken, 'synthetic-new-refresh');
  assert.equal(record.reportRecoveryDigest, null); assert.equal(record.operation, null);
});
test('reports, existing OAuth start and disconnect share the lease; uncertain refresh is never replayed', async () => {
  const f = fixture({ expired: true }); const entered = deferred(); const release = deferred();
  f.provider(async url => { if (!url.includes('/tokens/')) return Response.json(reportData());
    entered.resolve(); await release.promise; throw Error('private-provider-error'); });
  const first = f.reports.report('owner', input); const rejected = assert.rejects(first, { safeCode: 'reauthorization-required' }); await entered.promise;
  await assert.rejects(f.reports.report('owner', input), { safeCode: 'report-busy' });
  await assert.rejects(f.service.start('owner', hash('proof')), { safeCode: 'connection-busy' });
  const record = f.db.records.get(PATH); record.connection.version = Buffer.alloc(32, 2).toString('base64url');
  await assert.rejects(f.service.disconnect('owner', record.connection.version), { safeCode: 'connection-busy' });
  release.resolve(); await rejected;
  f.advance(100000); await assert.rejects(f.reports.report('owner', input), { safeCode: 'reauthorization-required' }); assert.equal(f.calls.length, 1);
});
test('role revoked during refresh still retains new credentials but never fetches or delivers financial data', async () => {
  const f = fixture({ expired: true });
  f.provider(async () => { f.db.records.set('users/owner', { active: false, role: 'owner' }); return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', token_type: 'bearer', expires_in: 3600 }); });
  await assert.rejects(f.reports.report('owner', input), { safeCode: 'owner-required' });
  assert.equal(open(f.db.records.get(PATH).credentials, config).refreshToken, 'rotated-refresh'); assert.equal(f.calls.length, 1);
});
test('role revoked while report returns denies delivery; provider errors do not appear in logs', async () => {
  const f = fixture(); f.provider(async () => { f.db.records.set('users/owner', { active: false, role: 'owner' }); return Response.json(reportData()); });
  assert.equal((await f.http()).statusCode, 403);
  const g = fixture(); g.provider(async () => new Response('sensitive-provider-body', { status: 500 })); assert.equal((await g.http()).statusCode, 502);
  assert.doesNotMatch(JSON.stringify(g.logs), /sensitive-provider/);
});
test('killed refresh marker blocks old credential, reconnect through existing lifecycle restores access', async () => {
  const f = fixture(); const record = f.db.records.get(PATH);
  record.reportRecoveryDigest = hash(JSON.stringify(record.credentials)); record.operation = { expiresAt: 1, refreshing: true };
  await assert.rejects(f.reports.report('owner', input), { safeCode: 'reauthorization-required' });
  const proof = Buffer.alloc(32, 4).toString('base64url'); const started = await f.service.start('owner', hash(proof));
  f.provider(async url => Response.json(url.includes('/tokens/') ? { access_token: 'replacement-access', refresh_token: 'replacement-refresh', token_type: 'bearer', expires_in: 3600 } : { CompanyInfo: { Id: '1', CompanyName: 'Synthetic renewed', Country: 'AW' } }));
  const { ticket } = await f.service.callback({ state: new URL(started.authorizationUrl).searchParams.get('state'), realmId: REALM, code: 'synthetic' });
  await f.service.finish('owner', ticket, proof); f.provider(async () => Response.json(reportData()));
  assert.equal((await f.reports.report('owner', input)).companyName, 'Synthetic renewed');
});
test('changed credentials or expired invocation lease cannot overwrite newer state or deliver data', async () => {
  for (const kind of ['credentials', 'timeout']) {
    const f = fixture(); f.provider(async () => { if (kind === 'timeout') f.advance(91000); else f.db.records.set(PATH, { ...f.db.records.get(PATH), credentials: seal({ accessToken: 'new', refreshToken: 'new', accessExpiresAt: f.now() + 3600000 }, config), operation: null }); return Response.json(reportData()); });
    await assert.rejects(f.reports.report('owner', input), { safeCode: 'report-busy' });
    if (kind === 'credentials') assert.equal(open(f.db.records.get(PATH).credentials, config).refreshToken, 'new');
  }
});
test('report response is strictly bounded, validates identity/period/basis, retains empty strings and rejects silent truncation', async () => {
  for (const mutate of [d => { d.Header.ReportName = 'Other'; }, d => { d.Header.EndPeriod = '2020-01-01'; }, d => { d.Header.Currency = ''; },
    d => { d.Header.ReportBasis = 'Cash'; }, d => { d.Rows.Row[0].Rows.Row[0].ColData.pop(); }, d => { d.Columns.Column[0].Columns = {}; },
    d => { d.Rows.Row = Array.from({ length: 2001 }, () => ({ type: 'Data', ColData: row(['X', '1']) })); }]) {
    const data = reportData(); mutate(data); assert.throws(() => normalizeReport(data, input), { safeCode: 'invalid-report-response' });
  }
  const empty = reportData(); empty.Header.Option[0].Value = 'true'; empty.Rows = {}; assert.equal(normalizeReport(empty, input).noData, true);
  const valid = normalizeReport(reportData(), input); assert.equal(valid.rows[0].values[1], '');
  const f = fixture(); f.provider(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))); assert.equal((await f.http()).body.error, 'report-too-large');
});
test('429 allows a later explicit retry; 401 forces fresh authorization without an automatic replay', async () => {
  for (const code of [429, 401]) {
    const f = fixture(); f.provider(async () => new Response('private', { status: code }));
    assert.equal((await f.http()).body.error, code === 401 ? 'reauthorization-required' : 'provider-rate-limited');
    f.advance(6000); f.provider(async () => Response.json(reportData()));
    assert.equal((await f.http()).statusCode, code === 401 ? 409 : 200);
    assert.equal(f.calls.length, code === 401 ? 1 : 2);
  }
});

test('documented A/P rows without type and without ReportBasis preserve leaf/summary structure', () => {
  const request = { ...input, report: 'AgedPayables' }; const data = reportData(request);
  delete data.Header.ReportBasis; delete data.Rows.Row[0].type; delete data.Rows.Row[0].Rows.Row[0].type;
  const result = normalizeReport(data, request); assert.equal(result.basis, null);
  assert.deepEqual(result.rows.map(r => r.kind), ['heading', 'data', 'total']);
  assert.equal(result.rows.at(-1).values[1], '1234.50');
});

test('safe report diagnostics distinguish header/shape checks without exposing provider values', async () => {
  for (const [issue, mutate] of [
    ['header_name', data => { data.Header.ReportName = 'private-company-value'; }],
    ['header_currency', data => { data.Header.Currency = 'private-currency-value'; }],
    ['header_end_period', data => { data.Header.EndPeriod = '2026-09-30'; }],
    ['header_start_period', data => { data.Header.StartPeriod = '2026-09-01'; }],
    ['header_basis', data => { data.Header.ReportBasis = 'Cash'; }],
    ['columns', data => { data.Columns.Column = []; }],
    ['column_shape', data => { data.Columns.Column[0] = null; }],
    ['cell_count', data => { data.Rows.Row[0].Header.ColData.pop(); }],
    ['cell_value', data => { data.Rows.Row[0].Header.ColData[0].value = { secret: 'private' }; }],
    ['row_shape', data => { data.Rows.Row[0] = null; }],
    ['row_type', data => { data.Rows.Row[0].type = 'private-type'; }],
    ['header_options', data => { data.Header.Option = [null]; }],
    ['no_report_data', data => { data.Header.Option[0].Value = 'private'; }],
    ['missing_rows', data => { delete data.Rows; }],
    ['empty_rows', data => { data.Rows.Row = []; }],
  ]) {
    const data = reportData(); mutate(data);
    const f = fixture(); f.provider(async () => Response.json(data));
    const res = await f.http(); assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: 'invalid-report-response', validationIssue: issue });
    assert.deepEqual(f.logs, [{ code: 'invalid-report-response', status: 502, validationIssue: issue }]);
    assert.doesNotMatch(JSON.stringify([res.body, f.logs, [...f.db.records]]), /private-company-value|private-currency-value|private-type|1234.50|Synthetic service/);
  }
});
test('diagnostics reject arbitrary classification text and retain authorization boundaries', async () => {
  assert.equal(new Set(VALIDATION_ISSUES).size, VALIDATION_ISSUES.length);
  for (const value of ['private-value', '__proto__', {}, null]) assert.equal(reportValidationIssue({ safeCode: 'invalid-report-response', validationIssue: value }), undefined);
  assert.equal(reportValidationIssue({ safeCode: 'owner-required', validationIssue: 'header_name' }), undefined);
  const f = fixture(); f.provider(async () => Response.json({ Header: 'private' }));
  for (const uid of ['', 'revoked', 'finance']) { const r = await f.http(uid); assert.equal(r.body.validationIssue, undefined); }
  assert.equal(f.calls.length, 0);
});
