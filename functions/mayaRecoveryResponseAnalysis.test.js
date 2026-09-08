'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRecoveryResponse, validateDecision, TOOL } = require('./mayaRecoveryResponseAnalysis');
const input = { offerText: 'Would you like to move Thursday to Tuesday at 09:30?', customerText: 'Yes, please.', apiKey: 'synthetic-not-a-credential' };
const decision = { decision: 'accept', quote: 'Yes, please.', confidence: 0.99, ambiguous: false };
const payload = value => ({ status: 'completed', output: [{ type: 'function_call', name: TOOL.name, arguments: JSON.stringify(value) }] });
const transport = value => async () => ({ ok: true, json: async () => value });
test('response analysis uses one forced strict tool, no model storage and bounded content', async () => {
  let sent;
  const result = await analyzeRecoveryResponse({ ...input, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); sent = JSON.parse(options.body);
    assert.ok(options.signal); return { ok: true, json: async () => payload(decision) };
  } });
  assert.deepEqual(result, decision); assert.equal(sent.store, false); assert.equal(sent.parallel_tool_calls, false);
  assert.equal(sent.tools.length, 1); assert.equal(sent.tools[0].strict, true); assert.equal(sent.tool_choice.name, TOOL.name);
  assert.equal(sent.max_output_tokens, 900); assert.match(sent.instructions, /conditional agreement/);
  assert.equal(JSON.parse(sent.input[0].content).customerResponse, input.customerText);
});
test('decline and ambiguity remain non-accept decisions', async () => {
  for (const choice of ['decline', 'needs_review']) {
    const result = await analyzeRecoveryResponse({ ...input, fetchImpl: transport(payload({ ...decision, decision: choice })) });
    assert.equal(result.decision, choice);
  }
});
for (const [label, result] of [
  ['incomplete', { ...payload(decision), status: 'incomplete' }],
  ['no call', { status: 'completed', output: [] }],
  ['two calls', { status: 'completed', output: [...payload(decision).output, ...payload(decision).output] }],
  ['wrong tool', { status: 'completed', output: [{ type: 'function_call', name: 'other_tool', arguments: '{}' }] }],
  ['malformed JSON', { status: 'completed', output: [{ type: 'function_call', name: TOOL.name, arguments: '{' }] }],
]) {
  test(`response analysis rejects ${label}`, async () => {
    await assert.rejects(() => analyzeRecoveryResponse({ ...input, fetchImpl: transport(result) }), /Recovery offer could not be completed/);
  });
}
test('extra keys, coerced types, invented quotes and invalid numeric confidence are rejected', () => {
  for (const value of [{ ...decision, extra: true }, { ...decision, confidence: '0.99' }, { ...decision, confidence: Infinity },
    { ...decision, confidence: -1 }, { ...decision, ambiguous: 'false' }, { ...decision, quote: 'invented' }, null, []]) {
    assert.throws(() => validateDecision(value, input.customerText), error => error.code === 'recovery_response_analysis_invalid');
  }
});
test('provider diagnostics and credential-like text are not returned on failure', async () => {
  await assert.rejects(() => analyzeRecoveryResponse({ ...input, fetchImpl: async () => { throw new Error('PRIVATE_DIAGNOSTIC'); } }), error => {
    assert.equal(error.code, 'recovery_response_analysis_unavailable'); assert.doesNotMatch(error.message, /PRIVATE_DIAGNOSTIC|synthetic/); return true;
  });
  await assert.rejects(() => analyzeRecoveryResponse({ ...input, fetchImpl: async () => ({ ok: false }) }),
    error => error.code === 'recovery_response_analysis_unavailable');
});
test('oversized source is blocked before transport and no key means no request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('must not call'); };
  await assert.rejects(() => analyzeRecoveryResponse({ ...input, customerText: 'x'.repeat(8001), fetchImpl }));
  await assert.rejects(() => analyzeRecoveryResponse({ ...input, apiKey: '', fetchImpl }));
  assert.equal(called, false);
});
