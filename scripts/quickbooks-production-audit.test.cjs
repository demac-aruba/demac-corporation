'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareRevisions, verifyOtherUpdateTimes } = require('./quickbooks-production-audit.cjs');
const { RESOURCE, NAME } = require('./quickbooks-production-prepare.cjs');
function revision(enabled) { return { spec: { serviceAccountName: 'synthetic', timeoutSeconds: 60,
  containers: [{ image: 'us-central1-docker.pkg.dev/synthetic/gcf-artifacts/function:build', env: [
    { name: 'QBO_PRODUCTION_ENABLED', value: String(enabled) }, { name: 'QBO_PRODUCTION_OWNER_UID', value: 'owner' },
    { name: 'QBO_PRODUCTION_TOKEN_KEY', valueFrom: { secretKeyRef: { name: 'key', key: '1' } } }],
    resources: { limits: { memory: '256Mi' } } }] }, status: { imageDigest: 'synthetic-digest' } }; }
test('historical revision spec permits only activation and independently reported image identity', () => {
  const before = revision(false), after = revision(true); after.spec.containers[0].image += '-next';
  assert.deepEqual(compareRevisions(before, after), { revisionSpecVerified: true, imageReferenceChanged: true, imageDigestChanged: false });
  for (const mutate of [r => r.spec.containers[0].env[1].value = 'different',
    r => r.spec.containers[0].env[2].valueFrom.secretKeyRef.key = '2', r => r.spec.timeoutSeconds = 120,
    r => r.spec.serviceAccountName = 'other', r => r.spec.containers.push(r.spec.containers[0]),
    r => r.spec.containers[0].env[0].value = 'false']) {
    const bad = structuredClone(after); mutate(bad); assert.throws(() => compareRevisions(before, bad));
  }
});
test('other function update-time evidence fails closed on missing timestamps or concurrent changes', () => {
  const entries = [{ name: RESOURCE + NAME, updatedAt: '2026-10-13T17:04:00Z' },
    { name: RESOURCE + 'quickbooksSandbox', updatedAt: '2026-10-12T18:00:00Z' }];
  assert.equal(verifyOtherUpdateTimes(entries), 1);
  for (const updatedAt of [undefined, 'bad', '2026-10-13T17:03:00Z']) assert.throws(() =>
    verifyOtherUpdateTimes([entries[0], { ...entries[1], updatedAt }]));
  assert.throws(() => verifyOtherUpdateTimes([entries[0]]));
});
