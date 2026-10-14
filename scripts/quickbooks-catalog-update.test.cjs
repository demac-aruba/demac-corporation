'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stagePackage, FILES } = require('./quickbooks-reports-release.cjs');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { hash, configWithoutFlag, patchFor, verifyCurrent, reviewedSourceMatcher, catalogBoundaries, BASE, REVISION, FLAG, MASK } = require('./quickbooks-catalog-update.cjs');
const { PROJECT, NUMBER, REALM, SECRETS, RESOURCE } = require('./quickbooks-production-prepare.cjs');
const uid = 'synthetic-owner', baseline = { 'reader.js': 'old' }, candidate = { 'reader.js': 'new' };
function fn() { return { name: RESOURCE + 'quickbooksReports', state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: 'quickbooksReports' }, serviceConfig: { revision: REVISION,
  timeoutSeconds: 60, maxInstanceCount: 3, serviceAccountEmail: NUMBER + '-compute@developer.gserviceaccount.com',
  environmentVariables: { QBO_PRODUCTION_REPORTS_ENABLED: 'true', QBO_PRODUCTION_REALM_ID: REALM, QBO_PRODUCTION_OWNER_UID: uid, OTHER: 'preserved' },
  secretEnvironmentVariables: SECRETS.map(secret => ({ key: secret, secret, version: '1', projectId: PROJECT })) } }; }
const expected = () => ({ uid, configHash: hash(configWithoutFlag(fn())), baselineHash: hash(baseline), candidateHash: hash(candidate) });
function transport() { return { format: 'zip', privateRetained: true, extractionVerified: true, anonymousAccessDenied: true, uri: `gs://gcf-v2-sources-${NUMBER}-us-central1/codex-release-recovery/appointment-finance/${'a'.repeat(40)}/quickbooksReports-candidate.zip`, generation: '1234', sha256: 'b'.repeat(64) }; }
test('update is limited to one reader source and an explicit flag; all other environment survives', () => {
  const env = fn().serviceConfig.environmentVariables, saved = structuredClone(env), patch = patchFor(transport(), env);
  assert.equal(MASK, 'buildConfig.source,serviceConfig.environmentVariables'); assert.equal(patch.name, RESOURCE + 'quickbooksReports');
  assert.deepEqual(Object.keys(patch).sort(), ['buildConfig','name','serviceConfig']);
  assert.deepEqual(Object.keys(patch.serviceConfig), ['environmentVariables']);
  assert.deepEqual(patch.serviceConfig.environmentVariables, { ...saved, [FLAG]: 'true' }); assert.deepEqual(env, saved);
  for (const field of ['privateRetained', 'extractionVerified', 'anonymousAccessDenied']) assert.throws(() => patchFor({ ...transport(), [field]: false }, env));
  for (const change of [{ uri: transport().uri.replace('quickbooksReports', 'officeBookingAuthority') }, { generation: 'latest' }, { sha256: 'bad' }]) assert.throws(() => patchFor({ ...transport(), ...change }, env));
});
test('exact baseline/candidate allowed; revision, source, owner, secrets, disabled flag and unrelated config drift fail', () => {
  assert.equal(verifyCurrent(fn(), baseline, expected()), false);
  const current = fn(); current.serviceConfig.revision = 'quickbooksreports-00002-test'; current.serviceConfig.environmentVariables[FLAG] = 'true';
  assert.equal(verifyCurrent(current, candidate, expected()), true);
  for (const mutate of [f => { f.serviceConfig.revision = 'other'; }, f => { f.serviceConfig.environmentVariables[FLAG] = 'true'; }, f => { f.serviceConfig.environmentVariables.OTHER = 'changed'; }, f => { f.serviceConfig.environmentVariables.QBO_PRODUCTION_OWNER_UID = 'other'; }, f => { f.serviceConfig.secretEnvironmentVariables[0].version = '2'; }, f => { f.serviceConfig.ingressSettings = 'changed'; }, f => { f.eventTrigger = {}; }, f => { f.state = 'DEPLOYING'; }]) {
    const changed = fn(); mutate(changed); assert.throws(() => verifyCurrent(changed, baseline, expected()));
  }
  assert.throws(() => verifyCurrent(fn(), candidate, expected())); assert.throws(() => verifyCurrent(fn(), { unexpected: 'file' }, expected()));
  current.state = 'FAILED'; assert.equal(verifyCurrent(current, candidate, expected()), true); // updateSource separately requires a failed reviewed operation.
});
test('operation provenance requires exact environment as well as immutable source', () => {
  const env = { KEEP: 'yes', [FLAG]: 'true' }, matcher = reviewedSourceMatcher((a,b) => a === b, env);
  const op = { metadata: { requestResource: { serviceConfig: { environmentVariables: env } } } };
  assert.equal(matcher('source', 'source', op), true); assert.equal(matcher('other', 'source', op), false);
  assert.equal(matcher('source', 'source', {}), false);
  assert.equal(matcher('source','source',{ metadata: { requestResource: { serviceConfig: { environmentVariables: { ...env, KEEP: 'no' } } } } }), false);
});
test('reconstructs original package/dependencies and confines candidate difference to reviewed reader files and flag', () => {
  const previous = process.env.RUNNER_TEMP, root = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-update-test-')); process.env.RUNNER_TEMP = root;
  try {
    const next = stagePackage(uid), old = path.join(root, 'old'); fs.cpSync(next, old, { recursive: true }); fs.unlinkSync(path.join(old, 'quickbooksCatalogFormat.js'));
    for (const file of FILES.filter(f => f !== 'quickbooksCatalogFormat.js')) fs.writeFileSync(path.join(old, file), execFileSync('git', ['show', BASE + ':functions/' + file]));
    fs.appendFileSync(path.join(next, '.env.' + PROJECT), `${FLAG}=true\n`);
    const oldManifest = manifest(old), nextManifest = manifest(next);
    const changed = Object.keys(nextManifest).filter(f => nextManifest[f] !== oldManifest[f]).sort();
    assert.deepEqual(changed, ['.env.' + PROJECT, 'quickbooksCatalogFormat.js', 'quickbooksReports.js', 'quickbooksReportsFormat.js', 'quickbooksReportsHttp.js', 'quickbooksReportsService.js']);
    assert.equal(nextManifest['quickbooksConnectionService.js'], oldManifest['quickbooksConnectionService.js']);
    assert.equal(nextManifest['package-lock.json'], oldManifest['package-lock.json']); assert.equal(nextManifest['package.json'], oldManifest['package.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = previous; }
});
test('deployment catalog probes cannot authenticate or retrieve business data', async () => {
  let count = 0;
  await catalogBoundaries(async (url, options) => { count++; assert.ok(url.endsWith('/quickbooksReports/catalog')); assert.equal(options.headers.Authorization, undefined);
    const hostile = options.headers.Origin.includes('untrusted'); return new Response(JSON.stringify({ error: hostile ? 'origin-denied' : 'sign-in-required' }), { status: hostile ? 403 : 401, headers: { 'cache-control': 'private, no-store' } }); });
  assert.equal(count, 2); await assert.rejects(catalogBoundaries(async () => new Response('{}', { status: 200 })));
});
