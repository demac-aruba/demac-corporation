'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectRegistryHttp, MAX_BODY_BYTES } = require('./registry-http');
const request = (patch = {}) => ({ method: 'POST', headers: { origin: 'https://erp.example.test', authorization: 'Bearer TEST-TOKEN', 'content-type': 'application/json' }, body: { action: 'list_plans', data: {} }, ...patch });
function make(execute) { return createProjectRegistryHttp({ service: { execute }, allowedOrigins: ['https://erp.example.test'] }); }
test('HTTP delegates the exact command to the existing authenticated service', async () => {
  const command = { action: 'edit_metadata', requestId: 'RETRY-TEST', data: { projectId: 'P-TEST', expectedVersion: 2, patch: { name: 'Synthetic' } } };
  const response = await make(async (input) => { assert.equal(input.idToken, 'TEST-TOKEN'); assert.deepEqual(input.command, command); return { success: true, projectId: 'P-TEST', version: 3 }; })(request({ body: command }));
  assert.equal(response.status, 200); assert.equal(response.body.data.version, 3);
  assert.match(response.headers['Cache-Control'], /no-store/); assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://erp.example.test');
});
test('unapproved origins, methods, media and absent tokens never call the service', async () => {
  const handler = make(() => assert.fail('Must not call service'));
  for (const [patch, expected] of [[{ headers: { origin: 'https://evil.example' } }, 403], [{ method: 'GET' }, 405], [{ headers: { 'content-type': 'text/plain' } }, 415], [{ headers: { 'content-type': 'application/json' } }, 401]]) {
    assert.equal((await handler(request(patch))).status, expected);
  }
});
test('CORS preflight is explicit and never enables wildcard credentials', async () => {
  const handler = make(() => assert.fail('No auth or writes during preflight'));
  const result = await handler(request({ method: 'OPTIONS', headers: { origin: 'https://erp.example.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } }));
  assert.equal(result.status, 204); assert.equal(result.headers['Access-Control-Allow-Credentials'], undefined);
  assert.equal((await handler(request({ method: 'OPTIONS', headers: { 'access-control-request-method': 'DELETE' } }))).status, 405);
});
test('large raw or parsed bodies are rejected before service execution', async () => {
  const handler = make(() => assert.fail('No call for oversized body'));
  assert.equal((await handler(request({ rawBody: Buffer.alloc(MAX_BODY_BYTES + 1) }))).status, 413);
  assert.equal((await handler(request({ body: { raw: 'x'.repeat(MAX_BODY_BYTES) } }))).status, 413);
});
test('missing Origin still requires authentication; CORS is not authorization', async () => {
  const result = await make(async () => { throw Object.assign(new Error('not provisioned'), { code: 'forbidden', status: 403 }); })(request({ headers: { authorization: 'Bearer TEST-TOKEN', 'content-type': 'application/json' } }));
  assert.equal(result.status, 403); assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
});
test('unknown backend failures redact messages and preserve ambiguous outcome', async () => {
  const result = await make(async () => { throw new Error('PRIVATE CUSTOMER SECRET TOKEN'); })(request());
  assert.equal(result.status, 503); assert.equal(result.body.error.outcome, 'unknown');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('version conflicts are explicit rejections without exposing internal data', async () => {
  const result = await make(async () => { throw Object.assign(new Error('PRIVATE'), { code: 'version_conflict', status: 409 }); })(request());
  assert.equal(result.status, 409); assert.equal(result.body.error.outcome, 'rejected'); assert.match(result.body.error.message, /Another operator/);
});
