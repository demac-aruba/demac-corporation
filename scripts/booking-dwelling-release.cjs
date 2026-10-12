'use strict';
// Source-only, owner-approved PR #570 release. No database or messaging clients.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { canonicalFunctionConfig } = require('./booking-references-release-config.cjs');
const PROJECT = 'demac-corporation';
const BASE = '1e9b4568a461367ee4aa8cff25ef34ebc73f19c9';
const RELEASE = 'release/booking-dwelling-messages-20261012';
const FILES = ['appointmentNotificationService.js', 'technicianDailyScheduleService.js', 'technicianScheduleChangeService.js'];
const HELPER = 'bookingLocationDisplay.js';
const FUNCTIONS = ['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate'];
const TESTS = ['appointmentNotificationService.test.js', 'technicianDailyScheduleService.test.js', 'technicianScheduleChangeService.test.js'];
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex');
function safePaths(files) {
  assert.ok(files.length > 0, 'Empty source archive');
  for (const file of files) assert.ok(!path.posix.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), 'Unsafe source archive path');
}
function deployArgs(name, stage) {
  assert.ok(FUNCTIONS.includes(name), 'Unapproved function');
  assert.ok(path.isAbsolute(stage), 'Absolute stage required');
  return ['functions', 'deploy', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--source=' + stage, '--quiet', '--format=value(state)'];
}
function sourceManifest(root) {
  const result = {};
  const visit = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, item.name);
      assert.ok(!item.isSymbolicLink(), 'Source archive contains a symlink');
      if (item.isDirectory()) visit(target);
      else result[path.relative(root, target).split(path.sep).join('/')] = hash(fs.readFileSync(target));
    }
  };
  visit(root); return result;
}
function verifyDelta(before, after, reviewedHelperHash) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
  assert.ok(changed.every(file => [...FILES, HELPER].includes(file)), 'Source patch changes an unapproved file');
  assert.equal(after[HELPER], reviewedHelperHash, 'Wrong shared formatter');
  assert.equal(after['package-lock.json'], before['package-lock.json'], 'Dependency lock changed');
  assert.equal(after['package.json'], before['package.json'], 'Dependency manifest changed');
  return changed;
}
async function main() {
  const deploy = process.argv.includes('--deploy');
  const root = process.cwd();
  const out = path.join(process.env.RUNNER_TEMP || '', 'dwelling-release');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'Runner directory required');
  fs.mkdirSync(out, { recursive: true });
  const summary = { project: PROJECT, mode: deploy ? 'deploy' : 'read-only-audit', stage: 'preflight', functions: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const git = args => run('git', args).trim();
  const cloud = args => run('gcloud', args);
  const describe = name => JSON.parse(cloud(['functions', 'describe', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--format=json']));
  const configHash = fn => hash(canonicalFunctionConfig(fn));
  const iamHash = fn => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=us-central1', '--format=json'])));
  const scheduler = name => JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-' + name + '-us-central1', '--project=' + PROJECT, '--location=us-central1', '--format=json']));
  const schedulerHash = job => hash(Object.fromEntries(['schedule', 'timeZone', 'state', 'httpTarget', 'retryConfig', 'attemptDeadline'].map(key => [key, job[key]])));
  const remote = ref => git(['ls-remote', 'origin', 'refs/heads/' + ref]).split(/\s/)[0];
  const sourceGate = () => {
    assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation', 'Wrong repository');
    assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA, 'Wrong checkout');
    const branch = deploy ? RELEASE : 'fix/booking-dwelling-messages';
    assert.equal(process.env.GITHUB_REF, 'refs/heads/' + branch, 'Wrong task/release branch');
    assert.equal(remote(branch), process.env.GITHUB_SHA, 'Branch advanced');
    git(['merge-base', '--is-ancestor', BASE, 'HEAD']);
    if (deploy) {
      const currentMain = remote('main');
      git(['merge-base', '--is-ancestor', process.env.GITHUB_SHA, currentMain]);
      assert.equal(git(['rev-parse', currentMain + ':functions']), git(['rev-parse', 'HEAD:functions']), 'Main functions differ from reviewed release');
      if (summary.mainSha) assert.equal(currentMain, summary.mainSha, 'Main advanced during release');
      summary.mainSha = currentMain;
    }
  };
  const download = (fn, directory) => {
    const src = fn.buildConfig.source.storageSource;
    assert.ok(src?.bucket && src?.object && src?.generation, 'Versioned deployed source required');
    const zip = directory + '.zip';
    cloud(['storage', 'cp', `gs://${src.bucket}/${src.object}#${src.generation}`, zip, '--quiet']);
    const entries = run('unzip', ['-Z1', zip]).trim().split('\n'); safePaths(entries);
    fs.mkdirSync(directory, { recursive: true });
    run('unzip', ['-q', zip, '-d', directory]);
    fs.unlinkSync(zip); return sourceManifest(directory);
  };
  async function boundaries() {
    for (const origin of ['https://demac-aruba.com', 'https://www.demac-aruba.com']) {
      const url = `https://us-central1-${PROJECT}.cloudfunctions.net/officeBookingAuthority`;
      const response = await fetch(url, { method: 'OPTIONS', signal: AbortSignal.timeout(20000), headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
      assert.equal(response.status, 204, 'Office CORS failed');
      assert.ok([origin, '*'].includes(response.headers.get('access-control-allow-origin')), 'Office origin rejected');
      const denied = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"action":"list_presets","data":{}}' });
      assert.equal(denied.status, 401, 'Anonymous Office access must remain denied');
    }
  }
  try {
    sourceGate(); summary.sourceSha = process.env.GITHUB_SHA; save();
    const patch = run('git', ['diff', '--binary', BASE, 'HEAD', '--', ...FILES.map(file => 'functions/' + file)]);
    const patchPath = path.join(out, 'reviewed.patch'); fs.writeFileSync(patchPath, patch);
    const helper = fs.readFileSync(path.join(root, 'functions', HELPER));
    const before = {}, candidates = {}, configs = {}, policies = {}, schedules = {};
    for (const name of ['sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules']) {
      const job = scheduler(name); assert.equal(job.state, 'ENABLED'); assert.equal(job.timeZone, 'America/Aruba');
      assert.equal(job.schedule, name === 'sendDailyTechnicianSchedules' ? '0,5,10 8 * * *' : '0 10 * * *');
      schedules[name] = schedulerHash(job);
    }
    await boundaries();
    for (const name of FUNCTIONS) {
      summary.stage = 'audit-' + name; save();
      const fn = describe(name); assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.runtime, 'nodejs22'); assert.equal(fn.buildConfig.entryPoint, name);
      before[name] = fn; configs[name] = configHash(fn); policies[name] = iamHash(fn);
      const stage = path.join(out, name); const original = download(fn, stage);
      assert.ok(original['package-lock.json'], 'Live dependency lock missing');
      const livePackage = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
      assert.deepEqual(livePackage.dependencies, JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'))).dependencies, 'Live dependency declarations differ');
      let alreadyApplied = false;
      try { run('git', ['apply', '--check', '-p2', patchPath], stage); }
      catch {
        run('git', ['apply', '--reverse', '--check', '-p2', patchPath], stage);
        assert.equal(original[HELPER], hash(helper), 'Partial or unknown previous patch');
        alreadyApplied = true;
      }
      if (!alreadyApplied) run('git', ['apply', '-p2', patchPath], stage);
      fs.writeFileSync(path.join(stage, HELPER), helper);
      const candidate = sourceManifest(stage); const changed = verifyDelta(original, candidate, hash(helper));
      // The actual deployed source plus the bounded patch is tested in an
      // isolated copy. No test fixtures or new dependency lock enter deployment.
      const validation = stage + '-test'; fs.cpSync(stage, validation, { recursive: true });
      for (const file of TESTS) fs.copyFileSync(path.join(root, 'functions', file), path.join(validation, file));
      fs.cpSync(path.join(root, 'functions/test-support'), path.join(validation, 'test-support'), { recursive: true });
      fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(validation, 'node_modules'), 'dir');
      const tests = run(process.execPath, ['--test', ...TESTS], validation);
      assert.match(tests, /(?:#|ℹ) fail 0/); fs.rmSync(validation, { recursive: true });
      candidates[name] = candidate;
      summary.functions.push({ name, state: fn.state, beforeRevision: fn.serviceConfig.revision, rollbackSource: fn.buildConfig.source.storageSource,
        configHash: configs[name], iamHash: policies[name], changedFiles: changed, alreadyApplied, actualSourceTestsPassed: true, codeHashes: Object.fromEntries([...FILES, HELPER].map(file => [file, candidate[file]])) }); save();
      console.log(name + ': live-source patch and isolated tests passed');
    }
    const unchanged = name => {
      const fresh = describe(name); assert.equal(fresh.state, 'ACTIVE');
      assert.deepEqual(fresh.buildConfig.source, before[name].buildConfig.source, 'Concurrent source deployment');
      assert.equal(fresh.serviceConfig.revision, before[name].serviceConfig.revision, 'Concurrent revision');
      assert.equal(configHash(fresh), configs[name], 'Concurrent config change'); assert.equal(iamHash(fresh), policies[name], 'Concurrent IAM change');
    };
    sourceGate(); for (const name of FUNCTIONS) unchanged(name);
    if (deploy) for (const name of FUNCTIONS) {
      sourceGate(); unchanged(name); summary.stage = 'deploy-' + name; save();
      const stage = path.join(out, name);
      assert.deepEqual(sourceManifest(stage), candidates[name], 'Staged source changed after audit');
      console.log('Deploying reviewed source only: ' + name);
      if (!summary.functions.find(item => item.name === name).alreadyApplied) cloud(deployArgs(name, stage));
      const after = describe(name); assert.equal(after.state, 'ACTIVE');
      assert.equal(configHash(after), configs[name], 'Runtime configuration changed'); assert.equal(iamHash(after), policies[name], 'IAM changed');
      const published = download(after, stage + '-published');
      for (const [file, digest] of Object.entries(candidates[name])) {
        if (file !== '.gcloudignore') assert.equal(published[file], digest, 'Published source differs: ' + file);
      }
      Object.assign(summary.functions.find(item => item.name === name), { afterRevision: after.serviceConfig.revision, publishedSourceVerified: true, configPreserved: true, iamPreserved: true }); save();
    }
    for (const [name, digest] of Object.entries(schedules)) assert.equal(schedulerHash(scheduler(name)), digest, 'Scheduler changed');
    await boundaries(); sourceGate(); summary.stage = 'complete'; summary.schedulersPreserved = true; summary.actualDomainBoundariesPassed = true; save();
    console.log('PASS: ' + summary.mode + '; no customer data, queue, group or scheduler mutations.');
  } catch (error) {
    summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Command failed during ' + summary.stage;
    summary.exitStatus = error.status || error.code || null; save();
    // Cloud output/configuration can contain secrets. Emit only the safe stage.
    console.error(summary.error); process.exitCode = 1;
  }
}
module.exports = { safePaths, deployArgs, verifyDelta };
if (require.main === module) main();
