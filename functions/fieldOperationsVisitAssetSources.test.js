const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalVisitAssetAttachSource } = require('./fieldOperationsVisitAssets');

test('server-owned VisitAsset attach source defaults to existing asset and permits governed discovery origins', () => {
  assert.equal(canonicalVisitAssetAttachSource(), 'existing_asset');
  assert.equal(canonicalVisitAssetAttachSource('existing_asset'), 'existing_asset');
  assert.equal(canonicalVisitAssetAttachSource('registered_on_site'), 'registered_on_site');
  assert.equal(canonicalVisitAssetAttachSource('qr_scan'), 'qr_scan');
});

test('scheduled and arbitrary client-style origins cannot enter the attach command', () => {
  for (const source of ['scheduled', 'client_override', '']) {
    if (source === '') {
      assert.equal(canonicalVisitAssetAttachSource(source), 'existing_asset');
    } else {
      assert.throws(
        () => canonicalVisitAssetAttachSource(source),
        (error) => error?.code === 'invalid_visit_asset_source' && error?.status === 400,
      );
    }
  }
});
