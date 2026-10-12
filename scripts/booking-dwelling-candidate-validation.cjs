'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const focused = ['appointmentNotificationService.test.js', 'technicianDailyScheduleService.test.js', 'technicianScheduleChangeService.test.js'];
const office = ['officeBookingAuthority.test.js', 'officeBookingAuthorityCommunication.test.js', 'officeBookingAuthorityCatalog.test.js', 'officeBookingAuthorityMasterData.test.js',
  'officeBookingAuthorityFacadeProject.test.js', 'officeBookingAuthorityFacadePartial.test.js', 'officeBookingAuthorityPartialWrapper.test.js', 'bookingPartialCompletion.test.js',
  'bookingAuthorityWorkOrders.test.js', 'bookingOperationalMove.test.js', 'projectOperatorBooking.test.js', 'bookingSpotsIndependentReview.test.js'];
function validateLock(content, manifest) {
  const lock = JSON.parse(content);
  assert.ok(lock.lockfileVersion >= 2 && lock.packages?.[''], 'Verifiable npm lock required');
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies, 'Lock declarations differ');
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.ok(name.startsWith('node_modules/') && !name.split('/').includes('..') && !pkg.link, 'Unexpected package path');
    assert.ok(pkg.version && /^sha(256|384|512)-[A-Za-z0-9+/]+=*$/.test(pkg.integrity || ''), 'Unpinned package: ' + name);
    const url = new URL(pkg.resolved);
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'registry.npmjs.org');
    assert.equal(url.username + url.password + url.search, '', 'Dependency URL contains credentials or query');
  }
  for (const name of Object.keys(manifest.dependencies)) assert.ok(lock.packages['node_modules/' + name], 'Missing direct dependency');
  return lock;
}
function validateCandidate({ source, root, out, env, candidate, reconstruct, name, selectedTests = focused }) {
  const lockBytes = fs.readFileSync(path.join(source, 'package-lock.json'));
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  validateLock(lockBytes, pkg);
  const digest = crypto.createHash('sha256').update(lockBytes).digest('hex');
  const dependencies = path.join(out, 'dependencies-' + digest);
  const run = (command, args, cwd, isolated = env) => {
    try { return execFileSync(command, args, { cwd, env: isolated, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 40 * 1024 * 1024 }); }
    catch (error) {
      const safe = String(error.stdout || '').split('\n').filter(line => /not ok|error:|Expected|actual:|expected:|fail |Error:|Cannot find module|SyntaxError/.test(line));
      const stderr = String(error.stderr || '');
      const code = stderr.match(/npm error code ([A-Z0-9_]+)/)?.[1];
      if (code) safe.push('npm failure code: ' + code);
      if (/Cannot find module/.test(stderr)) safe.push('Runtime dependency missing');
      const missingExport = stderr.match(/Runtime export missing: ([a-zA-Z]+)/)?.[1];
      if (missingExport) safe.push('Runtime export missing: ' + missingExport);
      if (/Synthetic audit rejected a non-loopback connection/.test(stderr)) safe.push('Synthetic network isolation rejected a non-loopback connection');
      console.error(name + ': ' + safe.join('\n')); throw error;
    }
  };
  if (!fs.existsSync(dependencies)) {
    fs.mkdirSync(dependencies);
    fs.copyFileSync(path.join(source, 'package.json'), path.join(dependencies, 'package.json'));
    fs.writeFileSync(path.join(dependencies, 'package-lock.json'), lockBytes);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], dependencies);
    assert.deepEqual(fs.readFileSync(path.join(dependencies, 'package-lock.json')), lockBytes, 'Clean install changed lock');
  }
  const validation = source + '-test'; fs.cpSync(source, validation, { recursive: true });
  if (candidate) {
    for (const file of selectedTests) fs.copyFileSync(path.join(root, 'functions', file), path.join(validation, file));
    fs.cpSync(path.join(root, 'functions/test-support'), path.join(validation, 'test-support'), { recursive: true });
    if (reconstruct) fs.copyFileSync(path.join(root, 'functions/propertyLocations.emulator.test.cjs'), path.join(validation, 'propertyLocations.emulator.test.cjs'));
  }
  fs.symlinkSync(path.join(dependencies, 'node_modules'), path.join(validation, 'node_modules'), 'dir');
  const networkGuard = path.join(root, 'scripts/booking-dwelling-test-network.cjs');
  const testEnv = { ...env, NODE_OPTIONS: '--require=' + networkGuard };
  const counts = [];
  const pass = output => {
    assert.match(output, /(?:#|ℹ) fail 0/); assert.match(output, /(?:#|ℹ) skipped 0/);
    const matched = output.match(/(?:#|ℹ) tests (\d+)/); assert.ok(matched, 'Missing test count'); counts.push(Number(matched[1]));
  };
  if (reconstruct) {
    // The deployed source's own original tests check the reconstructed baseline.
    // Candidate overlays only tests for the intended message behavior.
    for (const script of ['test:booking-authority', 'test:transactional-whatsapp']) {
      assert.ok(pkg.scripts[script], 'Missing original regression script');
      pass(run('npm', ['run', script], validation, testEnv));
    }
    for (const file of office) assert.ok(fs.existsSync(path.join(validation, file)), 'Missing Office regression: ' + file);
    pass(run(process.execPath, ['--test', ...office], validation, testEnv));
    const emulatorEnv = { ...env, GCLOUD_PROJECT: 'demo-demac-dwellings', GOOGLE_CLOUD_PROJECT: 'demo-demac-dwellings',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8297', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9297', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9397' };
    assert.ok(fs.existsSync(path.join(validation, 'propertyLocations.emulator.test.cjs')), 'Missing saved-booking emulator suite');
    const command = [process.execPath, '--require', networkGuard, '--test', path.join(validation, 'propertyLocations.emulator.test.cjs')].map(value => "'" + value.replace(/'/g, "'\\''") + "'").join(' ');
    pass(run('npx', ['--yes', 'firebase-tools@15.30.0', 'emulators:exec', '--only', 'firestore', '--project', 'demo-demac-dwellings', '--config', path.join(root, 'firebase.dwellings-preview.json'), command], root, emulatorEnv));
  } else pass(run(process.execPath, ['--test', ...selectedTests], validation, testEnv));
  const smoke = run(process.execPath, [path.join(root, 'scripts/booking-dwelling-runtime-smoke.cjs'), validation, name.replace(/-(baseline|candidate)$/, '')], validation, testEnv);
  assert.match(smoke, /PASS: real bootstrap/);
  fs.rmSync(validation, { recursive: true });
  return { dependencyLockSha256: digest, cleanInstall: true, testCounts: counts, testsPassed: counts.reduce((a, b) => a + b, 0), runtimeSmokePassed: true };
}
module.exports = { validateCandidate, validateLock };
