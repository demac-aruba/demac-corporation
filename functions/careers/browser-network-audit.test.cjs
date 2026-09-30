'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { auditNetworkEvents } = require('./browser-network-audit.cjs');
const site = 'http://127.0.0.1:4174';
const head = () => ({ phase: 'initial-read', origin: site, path: '/dashboard/', method: 'HEAD', type: 'fetch', error: 'net::ERR_ABORTED', response: { status: 200, contentType: 'text/html; charset=utf-8' } });
const tree = () => ({ phase: 'initial-read', origin: site, path: '/dashboard/__next._tree.txt', method: 'GET', type: 'fetch', response: { status: 200 } });
test('bodyless metadata is consumed only with an actual completed same-route tree', () => {
  const event = head(), proof = tree();
  assert.deepEqual(auditNetworkEvents([event], [proof], site), { metadataCompletions: [event], failures: [] });
});
test('a resolved header alone never certifies a completed navigation', () => {
  const event = head();
  assert.deepEqual(auditNetworkEvents([event], [], site), { metadataCompletions: [], failures: [event] });
});
for (const change of [
  { method: 'GET' }, { method: 'POST' }, { type: 'document' }, { type: 'script' },
  { origin: 'http://127.0.0.1:4175' }, { origin: 'https://example.test' },
  { error: 'net::ERR_CONNECTION_RESET' }, { error: 'net::ERR_FAILED' },
  { response: null }, { response: { status: 404, contentType: 'text/html' } },
  { response: { status: 503, contentType: 'text/html' } },
  { response: { status: 301, contentType: 'text/html' } },
  { response: { status: 200, contentType: 'application/json' } },
]) test(`failure is retained: ${JSON.stringify(change)}`, () => {
  const event = { ...head(), ...change };
  assert.deepEqual(auditNetworkEvents([event], [tree()], site).failures, [event]);
});
for (const change of [
  { phase: 'reload' }, { origin: 'http://127.0.0.1:4175' },
  { path: '/different/__next._tree.txt' }, { method: 'HEAD' }, { type: 'document' },
  { response: null }, { response: { status: 404 } }, { response: { status: 503 } },
  { response: { status: 204 } },
]) test(`unrelated or unsuccessful follow-up is not proof: ${JSON.stringify(change)}`, () => {
  const event = head();
  assert.deepEqual(auditNetworkEvents([event], [{ ...tree(), ...change }], site).failures, [event]);
});
test('a real failure is not hidden among matching metadata completions', () => {
  const accepted = head(), failed = { ...head(), method: 'POST' };
  assert.deepEqual(auditNetworkEvents([accepted, failed], [tree()], site), { metadataCompletions: [accepted], failures: [failed] });
});
test('root and slashless static routes match only their exact tree', () => {
  for (const pathname of ['/', '/dashboard']) {
    const event = { ...head(), path: pathname }, proof = { ...tree(), path: `${pathname.replace(/\/$/, '')}/__next._tree.txt` };
    assert.equal(auditNetworkEvents([event], [proof], site).metadataCompletions.length, 1);
  }
});
test('audit does not mutate or discard raw request evidence', () => {
  const event = head(), proof = tree(), before = JSON.stringify([event, proof]);
  const result = auditNetworkEvents([event], [proof], site);
  assert.equal(JSON.stringify([event, proof]), before); assert.equal(result.metadataCompletions[0], event);
});
