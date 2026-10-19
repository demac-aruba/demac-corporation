'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyDelta, patchFor, FILES, TARGETS } = require('./appointment-message-copy-release.cjs');
const transport = name => ({ format: 'zip', privateRetained: true, extractionVerified: true, anonymousAccessDenied: true,
  uri: 'gs://gcf-v2-sources-1053571783393-us-central1/codex-release-recovery/appointment-finance/' + 'a'.repeat(40) + '/' + name + '-candidate.zip', generation: '123', sha256: 'b'.repeat(64) });
test('release can update only the five intended function sources', () => {
  for (const name of TARGETS) {
    const body = patchFor(name, transport(name));
    assert.deepEqual(Object.keys(body).sort(), ['buildConfig', 'name']);
    assert.deepEqual(Object.keys(body.buildConfig), ['source']);
    assert.equal(body.name, 'projects/demac-corporation/locations/us-central1/functions/' + name);
  }
  assert.throws(() => patchFor('wacliOutboundPoll', transport('wacliOutboundPoll')));
});
test('unverified or mismatched transport is rejected', () => {
  const name = TARGETS[0], valid = transport(name);
  for (const change of [{ privateRetained: false }, { extractionVerified: false }, { anonymousAccessDenied: false }, { format: 'tar' }, { generation: '' }, { sha256: 'bad' }, { uri: transport(TARGETS[1]).uri }, { uri: valid.uri.replace('gcf-v2-sources', 'public') }]) assert.throws(() => patchFor(name, { ...valid, ...change }));
});
test('every unrelated file and all dependency/configuration files are preserved', () => {
  const before = { ...Object.fromEntries(FILES.map(f => [f, 'old'])), 'bootstrap.js': 'same', 'package.json': 'same', 'package-lock.json': 'same' };
  const after = { ...before, ...Object.fromEntries(FILES.map(f => [f, 'new'])) };
  assert.deepEqual(verifyDelta(before, after), [...FILES].sort());
  for (const f of ['bootstrap.js', 'package.json', 'package-lock.json', 'whatsappWacliGateway.js']) assert.throws(() => verifyDelta(before, { ...after, [f]: 'changed' }));
  assert.throws(() => verifyDelta(before, { ...after, [FILES[0]]: 'old' }));
  assert.throws(() => verifyDelta(before, { ...after, [FILES[0]]: undefined }));
});
test('release stays source-only, merged-code gated and serialized with other Office releases', () => {
  const source = fs.readFileSync(require.resolve('./appointment-message-copy-release.cjs'), 'utf8');
  assert.match(source, /updateMask=buildConfig\.source/);
  assert.match(source, /refs\/heads\/main/);
  assert.doesNotMatch(source, /firestore\.googleapis|firebaserules\.googleapis|functions', 'deploy|--allow-unauthenticated|firebase-admin/);
  const workflow = fs.readFileSync('.github/workflows/appointment-message-copy-release.yml', 'utf8');
  assert.match(workflow, /group: field-operations-authority-production/);
  assert.match(workflow, /needs: safety/);
});
