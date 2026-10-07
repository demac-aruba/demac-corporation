"use strict";
// Owner's 7 October conditional authorization: deploy only after audited gates pass.
// Source-only updates to TWO existing functions. No Firebase/Firestore data client,
// migration, message send, rule, secret, scheduler mutation or new function creation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { canonicalFunctionConfig: config } = require('./booking-references-release-config.cjs');
const project = 'demac-corporation';
const previous = '0f7155efa951a7751e0daac6ab25e35799a53868';
const reviewed = 'a54e836ba33b8388b377d911f180783852659152';
const branch = 'release/booking-references-correction-20261007';
const selected = ['officeBookingAuthority', 'queueAppointmentConfirmation'];
const dependencyLocks = {};
const roots = {
  officeBookingAuthority: ['officeBookingAuthorityFacade.js'],
  queueAppointmentConfirmation: ['appointmentNotifications.js'],
  wacliOutboundPoll: ['whatsappWacliGateway.js'],
  wacliOutboundAck: ['whatsappWacliGateway.js'],
  sendDailyTechnicianSchedules: ['technicianDailySchedules.js'],
  bookingVisitReferences: ['bookingVisitReferencesHttp.js'],
  wacliBookingReferenceMedia: ['whatsappWacliGateway.js'],
  cleanupBookingReferenceUploads: ['bookingVisitReferencesHttp.js'],
  notifyBookingReferenceUpdate: ['bookingVisitReferencesHttp.js'],
};
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 40 * 1024 * 1024 });
const git = args => run('git', args).trim();
const cloud = args => run('gcloud', args);
const describe = name => JSON.parse(cloud(['functions', 'describe', name, '--project=' + project, '--region=us-central1', '--gen2', '--format=json']));
const summary = { reviewed, previous, sourceSha: process.env.GITHUB_SHA, stage: 'preflight', functions: [] };
const out = path.join(process.env.RUNNER_TEMP || '/invalid-runner', 'booking-reference-correction');
const record = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const remote = ref => { const line = git(['ls-remote', 'origin', ref]); assert.match(line, /^[0-9a-f]{40}\s+refs\/heads\/[\w/-]+$/); return line.split(/\s+/)[0]; };
function sourceGate() {
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation', 'Wrong repository');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/' + branch, 'Wrong release branch');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'Absolute runner directory required');
  assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA, 'Wrong checkout');
  assert.equal(remote('refs/heads/' + branch), process.env.GITHUB_SHA, 'Release branch advanced');
  const main = remote('refs/heads/main');
  for (const item of ['functions', 'apps/erp-next']) {
    const expected = git(['rev-parse', `${reviewed}:${item}`]);
    assert.equal(git(['rev-parse', `${main}:${item}`]), expected, 'Main differs from reviewed application');
    assert.equal(git(['rev-parse', `HEAD:${item}`]), expected, 'Release differs from reviewed application');
  }
  if (summary.mainSha) assert.equal(main, summary.mainSha, 'Main advanced during release');
  summary.mainSha = main;
}
function dependencies(ref, entries) {
  const found = new Set();
  function visit(file) {
    if (found.has(file)) return;
    const source = run('git', ['show', `${ref}:functions/${file}`]); found.add(file);
    for (const match of source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
      let next = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      if (!path.posix.extname(next)) next += '.js';
      if (!next.startsWith('../')) visit(next);
    }
  }
  entries.forEach(visit); return [...found, 'bootstrap.js', 'package.json'];
}
function matchingSource(fn, name, refs) {
  const src = fn.buildConfig.source.storageSource;
  assert.ok(src?.bucket && src?.object, name + ': source unavailable');
  const zip = path.join(out, name + '.zip');
  cloud(['storage', 'cp', `gs://${src.bucket}/${src.object}${src.generation ? '#' + src.generation : ''}`, zip, '--quiet']);
  try {
    if (selected.includes(name)) {
      const lock = run('unzip', ['-p', zip, 'package-lock.json']);
      const root = JSON.parse(lock).packages?.[''];
      const manifest = JSON.parse(run('git', ['show', reviewed + ':functions/package.json']));
      assert.deepEqual(root?.dependencies, manifest.dependencies, name + ': live dependency manifest mismatch');
      if (dependencyLocks[name]) assert.equal(lock, dependencyLocks[name], name + ': dependency lock changed');
      else dependencyLocks[name] = lock;
    }
    return refs.find(ref => dependencies(ref, roots[name]).every(file => {
      try { return run('unzip', ['-p', zip, file]).replace(/\r\n/g, '\n') === run('git', ['show', `${ref}:functions/${file}`]).replace(/\r\n/g, '\n'); }
      catch { return false; }
    }));
  } finally { fs.unlinkSync(zip); }
}
const scheduler = () => JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-sendDailyTechnicianSchedules-us-central1', '--project=' + project, '--location=us-central1', '--format=json']));
function unchanged(name, before) {
  const now = describe(name);
  assert.equal(now.state, 'ACTIVE', name + ': inactive');
  assert.deepEqual({ source: now.buildConfig.source, revision: now.serviceConfig.revision },
    { source: before.buildConfig.source, revision: before.serviceConfig.revision }, name + ': concurrent deployment detected');
  assert.deepEqual(config(now), config(before), name + ': concurrent runtime change');
}
async function boundaryChecks() {
  for (const name of ['officeBookingAuthority', 'bookingVisitReferences']) {
    for (const origin of ['https://demac-aruba.com', 'https://www.demac-aruba.com']) {
      const url = `https://us-central1-${project}.cloudfunctions.net/${name}`;
      const preflight = await fetch(url, { method: 'OPTIONS', signal: AbortSignal.timeout(20000), headers: {
        Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
      assert.equal(preflight.status, 204, name + ': CORS preflight failed');
      assert.ok([origin, '*'].includes(preflight.headers.get('access-control-allow-origin')));
      const denied = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(denied.status, 401, name + ': anonymous request accepted');
    }
  }
}
async function main() {
  sourceGate(); fs.mkdirSync(out, { recursive: true }); record();
  const beforeSchedule = scheduler();
  assert.equal(beforeSchedule.schedule, '0,5,10 8 * * *');
  assert.equal(beforeSchedule.timeZone, 'America/Aruba'); assert.equal(beforeSchedule.state, 'ENABLED');
  const before = {}, prior = {};
  for (const name of Object.keys(roots)) {
    const fn = describe(name); assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.runtime, 'nodejs22');
    assert.equal(fn.buildConfig.entryPoint, name);
    const match = matchingSource(fn, name, selected.includes(name) ? [reviewed, previous] : [previous]);
    assert.ok(match, name + ': unknown live source'); before[name] = fn; prior[name] = match;
  }
  await boundaryChecks();
  summary.previousRevisions = Object.entries(before).map(([name, fn]) => ({ name, revision: fn.serviceConfig.revision })); record();
  const stage = path.join(process.env.RUNNER_TEMP, 'booking-reference-correction-source'); fs.mkdirSync(stage, { recursive: true });
  const archive = path.join(process.env.RUNNER_TEMP, 'booking-reference-correction-source.tar');
  run('git', ['archive', '--format=tar', '--output=' + archive, reviewed + ':functions']); run('tar', ['-xf', archive, '-C', stage]);
  for (const name of selected) {
    sourceGate(); unchanged(name, before[name]);
    summary.stage = 'deploy-' + name; record(); console.log(summary.stage);
    // Preserve the resolved dependency versions already running in this function.
    fs.writeFileSync(path.join(stage, 'package-lock.json'), dependencyLocks[name]);
    if (prior[name] !== reviewed) cloud(['functions', 'deploy', name, '--project=' + project, '--region=us-central1', '--gen2',
      '--source=' + stage, '--entry-point=' + name, '--runtime=nodejs22',
      '--run-service-account=' + before[name].serviceConfig.serviceAccountEmail, '--quiet', '--format=value(state)']);
    const fn = describe(name); assert.equal(fn.state, 'ACTIVE');
    assert.deepEqual(config(fn), config(before[name]), name + ': runtime configuration changed');
    assert.equal(matchingSource(fn, name, [reviewed]), reviewed, name + ': corrected source mismatch');
    summary.functions.push({ name, revision: fn.serviceConfig.revision, sourceVerified: true, configPreserved: true }); record();
  }
  for (const name of Object.keys(roots).filter(name => !selected.includes(name))) unchanged(name, before[name]);
  const afterSchedule = scheduler();
  for (const key of ['schedule', 'timeZone', 'state', 'httpTarget', 'retryConfig', 'attemptDeadline'])
    assert.deepEqual(afterSchedule[key], beforeSchedule[key], 'Daily scheduler changed: ' + key);
  await boundaryChecks(); sourceGate();
  summary.stage = 'complete'; summary.otherSevenFunctionsUnchanged = true; summary.schedulerPreserved = true;
  summary.actualDomainAnonymousBoundariesPassed = true; record();
  console.log('PASS: two corrected functions; seven unchanged functions; runtime and daily scheduler preserved.');
}
main().catch(error => {
  summary.error = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Release stopped at ' + summary.stage;
  // Do not print cloud stdout/stderr: it may include environment or credentials.
  summary.exitStatus = error.status || error.code || null;
  if (fs.existsSync(out)) record(); console.error(summary.error); process.exitCode = 1;
});
