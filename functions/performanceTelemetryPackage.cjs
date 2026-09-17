"use strict";

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const SOURCES = Object.freeze({
  'performanceTelemetryEntry.js': 'index.js',
  'performanceTelemetry.js': 'performanceTelemetry.js',
  'performanceTelemetryCore.js': 'performanceTelemetryCore.js',
  'performanceTelemetryService.js': 'performanceTelemetryService.js',
});
function packageTelemetry(destination) {
  const repo = path.resolve(__dirname, '..');
  const target = path.resolve(destination);
  // Only a new empty external staging directory; never overwrite the repository.
  if (target === repo || target.startsWith(`${repo}${path.sep}`)) throw new Error('Deployment staging must be outside the repository.');
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || fs.readdirSync(target).length)) throw new Error('Deployment staging must be empty and not a symlink.');
  fs.mkdirSync(target, { recursive: true });
  for (const [source, output] of Object.entries(SOURCES)) fs.copyFileSync(path.join(__dirname, source), path.join(target, output));
  const operational = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const dependencies = {};
  for (const name of ['firebase-admin', 'firebase-functions']) {
    const version = operational.dependencies?.[name];
    assert.equal(typeof version, 'string', `Missing dependency ${name}`);
    dependencies[name] = version;
  }
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({ name: 'demac-performance-telemetry', version: '2.0.0', private: true, main: 'index.js', engines: { node: '22' }, dependencies }, null, 2)}\n`);
  return target;
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Supply an isolated deployment directory.');
  console.log(packageTelemetry(process.argv[2]));
}
module.exports = { SOURCES, packageTelemetry };
