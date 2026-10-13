'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validateExisting, patchRequest, verifyOnlyGateChanged, disclosures, boundaries, operationName, waitForOperation,
  ORIGINAL_REVISION } = require('./quickbooks-production-activate.cjs');
const { RESOURCE, NAME, PROJECT, NUMBER, REALM, SECRETS } = require('./quickbooks-production-prepare.cjs');
const UID = 'synthetic_owner';
const fn = () => ({ name: RESOURCE + NAME, state: 'ACTIVE', environment: 'GEN_2', labels: { unchanged: 'firebase' },
  buildConfig: { runtime: 'nodejs22', entryPoint: NAME, source: { storageSource: { bucket: 'synthetic', object: 'source.zip', generation: '1' } } },
  serviceConfig: { revision: ORIGINAL_REVISION, maxInstanceCount: 3, timeoutSeconds: 60,
    serviceAccountEmail: `${NUMBER}-compute@developer.gserviceaccount.com`, environmentVariables: {
      QBO_PRODUCTION_ENABLED: 'false', QBO_PRODUCTION_REALM_ID: REALM, QBO_PRODUCTION_OWNER_UID: UID, OTHER: 'preserve' },
    secretEnvironmentVariables: SECRETS.map(name => ({ key: name, secret: name, projectId: NUMBER, version: '1' })) } });

test('runtime patch preserves every other environment value and only addresses the one existing function', () => {
  const before = fn(); const original = structuredClone(before); const request = patchRequest(before, true);
  assert.equal(request.method, 'PATCH'); assert.equal(request.url,
    `https://cloudfunctions.googleapis.com/v2/${RESOURCE}${NAME}?updateMask=serviceConfig.environmentVariables`);
  assert.deepEqual(request.body, { name: before.name, serviceConfig: { environmentVariables: {
    ...before.serviceConfig.environmentVariables, QBO_PRODUCTION_ENABLED: 'true' } } });
  assert.deepEqual(before, original);
  assert.throws(() => patchRequest({ ...before, name: RESOURCE + 'operationalFunction' }, true));
  assert.throws(() => patchRequest(before, 'true'));
  assert.equal(patchRequest(before, false).body.serviceConfig.environmentVariables.QBO_PRODUCTION_ENABLED, 'false');
});
test('activation verification accepts only the gate and generated revision, rejecting drift and owner changes', () => {
  const before = fn(); validateExisting(before, UID, false);
  const after = fn(); after.serviceConfig.revision = 'quickbooksconnection-00002-synthetic';
  after.serviceConfig.environmentVariables.QBO_PRODUCTION_ENABLED = 'true';
  verifyOnlyGateChanged(before, after, UID, true);
  for (const mutate of [f => { f.serviceConfig.environmentVariables.OTHER = 'lost'; },
    f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_OWNER_UID = 'other'; },
    f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_REALM_ID = '999999999999'; },
    f => { f.serviceConfig.maxInstanceCount = 20; }, f => { f.serviceConfig.serviceAccountEmail = 'unexpected@example.test'; },
    f => { f.serviceConfig.secretEnvironmentVariables[0].version = '2'; },
    f => { f.buildConfig.source.storageSource.generation = '2'; }, f => { f.labels.unchanged = 'different'; },
    f => { f.eventTrigger = {}; }]) {
    const bad = structuredClone(after); mutate(bad); assert.throws(() => verifyOnlyGateChanged(before, bad, UID, true));
  }
  assert.throws(() => validateExisting(before, UID, true));
});
test('activation requires the exact reviewed disclosures at the canonical public URLs', async () => {
  const calls = [];
  await disclosures(async (url, options) => { calls.push({ url, options }); return new Response(
    fs.readFileSync('apps/erp-next/public/legal/' + url.split('/').at(-1), 'utf8'), { headers: { 'content-type': 'text/html' } }); });
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.url.startsWith('https://demac-aruba.com/legal/') &&
    c.options.redirect === 'error' && !c.options.headers && !c.options.body));
  for (const result of [() => new Response('old sandbox-only text', { headers: { 'content-type': 'text/html' } }),
    () => new Response('login required', { status: 302 }), () => new Response('x'.repeat(65537), { headers: { 'content-type': 'text/html' } })]) {
    await assert.rejects(disclosures(async () => result()));
  }
});
test('public live probes cannot authorize, exchange or write: no credentials, valid state or commands', async () => {
  for (const enabled of [true, false]) {
    const calls = [];
    await boundaries(enabled, async (url, options) => {
      calls.push({ url, options }); const callback = url.endsWith('/callback'); const untrusted = options.headers.Origin === 'https://untrusted.example';
      const status = options.method === 'OPTIONS' ? 204 : untrusted ? 403 : callback ? enabled ? 400 : 503 : 401;
      const error = untrusted ? 'origin-denied' : callback ? enabled ? 'invalid-state' : 'not-configured' : 'sign-in-required';
      return new Response(status === 204 ? null : JSON.stringify({ error }), { status,
        headers: { 'cache-control': 'private, no-store', 'access-control-allow-origin': 'https://demac-aruba.com' } });
    });
    assert.equal(calls.length, 5);
    assert.ok(calls.every(c => !c.options.headers.Authorization && !c.url.includes('?')));
    assert.equal(calls.find(c => c.options.method === 'POST').options.body, '{}');
  }
  await assert.rejects(boundaries(true, async () => new Response('unexpected', { status: 200 })));
});
test('operation polling stays pinned, fails without raw provider text and does not retry a mutation', async () => {
  const name = `projects/${PROJECT}/locations/us-central1/operations/synthetic-operation`;
  assert.equal(operationName({ name }), name);
  for (const bad of ['https://evil.example/operation', `projects/other/locations/us-central1/operations/id`, name + '/more']) {
    assert.throws(() => operationName({ name: bad }));
  }
  let requests = 0;
  await waitForOperation({ name }, 'synthetic', { pause: async () => {}, request: async url => {
    requests++; assert.equal(url, 'https://cloudfunctions.googleapis.com/v2/' + name); return { name, done: true }; } });
  assert.equal(requests, 1);
  await assert.rejects(waitForOperation({ name, done: true, error: { message: 'private-provider-data' } }, 'synthetic'),
    { safeCode: 'activation-operation-failed' });
  await assert.rejects(waitForOperation({ name }, 'synthetic', { attempts: 1, pause: async () => {}, request: async () => ({ name }) }),
    { safeCode: 'activation-operation-outcome-unknown' });
  await assert.rejects(waitForOperation({ name }, 'synthetic', { pause: async () => {}, request: async () => ({ name: name + 'changed' }) }),
    { safeCode: 'operation-reference-changed' });
});
