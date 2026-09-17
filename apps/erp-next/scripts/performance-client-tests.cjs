const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../.performance-test/lib/performance-client-core.js');
const Observers = require('../.performance-test/lib/performance-observers.js');
const View = require('../.performance-test/lib/performance-view-model.js');
const ServerCore = require('../../../functions/performanceTelemetryCore.js');
const base = Date.UTC(2026, 8, 16, 15, 16);
const input = { name: 'support_slot_validation', module: 'scheduling', unit: 'ms', value: 50 };
function setup(overrides = {}) {
  let time = base;
  let id = 0;
  const calls = [];
  const deps = {
    uid: 'office', release: 'a'.repeat(40), environment: 'test', enabled: true,
    now: () => time, id: () => `identity_session_${++id}`,
    credential: () => ({ uid: 'office', idToken: 'existing' }), visible: () => true, module: () => 'scheduling',
    send: async (action, data) => {
      calls.push({ action, data: structuredClone(data) });
      return action === 'policy' ? { success: true, enabled: true, environment: 'test' } : { success: true };
    },
    ...overrides,
  };
  return { deps, calls, collector: Core.createCollector(deps), advance: (ms) => { time += ms; } };
}
test('client and server share a closed metric registry', () => assert.deepEqual(Core.CLIENT_UNITS, ServerCore.UNITS));
test('read-only credential lookup never refreshes, deletes, rewrites or exposes refresh tokens', () => {
  const raw = JSON.stringify({ uid: 'office', idToken: 'valid', refreshToken: 'DO_NOT_EXPOSE', expiresAt: base + 60000 });
  let writes = 0;
  const storage = { getItem: () => raw, setItem: () => writes++, removeItem: () => writes++ };
  assert.deepEqual(Core.existingCredential(storage, 'office', base), { uid: 'office', idToken: 'valid' });
  assert.equal(writes, 0);
  assert.equal(Core.existingCredential(storage, 'different', base), null);
  assert.equal(Core.existingCredential(storage, 'office', base + 40000), null);
  assert.equal(Core.existingCredential({ getItem() { throw Error('storage blocked'); } }, 'office', base), null);
  assert.equal(Core.existingCredential({ getItem: () => '{invalid' }, 'office', base), null);
});
test('initial load is buffered locally, never uploaded before server permission', async () => {
  const f = setup();
  f.collector.record(input);
  assert.equal(f.collector.stats().queued, 1);
  await f.collector.flush();
  assert.equal(f.calls.length, 0);
  f.advance(500);
  await f.collector.checkPolicy();
  await f.collector.flush();
  const ingest = f.calls.find((call) => call.action === 'ingest');
  assert.equal(ingest.data.measurements[0].observedAtMs, base);
  assert.equal(ingest.data.measurements[0].value, 50);
});
test('denied or absent initial policy cannot leak the initial buffer', async () => {
  const f = setup({ send: async () => ({ success: true, enabled: false, environment: 'test' }) });
  f.collector.record(input);
  await f.collector.checkPolicy();
  assert.equal(f.collector.stats().queued, 0);
  assert.equal(f.collector.canCollect(), false);
  const delayed = setup();
  delayed.advance(10001);
  assert.equal(delayed.collector.canCollect(), false);
  await delayed.collector.flush();
  assert.equal(delayed.calls.length, 0);
});
test('missing credentials can recover without deadlocking policy or flush', async () => {
  let valid = false;
  const f = setup({ credential: () => valid ? { uid: 'office', idToken: 'existing' } : null });
  await f.collector.checkPolicy(); valid = true; await f.collector.checkPolicy();
  assert.equal(f.collector.canCollect(), true);
  f.collector.record(input); valid = false; await f.collector.flush(); valid = true;
  f.collector.record(input); await f.collector.flush();
  assert.equal(f.calls.filter((call) => call.action === 'ingest').length, 1);
});
test('lost acknowledgement retries retain immutable batch, ID and observation time', async () => {
  const sent = []; let fail = true;
  const f = setup({ send: async (action, data) => {
    if (action === 'policy') return { success: true, enabled: true, environment: 'test' };
    sent.push(JSON.stringify(data));
    if (fail) { fail = false; throw Error('lost acknowledgement'); }
    return { success: true };
  } });
  await f.collector.checkPolicy(); f.collector.record(input); await f.collector.flush();
  f.advance(9000); await f.collector.flush();
  assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]);
  assert.equal(JSON.parse(sent[0]).measurements[0].observedAtMs, base);
});
test('buffer and batch remain bounded; no request is sent per observed operation', async () => {
  const f = setup(); await f.collector.checkPolicy();
  for (let i = 0; i < 10000; i++) f.collector.record(input);
  assert.ok(f.collector.stats().queued <= 120); assert.ok(f.collector.stats().dropped > 0);
  assert.equal(f.calls.filter((call) => call.action === 'ingest').length, 0);
  await f.collector.flush();
  assert.ok(f.calls.find((call) => call.action === 'ingest').data.measurements.length <= 80);
});
test('disabled, stopped and changed-user collectors cannot emit', async () => {
  const f = setup(); await f.collector.checkPolicy(); f.collector.record(input); f.collector.stop(); await f.collector.flush();
  assert.equal(f.calls.filter((call) => call.action === 'ingest').length, 0);
  const disabled = setup({ enabled: false }); await disabled.collector.checkPolicy(); assert.equal(disabled.calls.length, 0);
  const changed = setup(); await changed.collector.checkPolicy(); changed.collector.record(input);
  changed.deps.credential = () => ({ uid: 'admin', idToken: 'different' }); await changed.collector.flush();
  assert.equal(changed.calls.filter((call) => call.action === 'ingest').length, 0);
});
function fakeWindow(fetcher) {
  let clock = 0;
  const listeners = new Map();
  return { fetch: fetcher, location: { pathname: '/scheduling' },
    performance: { now: () => ++clock, getEntriesByType: () => [] },
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name) => listeners.delete(name),
    setTimeout: () => 1, clearTimeout: () => {}, listeners,
  };
}
test('fetch preserves exact responses and errors even if measuring throws; cleanup and remount work', async () => {
  const response = { ok: true, marker: 'original' }; let implementation = async () => response;
  const win = fakeWindow((...args) => implementation(...args));
  const original = win.fetch;
  const cleanup = Observers.installPerformanceObservers(win, () => { throw Error('metrics failure'); }, () => true);
  const url = 'https://us-central1-demo.cloudfunctions.net/officeBookingAuthority';
  assert.equal(await win.fetch(url), response);
  const expected = Error('original operational error'); implementation = async () => { throw expected; };
  await assert.rejects(win.fetch(url), (error) => error === expected);
  cleanup(); assert.equal(win.fetch, original); assert.equal(win.listeners.size, 0);
  implementation = async () => response; const seen = [];
  const again = Observers.installPerformanceObservers(win, (item) => seen.push(item), () => true);
  await win.fetch(url); assert.equal(seen.length, 1); again(); assert.equal(win.fetch, original);
});
test('a broken timing API cannot turn an accepted operation into failure', async () => {
  const accepted = { ok: true }; let ticks = 0;
  const win = fakeWindow(async () => accepted);
  win.performance.now = () => { if (++ticks > 1) throw Error('clock failure'); return 1; };
  const cleanup = Observers.installPerformanceObservers(win, () => {}, () => true);
  assert.equal(await win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority'), accepted);
  cleanup();
});
test('request attribution stays on its start module and cancellation is not a successful latency', async () => {
  const events = []; let release;
  const win = fakeWindow(() => new Promise((resolve) => { release = resolve; }));
  const cleanup = Observers.installPerformanceObservers(win, (item) => events.push(item), () => true);
  const promise = win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority');
  win.location.pathname = '/crm'; release({ ok: true }); await promise;
  assert.equal(events[0].module, 'scheduling'); cleanup();
  assert.equal(Observers.requestMetric('https://us-central1-demo.cloudfunctions.net/performanceTelemetry'), null);
  const cancelled = new Error('Cancelled by caller'); cancelled.name = 'AbortError';
  const other = fakeWindow(async () => { throw cancelled; }); const cancelledEvents = [];
  const stop = Observers.installPerformanceObservers(other, (item) => cancelledEvents.push(item), () => true);
  await assert.rejects(other.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority'), (error) => error === cancelled);
  assert.equal(cancelledEvents.length, 1); assert.equal(cancelledEvents[0].name, 'request_cancelled');
  assert.equal(cancelledEvents[0].unit, 'count'); assert.equal(cancelledEvents[0].error, false); stop();
});
test('unavailable/stale/paused UI overrides previously healthy readings', () => {
  const data = { generatedAtMs: base, lastObservedAtMs: base, policy: { enabled: true }, health: { status: 'healthy', label: 'Measured workflows healthy' }, metrics: [], truncated: false };
  assert.equal(View.displayHealth(data, 'network failed', base).status, 'unavailable');
  assert.equal(View.displayHealth(data, '', base + 600000).status, 'stale');
  assert.equal(View.displayHealth(null, '', base).status, 'collecting');
  assert.equal(View.displayHealth({ ...data, lastObservedAtMs: null }, '', base).status, 'collecting');
  assert.equal(View.displayHealth({ ...data, policy: { enabled: false } }, '', base).status, 'collecting');
});
