const assert = require('node:assert/strict');
const test = require('node:test');

test('deployable Functions bootstrap exports Field Operations Authority', () => {
  const deployed = require('./bootstrap');
  assert.equal(typeof deployed.fieldOperationsAuthority, 'function');
});
