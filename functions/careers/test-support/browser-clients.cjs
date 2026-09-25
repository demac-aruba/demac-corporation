'use strict';
// Test-only trusted network identities for independently isolated browser journeys.
// Never imported by the deployed HTTP handler. All actual traffic remains loopback.
const crypto = require('node:crypto');
function createBrowserClients() {
  const clients = new Map();
  const header = 'x-careers-emulator-client';
  function register() {
    if (clients.size >= 254) throw Error('Too many isolated test clients.');
    const token = crypto.randomUUID();
    clients.set(token, `192.0.2.${clients.size + 1}`);
    return token;
  }
  function address(token) {
    if (!clients.has(token)) throw Error('Unregistered emulator browser client.');
    return clients.get(token);
  }
  function requestAddress(method, token) {
    // Browsers create CORS preflights outside Playwright's intercepted POST.
    // They carry no test-client token. The unchanged HTTP handler validates
    // their Origin and returns before auth, rate limiting or service access.
    if (method === 'OPTIONS') return '127.0.0.1';
    return address(token);
  }
  return { header, register, address, requestAddress };
}
module.exports = { createBrowserClients };
