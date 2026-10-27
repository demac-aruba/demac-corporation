'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyDelta, FILES } = require('./customer-alerts-audit.cjs');
const { patchFor } = require('./customer-alerts-release.cjs');

test('customer alerts publication changes only its module and facade', () => {
  assert.deepEqual(FILES.slice().sort(), ['customerAlerts.js', 'officeBookingAuthorityFacade.js']);
  const before = Object.fromEntries([...FILES, 'bootstrap.js', 'index.js', 'package.json', 'package-lock.json', 'vanRosterAuthority.js'].map(f => [f, 'old']));
  const after = { ...before, ...Object.fromEntries(FILES.map(f => [f, 'new'])) };
  assert.deepEqual(verifyDelta(before, after), FILES.slice().sort());
  for (const unexpected of ['bootstrap.js', 'index.js', 'package.json', 'package-lock.json', 'vanRosterAuthority.js', 'newModule.js']) {
    assert.throws(() => verifyDelta(before, { ...after, [unexpected]: 'changed' }));
  }
  assert.throws(() => verifyDelta(before, { ...after, [FILES[0]]: 'old' }));
});

test('source update rejects unverified, public, mutable or wrong-target archives', () => {
  const transport = { format: 'zip', privateRetained: true, extractionVerified: true, anonymousAccessDenied: true,
    uri: 'gs://gcf-v2-sources-1053571783393-us-central1/codex-release-recovery/appointment-finance/' + 'a'.repeat(40) + '/officeBookingAuthority-candidate.zip',
    generation: '123456', sha256: 'b'.repeat(64) };
  const patch = patchFor(transport);
  assert.equal(patch.name, 'projects/demac-corporation/locations/us-central1/functions/officeBookingAuthority');
  assert.deepEqual(Object.keys(patch), ['name', 'buildConfig']);
  assert.deepEqual(Object.keys(patch.buildConfig), ['source']);
  assert.equal(patch.buildConfig.source.storageSource.generation, transport.generation);
  for (const [key, value] of [['format', 'tar'], ['privateRetained', false], ['extractionVerified', false], ['anonymousAccessDenied', false], ['generation', ''], ['sha256', 'bad'], ['uri', transport.uri.replace('officeBookingAuthority-candidate', 'otherFunction-candidate')]]) {
    assert.throws(() => patchFor({ ...transport, [key]: value }));
  }
});

test('release retains the reviewed retry/configuration/traffic contract without Rules writes', () => {
  const previous = fs.readFileSync('scripts/van-roster-release.cjs', 'utf8');
  const source = fs.readFileSync('scripts/customer-alerts-release.cjs', 'utf8');
  const contract = s => s.slice(s.indexOf('function patchFor'), s.indexOf('async function main'));
  assert.equal(contract(source), contract(previous));
  assert.match(source, /updateMask=buildConfig\.source/);
  assert.match(source, /await updateSource/);
  assert.match(source, /customer-alerts-audit-20261027.json/);
  assert.match(source, /customerAlerts.test.js/);
  assert.doesNotMatch(source, /publishRules|rulesets|firestore\.rules/);
  const workflow = fs.readFileSync('.github/workflows/customer-alerts-release.yml', 'utf8');
  assert.match(workflow, /group: field-operations-authority-production/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/release\/customer-alerts-20261027'/);
});
