'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./whatsapp-cutover-release.cjs');
test('release health probe receives its script through stdin without external side effects on import', () => {
  const result = run(process.execPath, ['-e', 'let text="";process.stdin.on("data",d=>text+=d);process.stdin.on("end",()=>process.stdout.write(text));'], {input:'synthetic-health-script'});
  assert.equal(result,'synthetic-health-script');
});
