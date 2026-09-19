'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeNavigationTrace, assertNavigationEvidence } = require('./projects-navigation-diagnostics.cjs');
const origin = 'http://127.0.0.1:12345';
const url = `${origin}/projects/__next._head.txt?_rsc=test`;
const lifecycle = (kind, ordinal, lifecycle = 'active', more = {}) => ({ event: 'lifecycle', kind,
  documentId: 'old', ordinal, time: 1000 + ordinal, lifecycle, ...more });
function fixture() {
  return [lifecycle('document-start', 1), lifecycle('pageshow', 2),
    lifecycle('beforeunload', 3, 'beforeunload'),
    lifecycle('same-origin-fetch', 4, 'beforeunload', { url, method: 'GET', rsc: '1', prefetch: '1', segment: '/_head' }),
    { event: 'pageerror', message: `${url} due to access control checks.`,
      stack: `Fetch API cannot load ${url} due to access control checks.\n at unknown` },
    lifecycle('pagehide', 5, 'pagehide', { persisted: false }),
    lifecycle('document-start', 1, 'active', { documentId: 'new', time: 1100 }),
    lifecycle('pageshow', 2, 'active', { documentId: 'new', time: 1101 })];
}
const analyze = (trace, engine = 'webkit') => analyzeNavigationTrace(trace, { engine, origin });
const probe = () => ({ url, status: 200, redirected: false, bytes: 128, documentActive: true });
const blocked = (trace) => assert.ok(analyze(trace).blockers.length > 0);

test('proven departing-document request remains recorded and requires successful active read', () => {
  const trace = fixture(); const before = structuredClone(trace); const result = analyze(trace);
  assert.equal(result.rawPageErrors, 1); assert.equal(result.teardownDiagnostics.length, 1);
  assertNavigationEvidence(result, [probe()]); assert.deepEqual(trace, before);
});
test('empty errors are accepted without inventing cancellation evidence', () => {
  assertNavigationEvidence(analyze([]), []);
});
test('a matching message alone remains a fatal page error', () => blocked([fixture()[4]]));
test('Chromium is not given a WebKit diagnostic exception', () => {
  assert.equal(analyze(fixture(), 'chromium').blockers.length, 1);
});
test('active-page fetch is fatal even with the identical error text', () => {
  const rows = fixture(); rows[3].lifecycle = 'active'; blocked(rows);
});
test('missing prefetch/RSC markers, changed URL, method or segment remain fatal', () => {
  for (const [key, value] of [['prefetch', null], ['rsc', null], ['method', 'POST'],
    ['url', url + 'other'], ['segment', null]]) {
    const rows = fixture(); rows[3][key] = value; blocked(rows);
  }
});
test('API URLs, other origins and other ports are never prefetch diagnostics', () => {
  for (const target of [`${origin}/projectsRegistry?_rsc=x`, 'https://other.test/__next._head.txt?_rsc=x',
    'http://127.0.0.1:54321/projects/__next._head.txt?_rsc=x']) {
    const rows = fixture(); rows[3].url = target;
    rows[4].stack = `Fetch API cannot load ${target} due to access control checks.\n`;
    blocked(rows);
  }
});
test('cancelled beforeunload, bfcache hide, missing replacement and stale evidence fail closed', () => {
  for (const change of [rows => rows.splice(5, 1), rows => { rows[5].persisted = true; },
    rows => rows.splice(6), rows => { rows[5].time += 1000; },
    rows => rows.splice(4, 0, lifecycle('pageshow', 5)), rows => { rows[5].documentId = 'other'; }]) {
    const rows = fixture(); change(rows); blocked(rows);
  }
});
test('one request cannot excuse duplicate errors', () => {
  const rows = fixture(); rows.splice(5, 0, { ...rows[4] }); blocked(rows);
});
test('all actual DOM throws/rejections remain fatal, including a matching teardown message', () => {
  for (const kind of ['dom-error', 'dom-unhandledrejection']) {
    const rows = fixture(); rows.push(lifecycle(kind, 10, 'beforeunload', { message: rows[4].stack }));
    blocked(rows);
  }
});
test('real errors in the newly loaded document remain fatal', () => {
  const rows = fixture(); rows.push({ event: 'pageerror', message: 'REAL', stack: 'Error: REAL' }); blocked(rows);
});
test('successful same-origin traffic cannot excuse an unrelated page error', () => {
  const rows = fixture(); rows[4].stack = 'TypeError: Cannot read properties of undefined'; blocked(rows);
});
test('cancellation evidence is not accepted unless each exact asset is readable in an active document', () => {
  const result = analyze(fixture());
  for (const bad of [[], [{ ...probe(), status: 404 }], [{ ...probe(), status: 403 }],
    [{ ...probe(), redirected: true }], [{ ...probe(), bytes: 0 }],
    [{ ...probe(), documentActive: false }], [{ ...probe(), url: url + 'different' }]]) {
    assert.throws(() => assertNavigationEvidence(result, bad));
  }
});
test('a fetch inside pagehide also requires the proven document departure and new active page', () => {
  const rows = fixture(); const hide = rows.splice(5, 1)[0]; hide.ordinal = 4; hide.time = 1004;
  rows.splice(3, 0, hide); rows[4].lifecycle = 'pagehide'; rows[4].ordinal = 5; rows[4].time = 1005;
  assertNavigationEvidence(analyze(rows), [probe()]);
});
test('unknown loopback context is rejected instead of guessing an origin', () => {
  assert.throws(() => analyzeNavigationTrace(fixture(), { engine: 'webkit', origin: 'https://production.test' }));
});
