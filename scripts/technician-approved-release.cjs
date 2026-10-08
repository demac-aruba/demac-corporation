'use strict';
// Owner-authorized PR526 release: one existing function, source only. No data client.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { canonicalFunctionConfig } = require('./booking-references-release-config.cjs');
const PROJECT = 'demac-corporation';
const FUNCTION = 'fieldOperationsAuthority';
const BRANCH = 'release/technician-pr526-20261008';
const ORIGINS = ['https://demac-aruba.com', 'https://www.demac-aruba.com'];
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 40 * 1024 * 1024 });
const git = args => run('git', args).trim();
const cloud = args => run('gcloud', args);
const describe = name => JSON.parse(cloud(['functions', 'describe', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--format=json']));

function assertContext({ repository, ref, sha, checkout, remoteRelease, main, parent, treesEqual, docsOnly }) {
  assert.equal(repository, 'demac-aruba/demac-corporation', 'Wrong repository');
  assert.equal(ref, 'refs/heads/' + BRANCH, 'Wrong release branch');
  assert.match(sha || '', /^[a-f0-9]{40}$/, 'Exact source SHA required');
  assert.equal(checkout, sha, 'Wrong checkout');
  assert.equal(remoteRelease, sha, 'Release branch advanced');
  assert.equal(parent, main, 'Release must directly follow current merged main');
  assert.equal(treesEqual, true, 'Application differs from merged reviewed source');
  assert.equal(docsOnly, true, 'Release authorization must change documentation only');
}
function sourceGate() {
  const remote = ref => {
    const line = git(['ls-remote', 'origin', ref]);
    assert.match(line, /^[a-f0-9]{40}\s+refs\/heads\/[\w/-]+$/);
    return line.split(/\s+/)[0];
  };
  const main = remote('refs/heads/main');
  const dirs = ['functions', 'apps/erp-next', 'scripts', '.github/workflows'];
  assertContext({ repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, checkout: git(['rev-parse', 'HEAD']), remoteRelease: remote('refs/heads/' + BRANCH),
    main, parent: git(['rev-parse', 'HEAD^']),
    treesEqual: dirs.every(dir => git(['rev-parse', 'HEAD:' + dir]) === git(['rev-parse', main + ':' + dir])),
    docsOnly: git(['diff', '--name-only', main, 'HEAD']).split('\n').every(file => file.startsWith('docs/') && file.endsWith('.md')) });
  return main;
}
function assertRuntime(fn) {
  assert.equal(fn.state, 'ACTIVE', 'Existing Field function is not ACTIVE');
  assert.equal(fn.buildConfig.runtime, 'nodejs22', 'Unexpected runtime');
  assert.equal(fn.buildConfig.entryPoint, FUNCTION, 'Unexpected entry point');
  assert.ok(fn.serviceConfig.serviceAccountEmail, 'Runtime identity missing');
  assert.equal(fn.eventTrigger, undefined, 'Field must remain HTTP');
  assert.ok(fn.buildConfig.source.storageSource?.bucket && fn.buildConfig.source.storageSource?.object, 'Source missing');
}
function deployArgs(stage, fn) {
  assertRuntime(fn);
  return ['functions', 'deploy', FUNCTION, '--project=' + PROJECT, '--region=us-central1', '--gen2',
    '--source=' + stage, '--entry-point=' + FUNCTION, '--runtime=nodejs22',
    '--run-service-account=' + fn.serviceConfig.serviceAccountEmail, '--quiet', '--format=value(state)'];
}
function assertLock(lock, manifest) {
  const root = JSON.parse(lock).packages?.[''];
  assert.deepEqual(root?.dependencies, manifest.dependencies, 'Running dependency lock differs from reviewed manifest');
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) });
  return response;
}
async function frontendGate() {
  sourceGate();
  for (const origin of ORIGINS) {
    const response = await request(origin + '/login/');
    assert.equal(response.status, 200, 'Live login unavailable');
    const html = await response.text();
    assert.ok(html.includes('auth-page') && html.includes('Sign in to DEMAC ERP') && !html.includes('Acceso a DEMAC'), 'Live ERP login design changed');
    const page = await request(origin + '/scheduling/');
    assert.equal(page.status, 200, 'Scheduling shell unavailable');
    const scripts = [...(await page.text()).matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    assert.ok(scripts.length > 0 && scripts.length < 50, 'Unexpected frontend scripts');
    let releaseFound = false;
    for (const script of scripts) {
      assert.ok(script.startsWith('/_next/static/') && !script.includes('..'), 'Unexpected script origin');
      const chunk = await request(origin + script);
      assert.equal(chunk.status, 200, 'Frontend chunk unavailable');
      if ((await chunk.text()).includes(process.env.GITHUB_SHA)) releaseFound = true;
    }
    assert.ok(releaseFound, 'Reviewed production frontend is not yet serving on ' + origin);
  }
}
async function boundaries() {
  for (const name of [FUNCTION, 'officeBookingAuthority', 'bookingVisitReferences']) {
    for (const origin of ORIGINS) {
      const url = `https://us-central1-${PROJECT}.cloudfunctions.net/${name}`;
      const options = await request(url, { method: 'OPTIONS', headers: { Origin: origin,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
      assert.equal(options.status, 204, name + ': CORS failed');
      assert.ok([origin, '*'].includes(options.headers.get('access-control-allow-origin')), name + ': business origin rejected');
      const denied = await request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(denied.status, 401, name + ': unauthenticated access accepted');
    }
  }
}
async function release() {
  const main = sourceGate();
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'Runner directory required');
  const out = path.join(process.env.RUNNER_TEMP, 'technician-approved-release');
  fs.mkdirSync(out, { recursive: true });
  const summary = { source: process.env.GITHUB_SHA, main, project: PROJECT, function: FUNCTION, stage: 'preflight' };
  const record = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  record();
  try {
    await frontendGate();
    const names = [FUNCTION, 'officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyTechnicianSchedules', 'bookingVisitReferences', 'wacliOutboundPoll', 'wacliOutboundAck'];
    const before = Object.fromEntries(names.map(name => [name, describe(name)]));
    assertRuntime(before[FUNCTION]);
    const schedulerArgs = ['scheduler', 'jobs', 'describe', 'firebase-schedule-sendDailyTechnicianSchedules-us-central1', '--project=' + PROJECT, '--location=us-central1', '--format=json'];
    const schedule = JSON.parse(cloud(schedulerArgs));
    assert.equal(schedule.state, 'ENABLED');
    assert.equal(schedule.schedule, '0,5,10 8 * * *');
    assert.equal(schedule.timeZone, 'America/Aruba');
    const stage = path.join(process.env.RUNNER_TEMP, 'technician-release-source');
    fs.mkdirSync(stage, { recursive: true });
    const archive = path.join(process.env.RUNNER_TEMP, 'technician-release-source.tar');
    run('git', ['archive', '--format=tar', '--output=' + archive, 'HEAD:functions']);
    run('tar', ['-xf', archive, '-C', stage]);
    const zip = path.join(process.env.RUNNER_TEMP, 'technician-running-source.zip');
    const download = fn => {
      const s = fn.buildConfig.source.storageSource;
      cloud(['storage', 'cp', `gs://${s.bucket}/${s.object}${s.generation ? '#' + s.generation : ''}`, zip, '--quiet']);
    };
    download(before[FUNCTION]);
    const lock = run('unzip', ['-p', zip, 'package-lock.json']);
    assertLock(lock, JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8')));
    fs.writeFileSync(path.join(stage, 'package-lock.json'), lock);
    fs.unlinkSync(zip);
    await boundaries();
    assert.equal(sourceGate(), main, 'Main advanced before deploy');
    const current = describe(FUNCTION);
    assert.deepEqual(current.buildConfig.source, before[FUNCTION].buildConfig.source, 'Concurrent Field source update');
    assert.deepEqual(canonicalFunctionConfig(current), canonicalFunctionConfig(before[FUNCTION]), 'Concurrent Field configuration update');
    summary.previousRevision = current.serviceConfig.revision;
    summary.previousSource = current.buildConfig.source.storageSource;
    summary.stage = 'deploy-field-source'; record();
    cloud(deployArgs(stage, current));
    const after = describe(FUNCTION); assertRuntime(after);
    assert.deepEqual(canonicalFunctionConfig(after), canonicalFunctionConfig(before[FUNCTION]), 'Runtime configuration changed');
    download(after);
    const files = git(['ls-tree', '-r', '--name-only', 'HEAD:functions']).split('\n').filter(file => file.endsWith('.js') || file.endsWith('.cjs') || file === 'package.json');
    for (const file of files) assert.equal(run('unzip', ['-p', zip, file]), fs.readFileSync(path.join(stage, file), 'utf8'), 'Deployed source mismatch: ' + file);
    assert.equal(run('unzip', ['-p', zip, 'package-lock.json']), lock, 'Dependency lock changed');
    fs.unlinkSync(zip);
    for (const name of names.filter(name => name !== FUNCTION)) {
      const other = describe(name);
      assert.deepEqual(other.buildConfig.source, before[name].buildConfig.source, name + ': source changed');
      assert.equal(other.serviceConfig.revision, before[name].serviceConfig.revision, name + ': revision changed');
      assert.deepEqual(canonicalFunctionConfig(other), canonicalFunctionConfig(before[name]), name + ': runtime changed');
    }
    const afterSchedule = JSON.parse(cloud(schedulerArgs));
    for (const key of ['schedule', 'timeZone', 'state', 'httpTarget', 'retryConfig', 'attemptDeadline'])
      assert.deepEqual(afterSchedule[key], schedule[key], 'Scheduler changed: ' + key);
    await boundaries(); await frontendGate();
    summary.stage = 'complete'; summary.revision = after.serviceConfig.revision;
    summary.configPreserved = true; summary.dependencyLockPreserved = true;
    summary.unchangedFunctions = names.filter(name => name !== FUNCTION);
    summary.schedulerPreserved = true; summary.sourceFilesVerified = files.length;
    record(); console.log('PASS: Field source published; runtime/dependencies, six other functions and scheduler preserved.');
  } catch (error) {
    summary.error = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Release failed at ' + summary.stage;
    record(); throw Error(summary.error); // Never print cloud output, environment values or credentials.
  }
}
if (require.main === module) {
  const task = process.argv[2] === '--frontend' ? frontendGate : release;
  task().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { assertContext, assertRuntime, assertLock, deployArgs, BRANCH };
