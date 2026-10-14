import assert from 'node:assert/strict';
import { quickBooksLoginDestination } from '../lib/quickbooks-entry';
import { defaultAuthenticatedRoute } from '../lib/role-routing';
import type { QuickBooksConnectionStatus } from '../lib/firebase/quickbooks-connection';
import { scanCatalogs, comparisonRows, type CatalogCollection } from '../lib/quickbooks-catalog-scan';
import { suggestCatalogMatches, validateCatalogResult, type CatalogResult } from '../lib/quickbooks-catalog';
async function run() {
  for (const next of ['/quickbooks/connect/', '/quickbooks/disconnect/', '/quickbooks/compare/', '/integrations/']) {
    assert.equal(quickBooksLoginDestination(`?next=${encodeURIComponent(next)}`, 'super_admin'), next);
    assert.equal(quickBooksLoginDestination(`?next=${encodeURIComponent(next)}`, 'technician'), defaultAuthenticatedRoute('technician'));
  }
  for (const next of ['https://evil.example', '//evil.example', '/quickbooks/connect/?url=evil', '/quickbooks/connect/../evil', '/other']) {
    assert.equal(quickBooksLoginDestination(`?next=${encodeURIComponent(next)}`, 'super_admin'), defaultAuthenticatedRoute('super_admin'));
  }
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-qbo-synthetic';
  process.env.NEXT_PUBLIC_QBO_PRODUCTION_ENABLED = 'true';
  process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'false';
  const storage = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  let navigated = '';
  const location = { pathname: '/quickbooks/connect/', search: '', hash: '', assign: (url: string) => { navigated = url; } };
  Object.assign(globalThis, { sessionStorage, window: { sessionStorage, location, history: {
    state: null, replaceState: (_state: unknown, _title: string, url: string) => { assert.equal(url, location.pathname); location.hash = ''; },
  } } });
  const { persistFirebaseWebSession } = await import('../lib/firebase/session');
  const client = await import('../lib/firebase/quickbooks-connection');
  const signIn = (uid = 'owner') => persistFirebaseWebSession({ uid, email: 'synthetic@example.test', idToken: 'synthetic-firebase', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000 });
  const key = 'demac.quickbooks.production.v1'; const ticket = Buffer.alloc(32, 3).toString('base64url');
  const status: QuickBooksConnectionStatus = { configured: true, environment: 'production', phase: 'disconnected', syncEnabled: false, accountingWritesEnabled: false, connection: null, disconnectVersion: null };
  const calls: Array<{ url: string; body: Record<string, string> | null }> = [];
  let fetcher = async (_body: Record<string, string> | null) => Response.json(status);
  globalThis.fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : null; calls.push({ url: String(input), body });
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); return fetcher(body);
  };
  signIn();
  for (const flag of ['NEXT_PUBLIC_ISOLATED_PREVIEW', 'NEXT_PUBLIC_QBO_PRODUCTION_ENABLED']) {
    process.env[flag] = flag.includes('ISOLATED') ? 'true' : 'false';
    assert.equal((await client.readConnectionStatus('owner')).configured, false);
    await assert.rejects(client.startConnection('owner')); assert.equal(calls.length, 0);
    process.env[flag] = flag.includes('ISOLATED') ? 'false' : 'true';
  }
  fetcher = async () => Response.json({ authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2?state=synthetic' });
  await client.startConnection('owner'); const pending = JSON.parse(storage.get(key)!);
  assert.equal(pending.uid, 'owner'); assert.equal(pending.proof.length, 43); assert.equal(calls.at(-1)?.body?.proofHash.length, 64);
  assert.equal(calls.at(-1)?.body?.proof, undefined); assert.match(navigated, /^https:\/\/appcenter.intuit.com\/connect\/oauth2/);
  location.hash = `#qbo_production_ticket=${ticket}`; const before = calls.length;
  client.captureConnectionReturn(); assert.equal(location.hash, ''); assert.equal(calls.length, before, 'Landing never commits OAuth');
  assert.equal(client.hasPendingConnection('owner'), true); assert.equal(client.hasPendingConnection('other'), false);
  fetcher = async () => Response.json(status); await client.readConnectionStatus('owner');
  assert.equal(calls.at(-1)?.body, null, 'Normal status visit is read-only');
  let release: () => void = () => {}; const wait = new Promise<void>(resolve => { release = resolve; });
  fetcher = async () => { await wait; return Response.json(status); };
  const first = client.loadConnection('owner'); const second = client.loadConnection('owner'); release(); await Promise.all([first, second]);
  assert.equal(calls.filter(call => call.body?.action === 'finish').length, 1); assert.equal(storage.has(key), false);
  storage.set(key, JSON.stringify({ ...pending, ticket }));
  fetcher = async () => { throw Error('private-response'); };
  await assert.rejects(client.loadConnection('owner'), error => error instanceof Error && !error.message.includes('private-response'));
  assert.equal(storage.has(key), true);
  fetcher = async () => Response.json(status); await client.loadConnection('owner');
  storage.set(key, JSON.stringify({ ...pending, ticket }));
  fetcher = async () => { signIn('other'); return Response.json(status); };
  await assert.rejects(client.loadConnection('owner'), /sesión/); assert.equal(storage.has(key), true); signIn();
  fetcher = async () => Response.json({ authorizationUrl: 'https://evil.example/oauth' }); navigated = '';
  await assert.rejects(client.startConnection('owner')); assert.equal(navigated, '');
  fetcher = async body => { assert.deepEqual(body, { action: 'disconnect', version: ticket }); return Response.json({ error: 'revocation-pending' }, { status: 409 }); };
  await assert.rejects(client.disconnectConnection('owner', ticket), /no confirmó/);
  fetcher = async () => Response.json(status); await client.disconnectConnection('owner', ticket); assert.equal(storage.has(key), false);
  location.hash = `#qbo_production_ticket=${ticket}`; const count = calls.length;
  assert.throws(() => client.captureConnectionReturn()); assert.equal(calls.length, count);
  location.hash = '#qbo_production_error=authorization-cancelled'; assert.throws(() => client.captureConnectionReturn(), /Cancelaste/);
  storage.set(key, JSON.stringify({ ...pending, ticket, createdAt: Date.now() - 600001 }));
  const expiredCalls = calls.length; await assert.rejects(client.loadConnection('owner'), /venció/); assert.equal(calls.length, expiredCalls);
  const reports = await import('../lib/firebase/quickbooks-reports');
  const reportInput = { report: 'ProfitAndLoss' as const, startDate: '2026-10-01', endDate: '2026-10-13', basis: 'Accrual' as const };
  const reportResult = { environment: 'production', realmId: '9130352327074466', syncEnabled: false, accountingWritesEnabled: false,
    report: { name: 'ProfitAndLoss', endPeriod: reportInput.endDate, rows: [], columns: [] } };
  fetcher = async body => { assert.deepEqual(body, reportInput); return Response.json(reportResult); };
  await reports.readProductionReport('owner', reportInput);
  assert.match(calls.at(-1)!.url, /\/quickbooksReports$/);
  for (const patch of [{ realmId: 'wrong' }, { environment: 'sandbox' }, { accountingWritesEnabled: true }]) {
    fetcher = async () => Response.json({ ...reportResult, ...patch }); await assert.rejects(reports.readProductionReport('owner', reportInput), /verificar/);
  }
  fetcher = async () => { signIn('other'); return Response.json(reportResult); };
  await assert.rejects(reports.readProductionReport('owner', reportInput), /sesión/); signIn();
  const catalog = await import('../lib/firebase/quickbooks-catalog');
  const catalogInput = { entity: 'Customer' as const, startPosition: 1 };
  const catalogResult: CatalogResult = { environment: 'production', realmId: '9130352327074466', companyName: 'Synthetic company',
    accountingWritesEnabled: false, syncEnabled: false, fetchedAt: '2026-10-14T12:00:00Z', request: catalogInput,
    catalog: { pageSize: 100, nextStartPosition: null, atLimit: false, endOfCurrentQuery: true,
      records: [{ id: '1', name: 'Synthetic customer', active: true, email: 'synthetic@example.test', company: null, currency: 'AWG', parentId: null, isJob: false }] } };
  fetcher = async body => { assert.deepEqual(body, catalogInput); return Response.json(catalogResult); };
  await catalog.readProductionCatalog('owner', catalogInput); assert.match(calls.at(-1)!.url, /\/quickbooksReports\/catalog$/);
  for (const mutate of [
    (data: CatalogResult) => { data.realmId = 'wrong'; },
    (data: CatalogResult) => { data.request.startPosition = 101; },
    (data: CatalogResult) => { data.catalog.nextStartPosition = 101; },
    (data: CatalogResult) => { data.catalog.records.push(data.catalog.records[0]); },
    (data: CatalogResult) => { data.catalog.records[0].id = ''; },
    (data: CatalogResult) => { data.catalog.records[0].currency = 123 as unknown as string; },
  ]) {
    const data = structuredClone(catalogResult); mutate(data); assert.throws(() => validateCatalogResult(data, catalogInput));
    fetcher = async () => Response.json(data); await assert.rejects(catalog.readProductionCatalog('owner', catalogInput), /verificar/);
  }
  fetcher = async () => { signIn('other'); return Response.json(catalogResult); };
  await assert.rejects(catalog.readProductionCatalog('owner', catalogInput), /sesión/); signIn();
  for (const error of ['catalog-not-configured', 'not-found', 'owner-required']) {
    fetcher = async () => Response.json({ error, detail: 'private provider text' }, { status: 503 });
    await assert.rejects(catalog.readProductionCatalog('owner', catalogInput), e => e instanceof Error && !e.message.includes('private provider text'));
  }
  assert.doesNotMatch(catalog.catalogFailureMessage(Error('private ERP detail')), /private ERP/);
  const source = [{ id: 'erp1', name: ' synthetic customer ', active: true }];
  const candidates = catalogResult.catalog.records;
  assert.equal(suggestCatalogMatches('Customer', source, candidates)[0].status, 'review');
  assert.equal(suggestCatalogMatches('Customer', source, [...candidates, { ...candidates[0], id: '2' }])[0].status, 'ambiguous');
  assert.equal(suggestCatalogMatches('Customer', source, [])[0].status, 'not-seen');
  assert.equal(suggestCatalogMatches('Customer', [{ ...source[0], active: false }], candidates)[0].status, 'inactive');
  assert.equal(suggestCatalogMatches('Customer', [{ ...source[0], name: 'Other', email: 'SYNTHETIC@example.test' }], candidates)[0].status, 'review');
  assert.equal(suggestCatalogMatches('Item', [{ ...source[0], name: 'Different', sku: 'demo' }], [{ id: 'item1', name: 'Other', active: false, type: 'Group', sku: 'DEMO' }])[0].status, 'review');
  assert.deepEqual(suggestCatalogMatches('Account', source, candidates), []);
  assert.doesNotMatch(JSON.stringify([...storage.values()]), /Synthetic customer|Synthetic company/);
  const observed: CatalogCollection[] = [], pageCalls: string[] = [], erpCalls: string[] = [], waits: number[] = [];
  const late = { ...catalogResult.catalog.records[0], id: 'late', name: 'Zoe Demonstration' };
  const sourceRows = Array.from({ length: 250 }, (_, i) => ({ id: `erp-${i}`, name: `ERP Demo ${i}`, active: true }));
  sourceRows.push({ id: 'erp-late', name: late.name, active: true });
  const pageFor = (input: { entity: 'Customer' | 'Item' | 'Account'; startPosition: number }): CatalogResult => {
    const records = input.entity === 'Customer' ? input.startPosition === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...late, id: `qbo-${i}`, name: `QBO Demo ${i}` })) : [late] : [];
    return { ...structuredClone(catalogResult), request: input, catalog: { records, pageSize: 100, nextStartPosition: records.length === 100 ? 101 : null, endOfCurrentQuery: records.length < 100, atLimit: false } };
  };
  await scanCatalogs({ entities: ['Customer','Item','Account'], current: () => true, wait: async ms => { waits.push(ms); }, started: () => {},
    readPage: async input => { pageCalls.push(`${input.entity}:${input.startPosition}`); return pageFor(input); },
    readErp: async entity => { erpCalls.push(entity); return entity === 'Customer' ? sourceRows : []; }, progress: value => observed.push(value) });
  assert.deepEqual(pageCalls, ['Customer:1','Customer:101','Item:1','Account:1']); assert.deepEqual(erpCalls, ['Customer','Item','Account']); assert.deepEqual(waits, [5100,5100,5100]);
  assert.equal(observed[0].complete, false); assert.equal(observed[0].records.length, 100); assert.equal(observed[1].records.length, 101);
  assert.equal(observed[1].source.length, 251); assert.equal(observed[1].complete, true);
  const combined = comparisonRows('Customer', observed[1]);
  assert.equal(combined.find(row => row.source?.id === 'erp-late')?.candidates[0]?.id, 'late');
  assert.equal(combined.filter(row => row.source).length, 251, 'ERP records beyond 100 remain searchable');
  assert.ok(combined.some(row => !row.source && row.candidates[0].id === 'qbo-99'), 'QBO-only records are visible too');
  assert.equal(combined.filter(row => row.search.includes('zoe demonstration')).length, 1);
  let stillCurrent = true, afterRevocationReads = 0;
  await scanCatalogs({ entities: ['Customer'], current: () => stillCurrent, started: () => {}, wait: async () => {},
    readPage: async input => { stillCurrent = false; return pageFor(input); }, readErp: async () => { afterRevocationReads++; return []; }, progress: () => assert.fail('stale response shown') });
  assert.equal(afterRevocationReads, 0);
  stillCurrent = true; let cancelledPages = 0;
  await scanCatalogs({ entities: ['Customer','Item'], current: () => stillCurrent, started: () => {}, wait: async () => { stillCurrent = false; },
    readPage: async input => { cancelledPages++; return pageFor(input); }, readErp: async () => [], progress: () => {} });
  assert.equal(cancelledPages, 1, 'closing/cancelling prevents queued pages and later catalogs');
  for (const drift of ['duplicate', 'company']) await assert.rejects(scanCatalogs({ entities: ['Customer'], current: () => true, started: () => {}, wait: async () => {},
    readPage: async input => { const page = pageFor(input); if (input.startPosition > 1) { if (drift === 'duplicate') page.catalog.records[0].id = 'qbo-0'; else page.companyName = 'Different company'; } return page; },
    readErp: async () => [], progress: () => {} }), /catalog-observation-changed/);
  console.log('Continuous catalog scan: PASS (all pages, 251 ERP rows, late matching, QBO-only search, one ERP read per catalog, rate spacing, cancellation and observation drift).');
  console.log('QuickBooks production entry and catalog acceptance: PASS (isolation, owner identity race, report compatibility, strict catalog responses, provisional matching and no private persistence).');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
