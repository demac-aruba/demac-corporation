"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packageTelemetry } = require('./performanceTelemetryPackage.cjs');

test('deployment source contains only observability, never operational functions', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'demac-telemetry-package-'));
  try {
    const target = packageTelemetry(path.join(parent, 'source'));
    assert.deepEqual(fs.readdirSync(target).sort(), ['index.js', 'package.json', 'performanceTelemetry.js', 'performanceTelemetryCore.js', 'performanceTelemetryService.js']);
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['firebase-admin', 'firebase-functions']);
    assert.equal(manifest.main, 'index.js');
    assert.ok(!fs.existsSync(path.join(target, 'bootstrap.js')));
    assert.ok(!fs.existsSync(path.join(target, 'officeBookingAuthority.js')));
    assert.throws(() => packageTelemetry(target), /empty/);
    assert.throws(() => packageTelemetry(path.join(__dirname, 'accidental-output')), /outside/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
