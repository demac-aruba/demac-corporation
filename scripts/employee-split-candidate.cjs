'use strict';
// The live WorkOrder package predates lockfile retention. Generate a lock ONLY
// in a disposable validation copy; neither baseline nor deployed packaging changes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { validateCandidate } = require('./booking-dwelling-candidate-validation.cjs');
function validateAttendanceCandidate(options) {
  const { source, out, env } = options;
  const before = manifest(source);
  if (before['package-lock.json']) return validateCandidate(options);
  const validation = source + '-validation-input';
  fs.cpSync(source, validation, { recursive: true });
  const dependencyDir = path.join(out, 'attendance-test-dependencies');
  if (!fs.existsSync(dependencyDir)) {
    fs.mkdirSync(dependencyDir);
    fs.copyFileSync(path.join(source, 'package.json'), path.join(dependencyDir, 'package.json'));
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dependencyDir, env, stdio: ['ignore','pipe','pipe'] });
  }
  assert.deepEqual(fs.readFileSync(path.join(dependencyDir, 'package.json')), fs.readFileSync(path.join(source, 'package.json')));
  fs.copyFileSync(path.join(dependencyDir, 'package-lock.json'), path.join(validation, 'package-lock.json'));
  try {
    const result = validateCandidate({ ...options, source: validation });
    assert.deepEqual(manifest(source), before, 'Validation mutated production package');
    return { ...result, validationOnlyLock: true, productionDependencyDeclarationsPreserved: true };
  } finally { fs.rmSync(validation, { recursive: true, force: true }); }
}
module.exports = { validateAttendanceCandidate };
