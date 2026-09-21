'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createCommittedResponseFault, interruptResponse } = require('./projects-central-response-fault.cjs');
const command = { action: 'edit_metadata', requestId: 'TEST-EXACT-REQUEST', data: { projectId: 'TEST-PROJECT', expectedVersion: 3, patch: { description: 'Synthetic' } } };
const receipt = (replayed = false, version = 4) => ({ status: 200, body: { success: true, data: { success: true, projectId: 'TEST-PROJECT', version, changed: true, replayed } } });

test('fault survives repeated transport attempts until explicit recovery', () => {
  const fault = createCommittedResponseFault(); fault.arm('TEST-PROJECT');
  assert.equal(fault.observe(command, receipt()), true);
  assert.equal(fault.observe(structuredClone(command), receipt(true)), true);
  assert.deepEqual(fault.pendingCommand(), command);
  assert.equal(fault.snapshot().commits, 1);
  fault.releaseForExactRetry();
  assert.equal(fault.observe(command, receipt(true)), false);
  assert.equal(fault.finish().replays, 2);
});
test('mutated retry and duplicate commit are failures, never waived', () => {
  const fault = createCommittedResponseFault(); fault.arm('TEST-PROJECT'); fault.observe(command, receipt());
  assert.throws(() => fault.observe({ ...command, requestId: 'REPLACEMENT-ID' }, receipt(true)), /exact command/);
  assert.throws(() => fault.observe(command, receipt(true, 5)), /advance the project version/);
  assert.throws(() => fault.observe(command, receipt(false)), /another commit/);
});
test('reads and failed writes do not arm or satisfy the lost-response case', () => {
  const fault = createCommittedResponseFault(); fault.arm('TEST-PROJECT');
  assert.equal(fault.observe({ action: 'get_plan', data: { projectId: 'TEST-PROJECT' } }, receipt()), false);
  assert.equal(fault.observe(command, { status: 409, body: {} }), false);
  assert.throws(() => fault.releaseForExactRetry());
  assert.throws(() => fault.finish());
});

test('estimate response loss is action-scoped and retains the exact revision', () => {
  const fault = createCommittedResponseFault(); fault.arm('TEST-PROJECT', 'revise_estimate');
  const revision = { action: 'revise_estimate', requestId: 'REVISION-REQUEST', data: { projectId: 'TEST-PROJECT', expectedVersion: 3, budgetedVanMinutes: 4200, reason: 'Reviewed estimate' } };
  assert.equal(fault.observe(command, receipt()), false);
  assert.equal(fault.observe(revision, receipt()), true);
  assert.deepEqual(fault.pendingCommand(), revision);
  fault.releaseForExactRetry();
  assert.equal(fault.observe(revision, receipt(true)), false);
  assert.equal(fault.finish().commits, 1);
});
test('real loopback fetch rejects a truncated body after one synthetic commit', async () => {
  const fault = createCommittedResponseFault(); fault.arm('TEST-PROJECT');
  let commits = 0;
  const seen = new Set();
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const replayed = seen.has(input.requestId);
    if (!replayed) { seen.add(input.requestId); commits += 1; }
    const result = receipt(replayed);
    if (fault.observe(input, result)) return interruptResponse(response);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
    return JSON.parse(await response.text());
  };
  try {
    await assert.rejects(send());
    await assert.rejects(send());
    assert.equal(commits, 1);
    fault.releaseForExactRetry();
    const result = await send();
    assert.equal(result.data.replayed, true);
    assert.equal(commits, 1);
    assert.equal(fault.finish().commits, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('material revision response loss cannot be satisfied by another budget action', () => {
  const fault=createCommittedResponseFault();fault.arm('TEST-PROJECT','revise_material_budget');
  const revision={action:'revise_material_budget',requestId:'MATERIAL-REQUEST',data:{projectId:'TEST-PROJECT',expectedVersion:3,materialBudget:{currency:'AWG',amountMinor:12345},reason:'Reviewed materials'}};
  assert.equal(fault.observe({...revision,action:'revise_estimate'},receipt()),false);
  assert.equal(fault.observe(revision,receipt()),true);
  fault.releaseForExactRetry();
  assert.throws(()=>fault.observe({...revision,data:{...revision.data,materialBudget:null}},receipt(true)),/exact command/);
  assert.equal(fault.observe(revision,receipt(true)),false);assert.equal(fault.finish().commits,1);
});
