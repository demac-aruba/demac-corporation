'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sourceCheck, stagePackage, verifyFunction, boundaries, FILES } = require('./quickbooks-reports-release.cjs');
const { PROJECT, NUMBER, REALM, SECRETS, RESOURCE } = require('./quickbooks-production-prepare.cjs');
const uid = 'synthetic-owner'; const sa = NUMBER + '-compute@developer.gserviceaccount.com';
function fn() { return { name: RESOURCE + 'quickbooksReports', state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: 'quickbooksReports' },
  serviceConfig: { timeoutSeconds: 60, maxInstanceCount: 3, serviceAccountEmail: sa,
    environmentVariables: { QBO_PRODUCTION_REPORTS_ENABLED: 'true', QBO_PRODUCTION_REALM_ID: REALM, QBO_PRODUCTION_OWNER_UID: uid },
    secretEnvironmentVariables: SECRETS.map(name => ({ key: name, secret: name, version: '1', projectId: PROJECT })) } }; }
test('new report runtime enforces fixed tenant, owner, capacity, dedicated entry and original secrets', () => {
  verifyFunction(fn(), uid, sa);
  for (const mutate of [f => { f.name += 'Other'; }, f => { f.eventTrigger = {}; }, f => { f.buildConfig.entryPoint = 'index'; },
    f => { f.serviceConfig.maxInstanceCount = 20; }, f => { f.serviceConfig.serviceAccountEmail = 'other'; },
    f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_OWNER_UID = 'other'; }, f => { f.serviceConfig.secretEnvironmentVariables[0].version = 'latest'; }]) {
    const data = fn(); mutate(data); assert.throws(() => verifyFunction(data, uid, sa));
  }
});
test('stage has exactly the pinned isolated source and no operational entry, lifecycle hook or secret payload', () => {
  sourceCheck(); const prior = process.env.RUNNER_TEMP; const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-reports-stage-test-')); process.env.RUNNER_TEMP = root;
  try {
    const stage = stagePackage(uid); assert.deepEqual(fs.readdirSync(stage).sort(), [...FILES, 'package.json', '.env.' + PROJECT].sort());
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'))); assert.equal(pkg.main, 'quickbooksReports.js'); assert.deepEqual(pkg.scripts, {});
    const env = fs.readFileSync(path.join(stage, '.env.' + PROJECT), 'utf8'); assert.doesNotMatch(env, /CLIENT_SECRET|TOKEN_KEY/);
    assert.throws(() => stagePackage(uid)); assert.throws(() => stagePackage('invalid\nuid'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); if (prior === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = prior; }
});
test('deployment probes are only unauthenticated denials and refuse unexpected successful access', async () => {
  const calls = [];
  await boundaries(async (url, options) => { calls.push({ url, options }); const status = options.method === 'OPTIONS' ? 204 : options.headers.Origin.includes('untrusted') ? 403 : options.method === 'GET' ? 405 : 401;
    const error = { 403: 'origin-denied', 405: 'method-not-allowed', 401: 'sign-in-required' }[status];
    return new Response(status === 204 ? null : JSON.stringify({ error }), { status, headers: { 'cache-control': 'private, no-store' } }); });
  assert.equal(calls.length, 4); assert.ok(calls.every(c => !c.options.headers.Authorization));
  await assert.rejects(boundaries(async () => new Response('{}', { status: 200 })));
});
