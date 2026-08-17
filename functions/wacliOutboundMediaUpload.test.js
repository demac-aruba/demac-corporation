const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, 'wacliOutboundMediaUpload.js'), 'utf8');

test('outbound media upload requires operations authorization after Firebase authentication', () => {
  assert.match(source, /authorizedOperationsUser\(user\.uid\)/);
  assert.match(source, /OPERATIONS_ROLES\s*=\s*new Set\(\["admin", "office", "supervisor"\]\)/);
  assert.match(source, /profile\.active === true/);
  assert.match(source, /response\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
});

test('outbound media upload blocks active-content file types by MIME and extension', () => {
  for (const value of ['text/html', 'application/xhtml+xml', 'image/svg+xml']) assert.match(source, new RegExp(value.replace('/', '\\/')));
  for (const extension of ['html', 'htm', 'xhtml', 'svg']) assert.match(source, new RegExp(`\\b${extension}\\b`));
});

test('outbound media upload remains isolated from bridge credentials', () => {
  assert.doesNotMatch(source, /WACLI_BRIDGE_TOKEN|WACLI_BRIDGE_URL|WACLI_WEBHOOK_SECRET/);
});
