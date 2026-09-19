'use strict';
const assert = require('node:assert/strict');

// TEST-ONLY oracle. WebKit's console->pageerror mapping includes handled fetch failures.
// A message match alone never excuses an error. Each exception must have independent
// document-lifecycle, exact request/header and successful active-document read evidence.
function analyzeNavigationTrace(trace, { engine, origin }) {
  if (!Array.isArray(trace)) throw new TypeError('A complete navigation trace is required.');
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost'].includes(base.hostname)
      || base.origin !== origin) throw new Error('Navigation classification is limited to the loopback test origin.');
  const blockers = [];
  const teardownDiagnostics = [];
  const consumedRequests = new Set();
  const lifecycle = (row, kind) => row?.event === 'lifecycle' && row.kind === kind;

  for (let index = 0; index < trace.length; index++) {
    const event = trace[index];
    if (lifecycle(event, 'dom-error') || lifecycle(event, 'dom-unhandledrejection')) {
      blockers.push({ index, reason: 'uncaught_dom_exception', message: event.message });
    }
    if (event?.event !== 'pageerror') continue;
    const reject = (reason) => blockers.push({ index, reason, message: event.message });
    const match = /^Fetch API cannot load (https?:\/\/\S+) due to access control checks\.\n/.exec(event.stack || '');
    if (engine !== 'webkit' || !match) { reject('unclassified_pageerror'); continue; }
    let url;
    try { url = new URL(match[1]); } catch { reject('invalid_diagnostic_url'); continue; }
    if (url.origin !== origin || url.username || url.password || url.hash
        || !/\/__next\.[^/]+\.txt$/.test(url.pathname) || !url.searchParams.has('_rsc')) {
      reject('not_same_origin_rsc_prefetch'); continue;
    }

    // The nearest preceding lifecycle event must describe THIS exact fetch. No stale
    // request, earlier document, cancelled navigation or lookalike message is enough.
    let requestIndex = index - 1;
    while (requestIndex >= 0 && trace[requestIndex]?.event !== 'lifecycle'
        && trace[requestIndex]?.event !== 'pageerror') requestIndex--;
    const request = trace[requestIndex];
    if (!lifecycle(request, 'same-origin-fetch') || request.url !== url.href
        || request.method !== 'GET' || request.rsc !== '1' || request.prefetch !== '1'
        || typeof request.segment !== 'string' || !request.segment.startsWith('/')
        || !['beforeunload', 'pagehide'].includes(request.lifecycle)
        || !request.documentId || consumedRequests.has(requestIndex)) {
      reject('no_exact_teardown_request'); continue;
    }
    const docEvents = trace.map((row, position) => ({ ...row, position }))
      .filter(row => row.event === 'lifecycle' && row.documentId === request.documentId);
    const started = docEvents.find(row => row.kind === 'document-start' && row.position < requestIndex);
    const before = docEvents.filter(row => row.kind === 'beforeunload' && row.position < requestIndex).at(-1);
    const hide = docEvents.find(row => row.kind === 'pagehide' && before && row.position > before.position);
    const timingValid = [request.time, before?.time, hide?.time].every(Number.isFinite)
      && request.time >= before.time && Math.abs(hide.time - request.time) <= 250;
    const orderingValid = hide && (request.lifecycle === 'pagehide'
      ? hide.position < requestIndex : hide.position > index);
    const resumed = docEvents.some(row => row.kind === 'pageshow' && before && row.position > before.position);
    const crossedDocument = trace.slice(requestIndex + 1, index + 1)
      .some(row => lifecycle(row, 'document-start') || lifecycle(row, 'pageshow'));
    const nextDocument = hide && trace.slice(Math.max(index, hide.position) + 1)
      .find(row => lifecycle(row, 'document-start') && row.documentId !== request.documentId);
    const nextShown = nextDocument && trace.some(row => lifecycle(row, 'pageshow')
      && row.documentId === nextDocument.documentId && row.time >= nextDocument.time);
    if (!started || !before || !hide || hide.persisted !== false || !timingValid
        || !orderingValid || resumed || crossedDocument || !nextShown) {
      reject('document_exit_not_proven'); continue;
    }
    consumedRequests.add(requestIndex);
    teardownDiagnostics.push({ index, requestIndex, documentId: request.documentId, url: url.href,
      classification: 'departing_document_prefetch', requiresActiveRead: true });
  }
  return { rawPageErrors: trace.filter(row => row.event === 'pageerror').length, blockers, teardownDiagnostics };
}

function assertNavigationEvidence(report, probes) {
  assert.deepEqual(report.blockers, [], 'Unclassified page errors and ALL DOM exceptions remain fatal.');
  for (const item of report.teardownDiagnostics) {
    const checks = probes.filter(probe => probe.url === item.url);
    assert.equal(checks.length, 1, 'Each departing-document request needs one exact-URL active read.');
    const probe = checks[0];
    assert.equal(probe.status, 200, 'A failed active-page asset read is never a teardown exception.');
    assert.equal(probe.redirected, false, 'Unexpected asset redirects are not accepted.');
    assert.ok(probe.bytes > 0, 'The RSC asset must have a readable, non-empty body.');
    assert.equal(probe.documentActive, true, 'The verification document must still be active.');
  }
}

// Read-only asset probe, not a booking retry. No auth headers or business endpoints are used.
async function verifyNavigationEvidence(page, trace, options) {
  const report = analyzeNavigationTrace(trace, options);
  assert.deepEqual(report.blockers, [], 'Unclassified page errors and ALL DOM exceptions remain fatal.');
  const urls = [...new Set(report.teardownDiagnostics.map(row => row.url))];
  const probes = await page.evaluate(async (targets) => {
    let active = true;
    const leaving = () => { active = false; };
    addEventListener('pagehide', leaving, { once: true });
    try {
      return await Promise.all(targets.map(async url => {
        const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error',
          headers: { rsc: '1', 'next-router-prefetch': '1' }, signal: AbortSignal.timeout(5000) });
        const bytes = (await response.arrayBuffer()).byteLength;
        return { url, status: response.status, redirected: response.redirected, bytes,
          documentActive: active && document.visibilityState === 'visible' };
      }));
    } finally { removeEventListener('pagehide', leaving); }
  }, urls);
  const finalReport = analyzeNavigationTrace(trace, options);
  assertNavigationEvidence(finalReport, probes);
  return { ...finalReport, probes };
}
// Positive controls run in a disposable, script-only page before the ERP workflow.
// They prove this oracle still rejects genuine throws/rejections in each browser engine.
async function verifyBrowserErrorControls(browser, origin, engine) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const trace = [];
  page.on('pageerror', error => trace.push({ event: 'pageerror', message: error.message, stack: error.stack }));
  page.on('console', event => {
    if (event.text().startsWith('__NAV_CONTROL__')) trace.push(JSON.parse(event.text().slice('__NAV_CONTROL__'.length)));
  });
  try {
    await page.setContent('<!doctype html><title>Isolated error controls</title>');
    await page.evaluate(() => {
      window.__controlKinds = [];
      for (const [eventName, kind] of [['error', 'dom-error'], ['unhandledrejection', 'dom-unhandledrejection']]) {
        addEventListener(eventName, event => {
          window.__controlKinds.push(kind);
          console.debug('__NAV_CONTROL__' + JSON.stringify({ event: 'lifecycle', kind,
            message: String(event.message || event.reason?.message || event.reason) }));
        });
      }
    });
    for (const kind of ['throw', 'reject']) {
      const nextError = page.waitForEvent('pageerror', { timeout: 5000 });
      await page.evaluate(type => {
        if (type === 'throw') setTimeout(() => { throw new Error('NAV_THROW_CONTROL'); }, 0);
        else void Promise.reject(new Error('NAV_REJECTION_CONTROL'));
      }, kind);
      await nextError;
    }
    await page.waitForFunction(() => window.__controlKinds.length === 2, undefined, { timeout: 5000 });
    const report = analyzeNavigationTrace(trace, { engine, origin });
    assert.equal(report.rawPageErrors, 2, 'Both genuine exception controls must reach Playwright.');
    assert.equal(report.blockers.filter(row => row.reason === 'uncaught_dom_exception').length, 2,
      'Independent DOM listeners must detect both genuine exceptions.');
    assert.throws(() => assertNavigationEvidence(report, []));
    return { engine, genuineExceptionControls: 2, correctlyRejected: true, trace };
  } finally { await context.close(); }
}
module.exports = { analyzeNavigationTrace, assertNavigationEvidence, verifyNavigationEvidence, verifyBrowserErrorControls };
