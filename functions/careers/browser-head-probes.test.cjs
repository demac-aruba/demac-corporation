'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { forwardLocalHead, installLocalHeadProbes } = require('./browser-head-probes.cjs');
const site = 'http://127.0.0.1:4174';
function fixture({ method = 'HEAD', url = `${site}/dashboard/`, status = 200, headers = {}, error } = {}) {
  const calls = [], route = {
    request: () => ({ method: () => method, url: () => url }),
    fallback: async () => calls.push(['fallback']),
    fetch: async options => { calls.push(['fetch', options]); if (error) throw error; return { status: () => status, headers: () => headers }; },
    fulfill: async result => calls.push(['fulfill', result]),
  };
  return { route, calls };
}
for (const status of [200, 301, 404, 503]) test(`real HEAD status ${status} is preserved, never changed to success`, async () => {
  const headers = { 'content-type': 'text/html', 'content-length': '16384', 'transfer-encoding': 'chunked', location: '/target/' };
  const { route, calls } = fixture({ status, headers });
  await forwardLocalHead(route, site);
  assert.deepEqual(calls, [
    ['fetch', { maxRedirects: 0, timeout: 15000 }],
    ['fulfill', { status, headers: { 'content-type': 'text/html', location: '/target/' }, body: '' }],
  ]);
  assert.equal(headers['content-length'], '16384', 'upstream metadata object stays unchanged');
});
for (const [method, url] of [['GET', `${site}/dashboard/`], ['POST', `${site}/careersAdmin`], ['HEAD', 'http://127.0.0.1:4175/careersAdmin'], ['HEAD', 'https://example.test/']]) {
  test(`${method} ${url} keeps the original transport/egress policy`, async () => {
    const { route, calls } = fixture({ method, url }); await forwardLocalHead(route, site);
    assert.deepEqual(calls, [['fallback']]);
  });
}
test('an upstream failure still fails, with no fabricated fulfillment', async () => {
  const error = new Error('upstream interrupted'), { route, calls } = fixture({ error });
  await assert.rejects(forwardLocalHead(route, site), e => e === error);
  assert.equal(calls.some(([kind]) => kind === 'fulfill'), false);
});
test('non-loopback origins are rejected before installing a route', async () => {
  const context = { route: () => assert.fail('must not register a non-test origin') };
  await assert.rejects(installLocalHeadProbes(context, 'https://demac-aruba.com'));
});
test('adapter is scoped to the exact static-test origin', async () => {
  const registrations = [], context = { route: async (...args) => registrations.push(args) };
  await installLocalHeadProbes(context, site);
  assert.equal(registrations.length, 1); assert.equal(registrations[0][0], `${site}/**`);
  const { route, calls } = fixture({ method: 'GET' }); await registrations[0][1](route);
  assert.deepEqual(calls, [['fallback']]);
});
