'use strict';

// Test-only fault injection. No service, credentials, database or browser APIs are imported.
const assert = require('node:assert/strict');

function createCommittedResponseFault() {
  let state = null;
  return {
    arm(projectId, action = 'edit_metadata') {
      assert.equal(state, null, 'Finish the previous fault scenario before arming another');
      assert.ok(typeof projectId === 'string' && projectId.length > 0);
      assert.ok(['edit_metadata', 'revise_estimate'].includes(action));
      state = { projectId, action, command: null, requestId: null, version: null, attempts: 0, commits: 0, replays: 0, released: false };
    },
    observe(command, response) {
      if (!state || command?.action !== state.action || command.data?.projectId !== state.projectId) return false;
      if (response.status !== 200) return false;
      const receipt = response.body?.data;
      assert.equal(response.body?.success, true);
      assert.equal(receipt?.success, true);
      assert.equal(receipt.projectId, state.projectId);
      assert.ok(Number.isSafeInteger(receipt.version) && receipt.version > 0);
      const serialized = JSON.stringify(command);
      if (state.command === null) {
        assert.equal(receipt.replayed, false, 'The fault must start after a new server commit');
        state.command = serialized;
        state.requestId = command.requestId;
        state.version = receipt.version;
      }
      assert.equal(serialized, state.command, 'Retries must preserve the exact command and request ID');
      assert.equal(receipt.version, state.version, 'Retries must not advance the project version');
      state.attempts += 1;
      if (receipt.replayed) state.replays += 1;
      else state.commits += 1;
      assert.equal(state.commits, 1, 'A lost response must not produce another commit');
      // Stay broken until the test explicitly restores the connection. Transport-level
      // retries cannot accidentally turn a lost-response scenario into a success scenario.
      return !state.released;
    },
    pendingCommand() {
      assert.ok(state?.command, 'No committed request has been intercepted');
      return JSON.parse(state.command);
    },
    snapshot() {
      assert.ok(state, 'No fault scenario is active');
      const { command, ...summary } = state;
      return { ...summary };
    },
    releaseForExactRetry() {
      assert.ok(state && state.attempts > 0 && state.commits === 1 && !state.released);
      state.released = true;
    },
    finish() {
      assert.ok(state?.released, 'The test never restored the connection');
      assert.equal(state.commits, 1);
      assert.ok(state.replays >= 1, 'An explicit retry must recover the existing receipt');
      const { command, ...summary } = state;
      state = null;
      return summary;
    },
  };
}

function interruptResponse(response) {
  // Send headers and a deliberately incomplete body. Destroying an unused socket alone
  // can be retried transparently; a partial body also exercises response.text() rejection.
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': '128',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  response.flushHeaders();
  response.write('{"success":', () => response.destroy());
}

module.exports = { createCommittedResponseFault, interruptResponse };
