const test = require('node:test');
const assert = require('node:assert/strict');
const { deployArgs, verifyDelta, verifyPrepared } = require('./schedule-history-release.cjs');
test('release command is source-only and limited to Office', () => {
  assert.deepEqual(deployArgs('officeBookingAuthority', '/tmp/candidate'), ['functions', 'deploy', 'officeBookingAuthority', '--project=demac-corporation', '--region=us-central1', '--gen2', '--source=/tmp/candidate', '--quiet', '--format=value(state)']);
  assert.throws(() => deployArgs('sendDailyTechnicianSchedules', '/tmp/candidate'));
  assert.throws(() => deployArgs('officeBookingAuthority', 'relative'));
});
test('unrecognized live source cannot become a release baseline', () => {
  assert.throws(() => verifyDelta({ 'package-lock.json': 'old' }, { 'package-lock.json': 'old' }, 'helper'), /live application changed/);
});
test('prepared recovery binds revision, source, configuration, exact archives and completed tests', () => {
  const prepared = { stage: 'prepared', sourceSha: 'sha', beforeRevision: 'revision', beforeSource: { generation: '1' }, configHash: 'config', iamHash: 'iam', baselineManifestHash: 'base', candidateManifestHash: 'candidate', baselineArchiveHash: 'base-archive', candidateArchiveHash: 'candidate-archive', baselineResult: { runtimeSmokePassed: true }, candidateResult: { runtimeSmokePassed: true }, historyEmulatorPassed: true, rollbackVerified: true };
  assert.doesNotThrow(() => verifyPrepared(prepared, structuredClone(prepared)));
  for (const key of ['sourceSha', 'beforeRevision', 'beforeSource', 'configHash', 'iamHash', 'baselineManifestHash', 'candidateManifestHash', 'baselineArchiveHash', 'candidateArchiveHash']) {
    assert.throws(() => verifyPrepared(prepared, { ...prepared, [key]: 'drift' }));
    assert.throws(() => verifyPrepared({ ...prepared, [key]: null }, prepared));
  }
  for (const key of ['historyEmulatorPassed', 'rollbackVerified']) assert.throws(() => verifyPrepared({ ...prepared, [key]: false }, prepared));
  assert.throws(() => verifyPrepared({ ...prepared, stage: 'failed' }, prepared));
});
