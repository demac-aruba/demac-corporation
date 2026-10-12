'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safePaths, deployArgs, verifyDelta, validateRecoveredLock, isolatedTestEnv } = require('./booking-dwelling-release.cjs');
const { authorizeReconstruction, verifyPreparedRelease } = require('./booking-dwelling-release.cjs');
const { validateLock } = require('./booking-dwelling-candidate-validation.cjs');
test('retry restoration is allowed only when that sole field reproduces the original full configuration', () => {
  const { configHash, retryRestorationPlan } = require('./booking-dwelling-release.cjs');
  const original = { buildConfig: { runtime: 'nodejs22', entryPoint: 'notifyBookingReferenceUpdate' }, serviceConfig: { memory: '256M' },
    eventTrigger: { eventType: 'updated', retryPolicy: 'RETRY_POLICY_RETRY' } };
  const expected = configHash(original);
  assert.equal(retryRestorationPlan('notifyBookingReferenceUpdate', original, expected).required, false);
  const changed = { ...original, eventTrigger: { ...original.eventTrigger, retryPolicy: 'RETRY_POLICY_DO_NOT_RETRY' } };
  assert.deepEqual(retryRestorationPlan('notifyBookingReferenceUpdate', changed, expected), {
    required: true, observedRetryPolicy: 'RETRY_POLICY_DO_NOT_RETRY', intendedRetryPolicy: 'RETRY_POLICY_RETRY' });
  assert.throws(() => retryRestorationPlan('queueAppointmentConfirmation', changed, expected));
  assert.throws(() => retryRestorationPlan('notifyBookingReferenceUpdate', { ...changed, serviceConfig: { memory: '512M' } }, expected));
  assert.throws(() => retryRestorationPlan('notifyBookingReferenceUpdate', { ...changed, eventTrigger: { ...changed.eventTrigger, eventType: 'created' } }, expected));
});
test('published source tolerates only absent packaging metadata and rejects application drift or added files', () => {
  const { verifyPublishedSource, runtimeSourceHash } = require('./booking-dwelling-release.cjs');
  const candidate = { '.gitignore': 'ignore', 'bootstrap.js': 'code', 'package-lock.json': 'lock' };
  const published = { 'bootstrap.js': 'code', 'package-lock.json': 'lock' };
  assert.deepEqual(verifyPublishedSource(candidate, published), ['.gitignore']);
  assert.deepEqual(verifyPublishedSource(candidate, candidate), []);
  assert.equal(runtimeSourceHash(candidate), runtimeSourceHash(published));
  assert.throws(() => verifyPublishedSource(candidate, { ...published, '.gitignore': 'changed' }));
  assert.throws(() => verifyPublishedSource(candidate, { ...published, 'bootstrap.js': 'changed' }));
  assert.throws(() => verifyPublishedSource(candidate, { 'bootstrap.js': 'code' }));
  assert.throws(() => verifyPublishedSource(candidate, { ...published, 'injected.js': 'unexpected' }));
  assert.notEqual(runtimeSourceHash(published), runtimeSourceHash({ ...published, 'package-lock.json': 'changed' }));
});
test('historical runtime smoke requires its deployed entry point and rejects a missing target', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dwelling-historical-smoke-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{}}');
    fs.writeFileSync(path.join(root, 'bootstrap.js'), 'exports.sendDailyAppointmentReminders = () => {};');
    fs.mkdirSync(path.join(root, 'node_modules/firebase-admin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/firebase-admin/app.js'), 'exports.getApps = () => []; exports.deleteApp = () => {};');
    const script = path.join(__dirname, 'booking-dwelling-runtime-smoke.cjs');
    const run = name => spawnSync(process.execPath, [script, root, name], { encoding: 'utf8' });
    assert.equal(run('sendDailyAppointmentReminders').status, 0);
    assert.notEqual(run('sendDailyTechnicianSchedules').status, 0);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('each deployed entry point changes only the message producers it executes', () => {
  const { sourceFilesForFunction } = require('./booking-dwelling-release.cjs');
  assert.deepEqual(sourceFilesForFunction('sendDailyAppointmentReminders'), ['appointmentNotificationService.js']);
  for (const name of ['sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate']) assert.deepEqual(sourceFilesForFunction(name), ['technicianDailyScheduleService.js']);
  for (const name of ['officeBookingAuthority', 'queueAppointmentConfirmation']) assert.equal(sourceFilesForFunction(name).length, 3);
  assert.throws(() => sourceFilesForFunction('unapproved'));
});
test('build identity, environment and runtime policy remain protected while source/build IDs may change', () => {
  const { releaseConfig } = require('./booking-dwelling-release.cjs');
  const fn = { buildConfig: { runtime: 'nodejs22', entryPoint: 'officeBookingAuthority', source: { before: true }, build: 'before', serviceAccount: 'synthetic-builder', environmentVariables: { MODE: 'synthetic' }, automaticUpdatePolicy: {} }, serviceConfig: {} };
  assert.deepEqual(releaseConfig(fn), releaseConfig({ ...fn, buildConfig: { ...fn.buildConfig, source: { after: true }, build: 'after' } }));
  for (const key of ['serviceAccount', 'environmentVariables', 'automaticUpdatePolicy']) {
    assert.notDeepEqual(releaseConfig(fn), releaseConfig({ ...fn, buildConfig: { ...fn.buildConfig, [key]: 'changed' } }));
  }
});
test('reconstruction cannot silently cover another function, revision or dependency change', () => {
  const original = { 'firebase-admin': '^13.4.0', 'firebase-functions': '^6.4.0', sharp: '^0.34.3', nodemailer: '10.0.1' };
  const reviewed = { ...original, sharp: '0.35.5', nodemailer: '10.0.16' };
  const check = (name = 'officeBookingAuthority', revision = 'officebookingauthority-00082-dov', before = original, after = reviewed) => authorizeReconstruction(name, revision, before, original, after);
  check(); assert.throws(() => check('fieldOperationsAuthority')); assert.throws(() => check(undefined, 'other-revision'));
  assert.throws(() => check(undefined, undefined, { ...original, extra: '1.0.0' }));
  assert.throws(() => check(undefined, undefined, original, { ...reviewed, 'firebase-admin': '^14' }));
});
test('all five packages and rollback evidence must match before publication', () => {
  const functions = ['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate'].map(name => ({ name,
    beforeRevision: name + '-revision', originalManifestHash: 'original', baselineManifestHash: 'baseline', candidateManifestHash: 'candidate', baselineArchiveSha256: 'baseline-archive', candidateArchiveSha256: 'candidate-archive', configHash: 'config', targetConfigHash: 'original-config', retryRestoration: { required: false }, iamHash: 'iam',
    rollbackSourceVerified: true, baselineResult: { runtimeSmokePassed: true }, candidateResult: { runtimeSmokePassed: true } }));
  const prepared = { stage: 'complete', sourceSha: 'reviewed', functions };
  verifyPreparedRelease(prepared, structuredClone(prepared));
  for (const field of ['candidateManifestHash', 'baselineManifestHash', 'candidateArchiveSha256', 'baselineArchiveSha256', 'beforeRevision', 'configHash', 'targetConfigHash', 'retryRestoration', 'iamHash']) {
    const changed = structuredClone(prepared); changed.functions[4][field] = 'changed';
    assert.throws(() => verifyPreparedRelease(prepared, changed));
  }
  assert.throws(() => verifyPreparedRelease(prepared, { ...prepared, functions: functions.slice(0, 4) }));
  assert.throws(() => verifyPreparedRelease({ ...prepared, stage: 'failed' }, prepared));
});
test('dependency locks reject unpinned transitive modules and credential-bearing registries', () => {
  const manifest = { dependencies: { example: '1.0.0' } };
  const lock = { lockfileVersion: 3, packages: { '': { dependencies: manifest.dependencies }, 'node_modules/example': {
    version: '1.0.0', integrity: 'sha512-YWJjZA==', resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz' } } };
  validateLock(JSON.stringify(lock), manifest);
  for (const mutation of [p => delete p.integrity, p => p.resolved = 'https://secret@registry.npmjs.org/package.tgz', p => p.resolved = 'https://unreviewed.invalid/package.tgz', p => p.link = true]) {
    const changed = structuredClone(lock); mutation(changed.packages['node_modules/example']);
    assert.throws(() => validateLock(JSON.stringify(changed), manifest));
  }
});
test('source archives reject traversal and absolute paths', () => {
  safePaths(['bootstrap.js', 'data/vocabulary.json']);
  for (const file of ['/etc/passwd', '../outside', 'a/../../outside', 'a\\..\\outside']) assert.throws(() => safePaths([file]));
  assert.throws(() => safePaths([]));
});
test('runtime source tests cannot inherit production credentials or persistence endpoints', () => {
  const env = isolatedTestEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/credential.json', GOOGLE_GHA_CREDS_PATH: '/synthetic/credential.json',
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/synthetic/credential.json', FIREBASE_CONFIG: '{}', GCLOUD_PROJECT: 'production', PATH: '/bin' });
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE, undefined);
  assert.equal(env.GOOGLE_GHA_CREDS_PATH, undefined);
  assert.equal(env.FIREBASE_CONFIG, undefined);
  assert.equal(env.GCLOUD_PROJECT, 'demo-demac-dwelling-runtime');
  assert.equal(env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:1');
  assert.equal(env.PATH, '/bin');
});
test('a recovered image lock must pin the deployed direct dependencies with package integrity', () => {
  const manifest = { dependencies: { 'synthetic-package': '^1.0.0' } };
  const lock = { lockfileVersion: 3, packages: { '': { dependencies: manifest.dependencies },
    'node_modules/synthetic-package': { version: '1.2.0', integrity: 'sha512-synthetic' } } };
  assert.equal(validateRecoveredLock(JSON.stringify(lock), manifest).lockfileVersion, 3);
  assert.throws(() => validateRecoveredLock(JSON.stringify(lock), { dependencies: { other: '^2' } }));
  assert.throws(() => validateRecoveredLock(JSON.stringify({ ...lock, packages: { '': lock.packages[''] } }), manifest));
  assert.throws(() => validateRecoveredLock('{}', manifest));
});
test('deployment is limited to approved source targets and preserves the existing reference-update retry policy', () => {
  for (const name of ['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate']) {
    const args = deployArgs(name, '/tmp/reviewed-source');
    assert.deepEqual(args, ['functions', 'deploy', name, '--project=demac-corporation', '--region=us-central1', '--gen2', '--source=/tmp/reviewed-source', ...(name === 'notifyBookingReferenceUpdate' ? ['--retry'] : []), '--quiet', '--format=value(state)']);
  }
  assert.throws(() => deployArgs('projectAuthority', '/tmp/source'));
  assert.throws(() => deployArgs('officeBookingAuthority', 'relative'));
});
test('patch preserves every unrelated file and the deployed dependency lock; exact replay is allowed', () => {
  const before = { 'package.json': 'manifest', 'package-lock.json': 'lock', 'bootstrap.js': 'bootstrap', 'technicianDailyScheduleService.js': 'old' };
  const after = { ...before, 'technicianDailyScheduleService.js': 'new', 'bookingLocationDisplay.js': 'helper' };
  assert.deepEqual(verifyDelta(before, after, 'helper').sort(), ['bookingLocationDisplay.js', 'technicianDailyScheduleService.js']);
  assert.deepEqual(verifyDelta(after, after, 'helper'), []);
  for (const key of ['bootstrap.js', 'package.json', 'package-lock.json']) assert.throws(() => verifyDelta(before, { ...after, [key]: 'changed' }, 'helper'));
  assert.throws(() => verifyDelta(before, { ...after, 'unrelated.js': 'new' }, 'helper'));
  assert.throws(() => verifyDelta(before, { ...after, 'bookingLocationDisplay.js': 'wrong' }, 'helper'));
});
