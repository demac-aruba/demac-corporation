const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const bridgePath = path.join(__dirname, "..", "ops", "digitalocean", "deploy", "server-v2.mjs");

function source() {
  return fs.readFileSync(bridgePath, "utf8");
}

test("deployed DigitalOcean bridge requires an explicit communication account binding", () => {
  const code = source();
  assert.match(code, /process\.env\.COMMUNICATION_ACCOUNT_ID/);
  assert.match(code, /missing\.push\('COMMUNICATION_ACCOUNT_ID'\)/);
  assert.match(code, /X-Demac-Communication-Account-Id/);
});

test("all bridge-to-Firebase requests use the centralized account-bound header helper", () => {
  const code = source();
  assert.match(code, /function firebaseConnectorHeaders\(extra = \{\}\)/);
  assert.match(code, /headers: firebaseConnectorHeaders\(\{ 'Content-Type': mimeType/);
  assert.match(code, /headers: firebaseConnectorHeaders\(\{ 'Content-Type': 'application\/json' \}\)/);
});

test("bridge rejects an outbound command returned for another communication account", () => {
  const code = source();
  assert.match(code, /commandAccountId !== COMMUNICATION_ACCOUNT_ID/);
  assert.match(code, /different communication account/);
});
