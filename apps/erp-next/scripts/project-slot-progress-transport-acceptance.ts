import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// Set a synthetic environment before loading the real transport; no external requests.
for (const name of ['API_KEY', 'AUTH_DOMAIN', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
  process.env[`NEXT_PUBLIC_FIREBASE_${name}`] = 'synthetic-test';
}
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-demac-slot-load';
process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'false';
const { batchGetFirestoreDocuments, getFirestoreDocument, encodeFirestoreFields } = require('../lib/firebase/firestore-rest') as typeof import('../lib/firebase/firestore-rest');
const { loadProjectSlotSources } = require('../lib/live-project-slot-progress') as typeof import('../lib/live-project-slot-progress');
const { roleCapabilities } = require('../lib/security') as typeof import('../lib/security');
const principal = { userId: 'SYNTHETIC', displayName: 'Synthetic', role: 'super_admin' as const, active: true, capabilities: roleCapabilities.super_admin };
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const syntheticSession = JSON.stringify({ uid: principal.userId, email: 'synthetic@demac-preview.invalid', idToken: 'synthetic-test-token', refreshToken: 'synthetic-refresh-never-used', expiresAt: Date.now() + 3600000 } satisfies import('../lib/firebase/session').FirebaseWebSession);
const sessionData = new Map([['demac.erp-next.firebase.session.v1', syntheticSession]]);
globalThis.window = { sessionStorage: {
  getItem: (key: string) => sessionData.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionData.set(key, value); },
  removeItem: (key: string) => { sessionData.delete(key); },
} } as unknown as Window & typeof globalThis;
const prefix = 'projects/demo-demac-slot-load/databases/(default)/documents/workOrders/';
const url = 'https://firestore.googleapis.com/v1/projects/demo-demac-slot-load/databases/(default)/documents:batchGet';
let mode = 'ok', requests = 0, active = 0, maximum = 0, latency = 0, changedSlots = 6;
let lastBody: { documents: string[]; mask?: { fieldPaths: string[] } };
const fields = (slots = changedSlots) => encodeFirestoreFields({ scheduledSlots: slots, appointmentId: 'APT', clientId: 'C', propertyId: 'S', date: '2026-09-01', time: '08:30', vanId: 'VAN-1', status: 'Confirmada', technicianIds: ['T1'] });
globalThis.fetch = async (input, init) => {
  requests++; active++; maximum = Math.max(maximum, active);
  assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-test-token');
  try {
    if (latency) await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener('abort', cancel); resolve(); }, latency);
      init?.signal?.addEventListener('abort', cancel, { once: true });
      if (init?.signal?.aborted) cancel();
    });
    if (init?.method !== 'POST') {
      assert.ok(String(input).startsWith('https://firestore.googleapis.com/v1/' + prefix));
      return Response.json({ fields: fields() });
    }
    assert.equal(input, url);
    lastBody = JSON.parse(String(init.body));
    assert.ok(lastBody.documents.length <= 20);
    if (mode === 'denied') return Response.json({ error: { message: 'Synthetic denied read' } }, { status: 403 });
    if (mode === 'network') throw Error('Synthetic offline');
    if (mode === 'malformed') return Response.json({ unexpected: true });
    let rows: object[] = lastBody.documents.map((name) => name.endsWith('/MISSING') ? { missing: name } : { found: { name, fields: fields() } }).reverse();
    if (mode === 'partial') rows = rows.slice(1);
    if (mode === 'foreign') rows = [{ found: { name: prefix + 'UNREQUESTED', fields: fields() } }];
    if (mode === 'duplicate') rows.push(rows[0]);
    if (mode === 'both') rows = [{ found: { name: lastBody.documents[0], fields: fields() }, missing: lastBody.documents[0] }];
    return Response.json(rows);
  } finally { active--; }
};

async function main() {
  const values = await batchGetFirestoreDocuments('workOrders', ['A', 'A', 'MISSING', 'literal%2Fid', '__proto__'], { fieldPaths: ['scheduledSlots'] });
  assert.deepEqual(lastBody.documents, ['A', 'MISSING', 'literal%2Fid', '__proto__'].map((id) => prefix + id));
  assert.deepEqual(lastBody.mask, { fieldPaths: ['scheduledSlots'] });
  assert.equal(values.A?.id, 'A'); assert.equal(values.MISSING, null);
  assert.equal(values['literal%2Fid']?.id, 'literal%2Fid'); assert.equal(values.__proto__?.id, '__proto__');
  for (const invalid of ['', '..', '.', 'A/B']) await assert.rejects(batchGetFirestoreDocuments('workOrders', [invalid]), /Invalid/);
  await assert.rejects(batchGetFirestoreDocuments('workOrders/A', ['B']), /Invalid/);
  await assert.rejects(batchGetFirestoreDocuments('workOrders', Array.from({ length: 21 }, (_, i) => String(i))), /Invalid/);
  const beforeEmpty = requests;
  await batchGetFirestoreDocuments('workOrders', []); assert.equal(requests, beforeEmpty);
  console.log('PASS: real authenticated REST batch, exact shuffled identities, explicit missing, deduplication, projection and bounds');

  for (mode of ['denied', 'network', 'malformed', 'foreign', 'duplicate', 'both']) {
    const result = await loadProjectSlotSources(principal, ['A', 'MISSING']);
    assert.equal(result.A.failed, true); assert.equal(result.MISSING.failed, true, `${mode} cannot imply deletion`);
  }
  mode = 'partial';
  const partial = await loadProjectSlotSources(principal, ['A', 'B']);
  assert.equal(partial.A.value?.id, 'A'); assert.equal(partial.B.failed, true);
  mode = 'ok'; changedSlots = 2;
  assert.equal((await loadProjectSlotSources(principal, ['A'])).A.value?.scheduledSlots, 2);
  changedSlots = 9;
  assert.equal((await loadProjectSlotSources(principal, ['A'])).A.value?.scheduledSlots, 9, 'Subsequent reads must not reuse old allocations.');
  assert.deepEqual(lastBody.mask?.fieldPaths.slice().sort(), ['appointmentId', 'clientId', 'propertyId', 'date', 'time', 'vanId', 'status', 'scheduledSlots', 'technicianIds'].sort());
  console.log('PASS: failed/partial reads stay unknown; recovery and backdated changes use fresh data');

  const beforeDenied = requests;
  await assert.rejects(loadProjectSlotSources({ ...principal, active: false }, ['A']), /Forbidden/);
  assert.equal(requests, beforeDenied);
  const aborted = new AbortController(); aborted.abort();
  await loadProjectSlotSources(principal, ['A'], undefined, aborted.signal); assert.equal(requests, beforeDenied);
  const inFlight = new AbortController(); latency = 100;
  const pending = loadProjectSlotSources(principal, Array.from({ length: 100 }, (_, i) => String(i)), undefined, inFlight.signal);
  setTimeout(() => inFlight.abort(), 5); await pending;
  assert.equal(requests - beforeDenied, 3); assert.equal(active, 0);
  console.log('PASS: capability denial, pre-abort, in-flight cancellation and bounded request waves');

  // Controlled latency model; measures real service/REST serialization, not a user's WAN.
  const timings: object[] = [];
  for (const count of [13, 100, 1000]) {
    latency = count === 1000 ? 20 : 100;
    const ids = Array.from({ length: count }, (_, i) => `WO-${i}`);
    requests = 0; let cursor = 0;
    const oldStart = performance.now();
    await Promise.all(Array.from({ length: Math.min(6, count) }, async () => {
      while (cursor < ids.length) await getFirestoreDocument('workOrders', ids[cursor++]);
    }));
    const beforeMs = Math.round(performance.now() - oldStart), beforeRequests = requests;
    requests = 0; maximum = 0;
    const start = performance.now();
    const result = await loadProjectSlotSources(principal, ids);
    const afterMs = Math.round(performance.now() - start);
    assert.equal(Object.keys(result).length, count); assert.equal(requests, Math.ceil(count / 20)); assert.ok(maximum <= 3);
    timings.push({ links: count, syntheticLatencyMs: latency, beforeRequests, afterRequests: requests, beforeMs, afterMs });
  }
  console.log('BENCHMARK (synthetic transport latency; no production timing): ' + JSON.stringify(timings));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch; globalThis.window = originalWindow;
});
