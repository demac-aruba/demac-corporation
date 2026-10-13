'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ownerFromLookup, checkProfile, resolveOwner, google, environment, checkSecretVersions, checkTokenKey,
  verifyFunction, boundaries, diagnose, sourceCheck, stagePackage, OWNER_EMAIL, PROJECT, NUMBER, NAME, REALM, SECRETS, RESOURCE } = require('./quickbooks-production-prepare.cjs');
const UID = 'synthetic_owner';
const auth = () => ({ users: [{ localId: UID, email: OWNER_EMAIL, disabled: false }] });
const profile = () => ({ name: `projects/${PROJECT}/databases/(default)/documents/users/${UID}`,
  fields: { active: { booleanValue: true }, role: { stringValue: 'Super Admin' }, email: { stringValue: OWNER_EMAIL } } });
const fn = () => ({ name: RESOURCE + NAME, state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: NAME },
  serviceConfig: { maxInstanceCount: 3, timeoutSeconds: 60, environmentVariables: {
    QBO_PRODUCTION_ENABLED: 'false', QBO_PRODUCTION_REALM_ID: REALM, QBO_PRODUCTION_OWNER_UID: UID },
    secretEnvironmentVariables: SECRETS.map(name => ({ key: name, secret: name, projectId: NUMBER, version: '1' })) } });

test('only the exact supplied account and a matching active administrative profile qualify', () => {
  assert.equal(ownerFromLookup(auth()), UID); checkProfile(profile(), UID);
  for (const data of [{ users: [] }, { users: [...auth().users, ...auth().users] }, { users: [{ ...auth().users[0], disabled: true }] },
    { users: [{ ...auth().users[0], email: 'different@example.test' }] }, { users: [{ ...auth().users[0], localId: '../other' }] }]) assert.throws(() => ownerFromLookup(data));
  for (const patch of [{ name: profile().name + 'other' }, { fields: { ...profile().fields, active: { booleanValue: false } } },
    { fields: { ...profile().fields, role: { stringValue: 'accounting' } } },
    { fields: { ...profile().fields, email: { stringValue: 'different@example.test' } } }]) assert.throws(() => checkProfile({ ...profile(), ...patch }, UID));
});

test('owner verification makes one exact Auth lookup and one masked profile GET; no list or write', async () => {
  const calls = [];
  const uid = await resolveOwner('synthetic-bearer', async (url, options) => {
    calls.push({ url, options }); return Response.json(calls.length === 1 ? auth() : profile());
  });
  assert.equal(uid, UID); assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup?fields=users(localId,email,disabled)`);
  assert.equal(calls[0].options.method, 'POST'); assert.deepEqual(JSON.parse(calls[0].options.body), { email: [OWNER_EMAIL] });
  assert.equal(calls[1].url, `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${UID}?mask.fieldPaths=active&mask.fieldPaths=role&mask.fieldPaths=email`);
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[1].options.body, undefined);
  assert.ok(calls.every(c => c.options.redirect === 'error' && c.options.signal instanceof AbortSignal));
  let deniedCalls = 0;
  await assert.rejects(resolveOwner('synthetic', async () => { deniedCalls++; return Response.json({ users: [] }); }));
  assert.equal(deniedCalls, 1);
});

test('denied, redirected, missing, malformed and oversized Google responses fail closed without echoing data', async () => {
  for (const status of [302, 403, 404, 500]) {
    await assert.rejects(google('https://example.test', 'synthetic', { fetchImpl: async () => new Response('private-marker', { status }) }),
      error => error.safeCode === 'google-http-' + status && !error.message.includes('private-marker'));
  }
  assert.equal(await google('https://example.test', 'synthetic', { allowMissing: true, fetchImpl: async () => new Response('private', { status: 404 }) }), null);
  for (const body of ['not JSON private-marker', '[]', 'null', 'x'.repeat(65537)]) {
    await assert.rejects(google('https://example.test', 'synthetic', { fetchImpl: async () => new Response(body) }),
      error => ['google-response-invalid', 'google-response-too-large'].includes(error.safeCode) && !error.message.includes('private-marker'));
  }
});

test('secret metadata pins exact project, version and creation provenance without payload reads or rotation', () => {
  const metadata = { versions: [{ name: `projects/${NUMBER}/secrets/${SECRETS[0]}/versions/1`, state: 'ENABLED' }] };
  checkSecretVersions(SECRETS[0], metadata);
  for (const patch of [{ nextPageToken: 'more' }, { versions: [] }, { versions: [...metadata.versions, ...metadata.versions] },
    { versions: [{ ...metadata.versions[0], state: 'DISABLED' }] }, { versions: [{ ...metadata.versions[0], name: 'projects/other/secrets/other/versions/1' }] }]) {
    assert.throws(() => checkSecretVersions(SECRETS[0], { ...metadata, ...patch }));
  }
  const key = { name: `projects/${NUMBER}/secrets/${SECRETS[2]}`, labels: { integration: 'qbo-production', 'managed-by': 'reviewed-release' } };
  checkTokenKey(key); assert.throws(() => checkTokenKey({ ...key, labels: {} }));
  const source = fs.readFileSync('scripts/quickbooks-production-prepare.cjs', 'utf8');
  assert.doesNotMatch(source, /versions', 'access|versions', 'add|set-iam-policy|projects', 'add-iam|secrets', 'delete/);
});

test('packaging preserves reviewed backend and strips operational entry points, hooks and all credential values', () => {
  sourceCheck();
  const previous = process.env.RUNNER_TEMP; const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-prepare-test-'));
  process.env.RUNNER_TEMP = temp;
  try {
    const stage = stagePackage(UID); const files = fs.readdirSync(stage);
    assert.equal(files.length, 6); assert.ok(!files.includes('index.js') && !files.includes('bootstrap.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'quickbooksConnection.js'); assert.deepEqual(manifest.scripts, {});
    assert.equal(fs.readFileSync(path.join(stage, '.env.' + PROJECT), 'utf8'), environment(UID));
    assert.match(environment(UID), /^QBO_PRODUCTION_ENABLED=false\n/);
    assert.match(environment(UID), /QBO_PRODUCTION_REALM_ID=9130352327074466\n/);
    assert.doesNotMatch(environment(UID), /CLIENT_SECRET|CLIENT_ID|TOKEN_KEY|true/);
    assert.throws(() => environment('owner\nQBO_PRODUCTION_ENABLED=true')); assert.throws(() => stagePackage(UID));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); if (previous === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = previous; }
});

test('post-deployment check rejects activation, owner/company mismatch, broad instance count, triggers and secret changes', () => {
  verifyFunction(fn(), UID);
  for (const mutate of [f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_ENABLED = 'true'; },
    f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_REALM_ID = '9341458478454738'; },
    f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_OWNER_UID = 'different'; },
    f => { f.serviceConfig.maxInstanceCount = 10; }, f => { f.eventTrigger = {}; },
    f => { f.serviceConfig.secretEnvironmentVariables[0].version = 'latest'; },
    f => { f.serviceConfig.secretEnvironmentVariables[0].projectId = 'other-project'; }]) {
    const candidate = fn(); mutate(candidate); assert.throws(() => verifyFunction(candidate, UID));
  }
});

test('public probes carry no user tokens, OAuth parameters or mutation commands', async () => {
  const calls = [];
  await boundaries(async (url, options) => {
    calls.push({ url, options }); const untrusted = options.headers.Origin === 'https://untrusted.example';
    const callback = url.endsWith('/callback'); const preflight = options.method === 'OPTIONS';
    const status = preflight ? 204 : untrusted ? 403 : callback ? 503 : 401;
    return new Response(preflight ? null : JSON.stringify({ error: untrusted ? 'origin-denied' : callback ? 'not-configured' : 'sign-in-required' }),
      { status, headers: { 'cache-control': 'private, no-store', 'access-control-allow-origin': 'https://demac-aruba.com' } });
  });
  assert.equal(calls.length, 5); assert.ok(calls.every(c => !c.url.includes('?') && !c.options.headers.Authorization));
  assert.deepEqual(calls.filter(c => c.options.method === 'POST').map(c => c.options.body), ['{}']);
});

test('diagnostic projects only permission booleans, key/function metadata and redacted failure codes', async () => {
  const calls = [];
  const result = await diagnose('synthetic-token', async (url, options) => {
    calls.push({ url, options });
    if (url.includes('testIamPermissions')) return Response.json({ permissions: ['secretmanager.versions.add'], private: 'private-marker' });
    if (url.includes('logging.googleapis.com')) return Response.json({ entries: [{ protoPayload: {
      methodName: 'google.cloud.secretmanager.v1.SecretManagerService.CreateSecret',
      status: { code: 7, message: 'private-marker secretmanager.secrets.create' }, request: { secret: 'private-marker' },
    } }] });
    return new Response('private-marker', { status: 404 });
  });
  assert.equal(result.readOnly, true); assert.equal(result.keyExists, false); assert.equal(result.productionFunctionExists, false);
  assert.equal(result.permissions['secretmanager.secrets.create'], false);
  assert.equal(result.permissions['secretmanager.versions.add'], true);
  assert.deepEqual(result.failedOperations, [{ operation: 'create-secret', statusCode: 7, namedPermissions: ['secretmanager.secrets.create'] }]);
  assert.doesNotMatch(JSON.stringify(result), /private-marker|synthetic-token/);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.options.method === 'GET' || c.url.includes(':testIamPermissions') || c.url.includes('/entries:list')));
  const logRequest = calls.find(c => c.url.includes('logging.googleapis.com'));
  assert.match(logRequest.url, /fields=entries\(protoPayload\(methodName,status\(code,message\)\)\)/);
  assert.match(JSON.parse(logRequest.options.body).filter, /2026-10-13T15:03:30Z/);
});

test('diagnostic distinguishes an empty created key and tolerates audit permission denial without inventing a cause', async () => {
  const result = await diagnose('synthetic', async url => {
    if (url.includes('testIamPermissions')) return Response.json({});
    if (url.includes('/versions?')) return Response.json({});
    if (url.includes('secretmanager.googleapis.com')) return Response.json({ name: `projects/${NUMBER}/secrets/${SECRETS[2]}`,
      labels: { integration: 'qbo-production', 'managed-by': 'reviewed-release' } });
    return new Response(null, { status: url.includes('logging.googleapis.com') ? 403 : 404 });
  });
  assert.equal(result.keyExists, true); assert.equal(result.versionCount, 0); assert.equal(result.enabledVersion1, false);
  assert.equal(result.auditUnavailable, 'google-http-403'); assert.equal(result.failedOperations, undefined);
});
