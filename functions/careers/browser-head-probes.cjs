'use strict';
// Test transport only. Next's static-export router probes local pages with HEAD.
// Chromium with routed HTTP/1.0 can report ERR_ABORTED after a successful bodyless
// response carrying the GET representation's Content-Length. Forward the actual
// local status/headers without that inapplicable transfer length. Never synthesize
// success, fetch applicant APIs, follow redirects, or weaken network assertions.
const assert = require('node:assert/strict');

async function forwardLocalHead(route, site) {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== site || request.method() !== 'HEAD') return route.fallback();
  const upstream = await route.fetch({ maxRedirects: 0, timeout: 15000 });
  const headers = { ...upstream.headers() };
  for (const key of Object.keys(headers)) {
    if (['content-length', 'transfer-encoding'].includes(key.toLowerCase())) delete headers[key];
  }
  // Playwright supplies the zero-byte transfer length. Status (including 4xx/5xx)
  // and Location remain those of the real static server; egress routing still
  // validates any browser-followed redirect. Errors propagate to the test runner.
  return route.fulfill({ status: upstream.status(), headers, body: '' });
}

async function installLocalHeadProbes(context, site) {
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(site), 'HEAD adapter is restricted to a loopback test origin');
  await context.route(`${site}/**`, route => forwardLocalHead(route, site));
}
module.exports = { forwardLocalHead, installLocalHeadProbes };
