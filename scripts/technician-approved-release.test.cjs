const test = require('node:test');
const assert = require('node:assert/strict');
const { assertContext, assertRuntime, assertLock, chooseDependencyLock, deployArgs, BRANCH } = require('./technician-approved-release.cjs');
const context = () => ({ repository: 'demac-aruba/demac-corporation', ref: 'refs/heads/' + BRANCH,
  sha: 'a'.repeat(40), checkout: 'a'.repeat(40), remoteRelease: 'a'.repeat(40), main: 'b'.repeat(40), parent: 'b'.repeat(40), treesEqual: true, docsOnly: true });
const runtime = () => ({ state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: 'fieldOperationsAuthority', source: { storageSource: { bucket: 'synthetic', object: 'source.zip' } } }, serviceConfig: { serviceAccountEmail: 'synthetic-runtime' } });
test('only the merged, unmodified and current authorized release proceeds', () => {
  assertContext(context());
  for (const delta of [{ repository: 'other/repo' }, { ref: 'refs/heads/main' }, { sha: 'main' },
    { checkout: 'c'.repeat(40) }, { remoteRelease: 'c'.repeat(40) }, { main: 'c'.repeat(40) }, { treesEqual: false }, { docsOnly: false }])
    assert.throws(() => assertContext({ ...context(), ...delta }));
});
test('unknown function runtime, entry point, state, source and trigger fail before deployment', () => {
  assertRuntime(runtime());
  for (const change of [x => x.state = 'FAILED', x => x.buildConfig.runtime = 'nodejs24',
    x => x.buildConfig.entryPoint = 'officeBookingAuthority', x => x.buildConfig.source = {},
    x => x.serviceConfig.serviceAccountEmail = '', x => x.eventTrigger = {}]) {
    const x = runtime(); change(x); assert.throws(() => assertRuntime(x));
  }
});
test('deploy command can update only Field source and preserves all runtime settings and IAM', () => {
  const args = deployArgs('/isolated/source', runtime());
  assert.deepEqual(args, ['functions', 'deploy', 'fieldOperationsAuthority', '--project=demac-corporation', '--region=us-central1', '--gen2',
    '--source=/isolated/source', '--entry-point=fieldOperationsAuthority', '--runtime=nodejs22',
    '--run-service-account=synthetic-runtime', '--quiet', '--format=value(state)']);
  assert.equal(args.some(arg => /env-vars|secret|memory|timeout|allow-unauthenticated|trigger/.test(arg)), false);
});
test('running dependency lock must match the reviewed package manifest', () => {
  const lock = JSON.stringify({ packages: { '': { dependencies: { synthetic: '1.0.0' } } } });
  assertLock(lock, { dependencies: { synthetic: '1.0.0' } });
  assert.throws(() => assertLock(lock, { dependencies: { synthetic: '2.0.0' } }));
  assert.throws(() => assertLock('{}', { dependencies: { synthetic: '1.0.0' } }));
});
test('legacy source without a lock requires unchanged dependencies and a matching tested lock', () => {
  const manifest = { dependencies: { synthetic: '1.0.0' } };
  const testedLock = JSON.stringify({ packages: { '': manifest } });
  const input = { runningLock: null, runningManifest: manifest, reviewedManifest: manifest, testedLock };
  assert.deepEqual(chooseDependencyLock(input), { lock: testedLock, strategy: 'introduced-ci-tested-lock' });
  assert.throws(() => chooseDependencyLock({ ...input, runningManifest: { dependencies: { synthetic: '2.0.0' } } }));
  assert.throws(() => chooseDependencyLock({ ...input, testedLock: '{}' }));
});
test('an existing running lock is preserved exactly and a mismatched lock cannot fall back', () => {
  const manifest = { dependencies: { synthetic: '1.0.0' } };
  const runningLock = JSON.stringify({ packages: { '': manifest }, lockfileVersion: 3 });
  const input = { runningLock, runningManifest: manifest, reviewedManifest: manifest, testedLock: 'not used' };
  assert.deepEqual(chooseDependencyLock(input), { lock: runningLock, strategy: 'retained-running-lock' });
  assert.throws(() => chooseDependencyLock({ ...input, runningLock: '{}', testedLock: runningLock }));
});
