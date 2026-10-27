'use strict';
// Read-only source inspection. Never invokes business functions or reads customers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { releaseConfig, runtimeSourceHash, safePaths, isolatedTestEnv } = require('./booking-dwelling-release.cjs');
const { validateCandidate, validateLock } = require('./booking-dwelling-candidate-validation.cjs');
const { validateAttendanceCandidate } = require('./employee-split-candidate.cjs');
const { verifyTraffic } = require('./appointment-finance-release.cjs');
const PROJECT = 'demac-corporation';
const TARGETS = ['officeBookingAuthority'];
const EXISTING = ['officeBookingAuthorityFacade.js', 'bookingSchedulingPrimitives.js', 'bookingAuthoritySchedulingProvider.js', 'projectCommercialGuard.js'];
const FILES = [...EXISTING, 'vanRosterAuthority.js', 'vanRosterHistory.js'];
const BASE = '8327da2';
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(stable(v))).digest('hex');
function verifyDelta(before, after) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort();
  assert.deepEqual(changed, [...FILES].sort(), 'Unexpected source delta');
  for (const f of ['bootstrap.js', 'index.js', 'package.json', 'package-lock.json']) assert.equal(before[f], after[f], 'Packaging drift');
  return changed;
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/fix/van-crew-bulk-assignment-20261026');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const root = process.cwd(), out = path.join(process.env.RUNNER_TEMP, 'van-roster-audit');
  fs.mkdirSync(out);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const cloud = args => run('gcloud', args);
  const report = { sourceSha: process.env.GITHUB_SHA, mode: 'read-only', productionWrites: false, customerReads: false, stage: 'preflight', functions: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
  try {
    assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), process.env.GITHUB_SHA);
    for (const name of TARGETS) {
      report.stage = name + '-source'; save();
      const describe = () => JSON.parse(cloud(['functions', 'describe', name, '--gen2', '--project=' + PROJECT, '--region=us-central1', '--format=json']));
      const fn = describe();
      assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.entryPoint, name); assert.equal(fn.buildConfig.runtime, 'nodejs22');
      const serviceName = fn.serviceConfig.service.split('/').pop();
      const service = JSON.parse(cloud(['run', 'services', 'describe', serviceName, '--project=' + PROJECT, '--region=us-central1', '--format=json']));
      verifyTraffic(service, fn.serviceConfig.revision);
      const iam = () => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', serviceName, '--project=' + PROJECT, '--region=us-central1', '--format=json'])));
      const iamHash = iam(), source = fn.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && source.generation, 'Immutable source required');
      const dir = path.join(out, name), zip = dir + '.zip';
      report.stage = name + '-download'; save();
      cloud(['storage', 'cp', `gs://${source.bucket}/${source.object}#${source.generation}`, zip, '--quiet']);
      report.stage = name + '-extract'; save();
      const gzip = fs.readFileSync(zip).subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
      safePaths(run(gzip ? 'tar' : 'unzip', gzip ? ['-tzf', zip] : ['-Z1', zip]).trim().split('\n'));
      fs.mkdirSync(dir); run(gzip ? 'tar' : 'unzip', gzip ? ['-xzf', zip, '-C', dir] : ['-q', zip, '-d', dir]);
      const files = manifest(dir);
      report.stage = name + '-dependencies'; save();
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
      const lockPresent = Object.hasOwn(files, 'package-lock.json');
      if (lockPresent) validateLock(fs.readFileSync(path.join(dir, 'package-lock.json')), pkg);
      const read = f => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '';
      const entry = { name, revision: fn.serviceConfig.revision, source, sourceHash: runtimeSourceHash(files), configHash: hash(releaseConfig(fn)), iamHash,
        files,
        dependenciesPinned: lockPresent, trafficVerified: true };
      report.functions.push(entry); save();
      if (name === 'officeBookingAuthority') {
        for (const f of EXISTING) assert.equal(files[f], hash(run('git', ['show', BASE + ':functions/' + f])), 'Live patch base differs: ' + f);
        for (const f of FILES.filter(file => !EXISTING.includes(file))) assert.ok(!files[f], 'New module already exists: ' + f);
        const candidate = dir + '-candidate'; fs.cpSync(dir, candidate, { recursive: true });
        for (const f of FILES) fs.copyFileSync(path.join(root, 'functions', f), path.join(candidate, f));
        const after = manifest(candidate); entry.changed = verifyDelta(files, after); entry.candidateSourceHash = runtimeSourceHash(after);
        const tests = ['bookingCrewResolution.test.js', 'bookingAuthoritySchedulingProvider.test.js', 'officeBookingAuthorityCatalog.test.js', 'technicianDailyScheduleService.test.js', 'technicianScheduleChangeService.test.js'];
        const env = isolatedTestEnv(process.env);
        // Test-only staging: use the prior reviewed tests with the exact live
        // runtime; deployed ZIPs need not contain the corresponding test files.
        const baselineTests = path.join(out, 'baseline-test-inputs');
        const fixtures = [];
        const support = run('git', ['ls-tree', '-r', '--name-only', BASE, 'functions/test-support']).trim().split('\n');
        for (const relative of [...tests, ...fixtures].map(f => 'functions/' + f).concat(support)) {
          const destination = path.join(baselineTests, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, run('git', ['show', BASE + ':' + relative]));
        }
        // validateCandidate also loads the shared network guard and smoke script.
        fs.symlinkSync(path.join(root, 'scripts'), path.join(baselineTests, 'scripts'), 'dir');
        entry.baselineTestsSha = BASE;
        report.stage = name + '-baseline-tests'; save();
        entry.baselineResult = validateAttendanceCandidate({ source: dir, root: baselineTests, out, env, candidate: true, reconstruct: false, name: name + '-baseline', selectedTests: tests, updatedTests: tests, smokeScript: 'booking-dwelling-runtime-smoke.cjs', testFixtures: fixtures });
        report.stage = name + '-candidate-tests'; save();
        entry.candidateResult = validateAttendanceCandidate({ source: candidate, root, out, env, candidate: true, reconstruct: false, name: name + '-candidate', selectedTests: [...tests, 'vanRosterAuthority.test.js'], updatedTests: [...tests, 'vanRosterAuthority.test.js'], smokeScript: 'booking-dwelling-runtime-smoke.cjs', testFixtures: [] });
        assert.deepEqual(manifest(dir), files); assert.deepEqual(manifest(candidate), after);
      }
      const fresh = describe(); assert.equal(fresh.state, 'ACTIVE'); assert.equal(fresh.serviceConfig.revision, fn.serviceConfig.revision);
      verifyTraffic(JSON.parse(cloud(['run', 'services', 'describe', serviceName, '--project=' + PROJECT, '--region=us-central1', '--format=json'])), fresh.serviceConfig.revision);
      assert.equal(hash(releaseConfig(fresh)), entry.configHash); assert.equal(iam(), iamHash); assert.deepEqual(fresh.buildConfig.source, fn.buildConfig.source);
      save(); console.log(name + ': verified immutable source, configuration, IAM and traffic');
    }
    report.stage = 'complete'; save(); console.log('PASS read-only source audit; no production function invocations or data changes');
  } catch (error) {
    report.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Audit failed at ' + report.stage;
    save(); console.error(report.error); process.exitCode = 1;
  }
}
module.exports = { verifyDelta, FILES, BASE };
if (require.main === module) main();
