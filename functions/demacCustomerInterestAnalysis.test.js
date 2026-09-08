'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REVIEW_TOOL, analyzeInterestHistory, instructions, parseReview } = require('./demacCustomerInterestAnalysis');

function payload(decisions = []) {
  return { status: 'completed', output: [{ type: 'function_call', name: REVIEW_TOOL.name, arguments: JSON.stringify({ decisions }) }] };
}
test('analysis adapter uses one forced strict tool, a bounded request, no storage and the existing model contract', async () => {
  let captured;
  const result = await analyzeInterestHistory({ context: { messages: [{ direction: 'inbound', text: 'Can you come earlier?' }] },
    apiKey: 'synthetic-test-key', model: 'controlled-test-model', fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => payload() };
    } });
  assert.deepEqual(result, []); assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.options.method, 'POST'); assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(captured.body.model, 'controlled-test-model'); assert.equal(captured.body.store, false);
  assert.equal(captured.body.parallel_tool_calls, false); assert.equal(captured.body.max_output_tokens, 3200);
  assert.deepEqual(captured.body.tool_choice, { type: 'function', name: REVIEW_TOOL.name });
  assert.equal(captured.body.tools.length, 1); assert.equal(captured.body.tools[0].strict, true);
  assert.doesNotMatch(JSON.stringify(captured.body), /synthetic-test-key/);
});
for (const [label, mutate] of [
  ['incomplete response', value => ({ ...value, status: 'incomplete' })],
  ['incomplete details', value => ({ ...value, incomplete_details: { reason: 'max_output_tokens' } })],
  ['provider error', value => ({ ...value, error: { message: 'private details' } })],
  ['missing function call', value => ({ ...value, output: [] })],
  ['multiple function calls', value => ({ ...value, output: [...value.output, ...value.output] })],
  ['wrong function', value => ({ ...value, output: [{ ...value.output[0], name: 'send_message' }] })],
  ['malformed JSON', value => ({ ...value, output: [{ ...value.output[0], arguments: '{broken' }] })],
  ['extra root properties', value => ({ ...value, output: [{ ...value.output[0], arguments: '{"decisions":[],"send":true}' }] })],
  ['too many decisions', () => payload(Array(11).fill({}))],
]) test(`structured interest analysis rejects ${label}`, () => {
  assert.throws(() => parseReview(mutate(payload())), error => error.code === 'interest_review_failed');
});
test('provider/network failures expose only a stable safe error', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'private diagnostic' } }) }),
    async () => { throw new Error('private diagnostic'); },
    async () => ({ ok: true, json: async () => { throw new Error('private diagnostic'); } }),
  ]) {
    await assert.rejects(() => analyzeInterestHistory({ context: {}, apiKey: 'synthetic-test-key', fetchImpl }), error => {
      assert.equal(error.code, 'interest_review_failed'); assert.doesNotMatch(error.message, /private/); return true;
    });
  }
});
test('missing credentials prevent any network call', async () => {
  let calls = 0;
  await assert.rejects(() => analyzeInterestHistory({ context: {}, apiKey: '', fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
});
test('the semantic contract treats transcript instructions as untrusted and distinguishes thanks from withdrawal', () => {
  const text = instructions();
  assert.match(text, /untrusted conversation data/);
  assert.match(text, /thank-you/); assert.match(text, /later customer statements override/i);
  assert.match(text, /Only customer\/inbound messages are evidence/);
  assert.match(text, /pap-aw/); assert.match(text, /Never cancel the appointment/);
});
