'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assetUrls } = require('./projects-central-static-assets.cjs');

test('the same physical Next segment is addressable from Windows and POSIX exports', () => {
  assert.deepEqual(assetUrls('field\\__next.!KGVycCk\\field\\__PAGE__.txt'), [
    '/field/__next.!KGVycCk/field/__PAGE__.txt', '/field/__next.!KGVycCk.field.__PAGE__.txt',
  ]);
  assert.deepEqual(assetUrls('field/__next.!KGVycCk.field.__PAGE__.txt'), ['/field/__next.!KGVycCk.field.__PAGE__.txt']);
});
test('normal assets and missing segments never receive a guessed fallback', () => {
  assert.deepEqual(assetUrls('field/index.html'), ['/field/index.html']);
  assert.deepEqual(assetUrls('field/__next._head.txt'), ['/field/__next._head.txt']);
  const assets = new Map(assetUrls('field/__next.!KGVycCk/field.txt').map(url => [url, 'actual-file']));
  assert.equal(assets.get('/field/__next.!KGVycCk.missing.txt'), undefined);
});
