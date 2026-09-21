'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function isolated(script, origins) {
  const env = { ...process.env, GCLOUD_PROJECT: 'demo-demac-projects', GOOGLE_CLOUD_PROJECT: 'demo-demac-projects', FIREBASE_CONFIG: '{"projectId":"demo-demac-projects"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199' };
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'PROJECTS_REGISTRY_ENABLED', 'PROJECTS_ALLOWED_ORIGINS']) delete env[key];
  if (origins !== undefined) env.PROJECTS_ALLOWED_ORIGINS = origins;
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const endpoint = require('./projectsRegistry').projectsRegistry;
    const express = require('express');
    const app = express(); app.use(express.json()); app.use(endpoint);
    (async () => {
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const url = 'http://127.0.0.1:' + server.address().port;
      try { ${script} } finally { await new Promise(resolve => server.close(resolve)); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
}

test('actual bootstrap exports the same bounded Projects endpoint without test helpers', () => {
  const entry = require('../projectsRegistry');
  const deployed = require('../bootstrap');
  assert.deepEqual(Object.keys(entry), ['projectsRegistry']);
  assert.equal(deployed.projectsRegistry, entry.projectsRegistry);
  for (const name of ['officeBookingAuthority', 'fieldOperationsAuthority', 'workOrderApplication']) assert.equal(typeof deployed[name], 'function');
  assert.deepEqual(entry.projectsRegistry.__endpoint.region, ['us-central1']);
  assert.equal(entry.projectsRegistry.__endpoint.maxInstances, 3);
  assert.equal(entry.projectsRegistry.__endpoint.timeoutSeconds, 60);
});

test('deployment defaults off even with an allowed origin and a bearer token', () => {
  isolated(`
    const r = await fetch(url, { method: 'POST', headers: { origin: 'https://erp.example.test', 'content-type': 'application/json', authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'list_plans', data: {} }) });
    assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'projects_not_active');
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://erp.example.test');
    assert.match(r.headers.get('cache-control'), /no-store/);
  `, 'https://erp.example.test');
});

test('empty origin configuration denies browser requests including preflight', () => {
  isolated(`
    for (const method of ['POST', 'OPTIONS']) {
      const r = await fetch(url, { method, headers: { origin: 'https://erp.example.test', 'access-control-request-method': 'POST' } });
      assert.equal(r.status, 403); assert.equal((await r.json()).error.code, 'origin_denied');
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    }
  `);
});

test('invalid origin configuration stays private and does not break function discovery', () => {
  for (const origins of ['*', 'https://erp.example.test/private-path']) isolated(`
    const r = await fetch(url, { method: 'POST', headers: { origin: 'https://erp.example.test' } });
    assert.equal(r.status, 503); const body = await r.json();
    assert.equal(body.error.code, 'projects_configuration_invalid');
    assert.equal(body.error.outcome, 'rejected');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.ok(!JSON.stringify(body).includes('private-path'));
  `, origins);
});
