'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { patchFor } = require('./employee-split-release.cjs');
const { verifyDelta, FILES } = require('./employee-split-audit.cjs');
const approved = () => ({ format: 'zip', privateRetained: true, extractionVerified: true, anonymousAccessDenied: true, uri: 'gs://gcf-v2-sources-1053571783393-us-central1/codex-release-recovery/appointment-finance/' + 'a'.repeat(40) + '/workOrderApplication-candidate.zip', generation: '123456', sha256: 'b'.repeat(64) });
test('only the approved Work Order source is patched; no runtime settings or data payload', () => {
  const patch = patchFor(approved());
  assert.deepEqual(Object.keys(patch).sort(), ['buildConfig', 'name']);
  assert.equal(patch.name, 'projects/demac-corporation/locations/us-central1/functions/workOrderApplication');
  assert.deepEqual(Object.keys(patch.buildConfig), ['source']);
});
test('reject absent privacy, retention, ZIP proof and wrong function/bucket', () => {
  for (const change of [{ privateRetained: false }, { extractionVerified: false }, { anonymousAccessDenied: false }, { format: 'tar' }, { generation: '' }, { sha256: 'bad' }, { uri: approved().uri.replace('workOrderApplication', 'projectAuthority') }, { uri: approved().uri.replace('gcf-v2-sources', 'public') }]) assert.throws(() => patchFor({ ...approved(), ...change }));
});
test('only the reviewed attendance modules may differ', () => {
  const before = { 'employeeAttendanceCalculation.js': 'old', 'workOrderApplicationService.js': 'old', 'bootstrap.js': 'same', 'index.js': 'same', 'package.json': 'same', 'package-lock.json': 'same' };
  const after = { ...before, ...Object.fromEntries(FILES.map(f => [f, 'new'])) };
  assert.deepEqual(verifyDelta(before, after), [...FILES].sort());
  for (const name of ['bootstrap.js', 'index.js', 'package.json', 'package-lock.json', 'unrelated.js']) assert.throws(() => verifyDelta(before, { ...after, [name]: 'changed' }));
});
test('publication uses source-only API mask and preserves shared production concurrency', () => {
  const source = fs.readFileSync(require.resolve('./employee-split-release.cjs'), 'utf8');
  assert.match(source, /updateMask=buildConfig\.source/);
  assert.doesNotMatch(source, /firestore\.googleapis|firebaserules\.googleapis|functions', 'deploy|--allow-unauthenticated/);
  assert.match(fs.readFileSync('.github/workflows/employee-split-release.yml', 'utf8'), /group: field-operations-authority-production/);
});
