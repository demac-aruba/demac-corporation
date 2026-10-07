'use strict';
// Owner-authorized, additive PR #557 release. No migrations, customer/booking
// writes, schedule invocation, queue repair or Van-group mapping changes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const requireFunction = createRequire(path.resolve('functions/package.json'));
const { initializeApp, applicationDefault } = requireFunction('firebase-admin/app');
const { getFirestore } = requireFunction('firebase-admin/firestore');
const project = 'demac-corporation';
const baseline = '36392f4aabbda65f839008a54edfba799a39329f';
const reviewed = '0f7155efa951a7751e0daac6ab25e35799a53868';
const branch = 'release/booking-references-20261007';
const roots = {
  wacliOutboundAck: ['whatsappWacliGateway.js'],
  wacliOutboundPoll: ['whatsappWacliGateway.js'],
  queueAppointmentConfirmation: ['appointmentNotifications.js'],
  sendDailyTechnicianSchedules: ['technicianDailySchedules.js'],
  officeBookingAuthority: ['officeBookingAuthorityFacade.js'],
};
const newRoots = {
  wacliBookingReferenceMedia: ['whatsappWacliGateway.js'],
  cleanupBookingReferenceUploads: ['bookingVisitReferencesHttp.js'],
  notifyBookingReferenceUpdate: ['bookingVisitReferencesHttp.js'],
  bookingVisitReferences: ['bookingVisitReferencesHttp.js'],
};
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 40 * 1024 * 1024, ...opts });
const git = args => run('git', args).trim();
const cloud = args => run('gcloud', args);
const describe = name => JSON.parse(cloud(['functions', 'describe', name, '--project=' + project, '--region=us-central1', '--gen2', '--format=json']));
const config = fn => ({ runtime: fn.buildConfig.runtime, entryPoint: fn.buildConfig.entryPoint,
  service: Object.fromEntries(Object.entries(fn.serviceConfig).filter(([k]) => !['revision', 'uri', 'service'].includes(k))), trigger: fn.eventTrigger || null });
const summary = { reviewed, baseline, sourceSha: process.env.GITHUB_SHA, stage: 'preflight', functions: [] };
assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
assert.equal(process.env.GITHUB_REF, 'refs/heads/' + branch);
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
const out = path.join(process.env.RUNNER_TEMP, 'booking-reference-release'); fs.mkdirSync(out, { recursive: true });
const record = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const remote = ref => { const line = git(['ls-remote', 'origin', ref]); assert.match(line, /^[0-9a-f]{40}\s+refs\/heads\/[\w/-]+$/); return line.split(/\s+/)[0]; };
function sourceGate() {
  assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA);
  assert.equal(remote('refs/heads/' + branch), process.env.GITHUB_SHA, 'Release branch advanced');
  const main = remote('refs/heads/main');
  git(['merge-base', '--is-ancestor', baseline, main]);
  for (const item of ['functions', 'apps/erp-next']) {
    assert.equal(git(['rev-parse', `${main}:${item}`]), git(['rev-parse', `${reviewed}:${item}`]), 'Main differs from reviewed application');
    assert.equal(git(['rev-parse', `HEAD:${item}`]), git(['rev-parse', `${reviewed}:${item}`]), 'Release differs from reviewed application');
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
  entries.forEach(visit); return [...found];
}
function matchingSource(fn, name, entries, refs) {
  const src = fn.buildConfig.source.storageSource;
  assert.ok(src?.bucket && src?.object, name + ': source unavailable');
  const zip = path.join(out, name + '.zip');
  cloud(['storage', 'cp', `gs://${src.bucket}/${src.object}${src.generation ? '#' + src.generation : ''}`, zip, '--quiet']);
  try {
    return refs.find(ref => dependencies(ref, entries).every(file => {
      try { return run('unzip', ['-p', zip, file]).replace(/\r\n/g, '\n') === run('git', ['show', `${ref}:functions/${file}`]).replace(/\r\n/g, '\n'); }
      catch { return false; }
    }));
  } finally { fs.unlinkSync(zip); }
}
const scheduler = () => JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-sendDailyTechnicianSchedules-us-central1',
  '--project=' + project, '--location=us-central1', '--format=json']));
function sameRuntime(name, before) {
  const now = describe(name);
  assert.equal(now.state, 'ACTIVE', name + ' inactive');
  assert.deepEqual({ source: now.buildConfig.source, revision: now.serviceConfig.revision },
    { source: before.buildConfig.source, revision: before.serviceConfig.revision }, name + ': concurrent deployment detected');
  assert.deepEqual(config(now), config(before), name + ': runtime changed concurrently');
}
async function authGate(name) {
  const status = name === 'wacliBookingReferenceMedia' ? 403 : 401;
  const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/${name}`,
    { method: name === 'wacliBookingReferenceMedia' ? 'GET' : 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' }, body: name === 'wacliBookingReferenceMedia' ? undefined : '{}' });
  assert.equal(response.status, status, name + ': anonymous request must be rejected');
}
async function main() {
  sourceGate();
  initializeApp({ credential: applicationDefault(), projectId: project });
  const db = getFirestore();
  for (let i = 0; i < 6; i++) {
    const test = await db.collection('whatsappOutboundQueue').doc('pr557-owner-smoke-20261007-' + String(i).padStart(2, '0')).get();
    assert.ok(test.exists); assert.equal(test.data().testRunId, 'pr557-owner-smoke-20261007');
    assert.equal(test.data().to, '2975606772'); assert.equal(test.data().status, 'sent'); assert.ok(test.data().messageId);
  }
  summary.authorizedMediaSmokeVerified = true;
  const beforeSchedule = scheduler();
  assert.equal(beforeSchedule.schedule, '0,5,10 8 * * *'); assert.equal(beforeSchedule.timeZone, 'America/Aruba'); assert.equal(beforeSchedule.state, 'ENABLED');
  const before = {}, prior = {};
  for (const [name, entries] of Object.entries(roots)) {
    const fn = describe(name); assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.runtime, 'nodejs22');
    const match = matchingSource(fn, name, entries, [reviewed, baseline]); assert.ok(match, name + ': unknown live source');
    before[name] = fn; prior[name] = match;
  }
  const inventory = JSON.parse(cloud(['functions', 'list', '--project=' + project, '--regions=us-central1', '--v2', '--format=json(name)']));
  assert.ok(inventory.some(fn => fn.name === before.officeBookingAuthority.name));
  const newBefore = {};
  for (const [name, entries] of Object.entries(newRoots)) {
    if (!inventory.some(fn => fn.name.endsWith('/' + name))) continue;
    const fn = describe(name); assert.equal(fn.state, 'ACTIVE');
    assert.equal(matchingSource(fn, name, entries, [reviewed]), reviewed, name + ': unreviewed existing endpoint'); newBefore[name] = fn;
  }
  summary.previous = Object.entries(before).map(([name, fn]) => ({ name, revision: fn.serviceConfig.revision, source: fn.buildConfig.source }));
  record();
  const stage = path.join(process.env.RUNNER_TEMP, 'booking-reference-source'); fs.mkdirSync(stage, { recursive: true });
  const archive = path.join(process.env.RUNNER_TEMP, 'booking-reference-source.tar');
  run('git', ['archive', '--format=tar', '--output=' + archive, 'HEAD:functions']); run('tar', ['-xf', archive, '-C', stage]);
  const firebaseConfig = path.join(process.env.RUNNER_TEMP, 'booking-reference-firebase.json');
  fs.writeFileSync(firebaseConfig, JSON.stringify({ functions: { source: stage, codebase: 'default' } }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });
  async function createSelected(names) {
    sourceGate();
    const missing = names.filter(name => !newBefore[name]);
    if (missing.length) {
      summary.stage = 'create-' + missing.join('-'); record();
      // Only new, named functions; no broad deploy, --force, rules or deletion.
      run('npx', ['--yes', 'firebase-tools@15.30.0', 'deploy', '--only', missing.map(n => 'functions:' + n).join(','),
        '--project', project, '--config', firebaseConfig, '--non-interactive'], { cwd: stage });
    }
    for (const name of names) {
      const fn = describe(name); assert.equal(fn.state, 'ACTIVE');
      assert.equal(matchingSource(fn, name, newRoots[name], [reviewed]), reviewed, name + ': deployed source mismatch');
      if (['bookingVisitReferences', 'wacliBookingReferenceMedia'].includes(name)) {
        assert.equal(fn.serviceConfig.maxInstanceRequestConcurrency, 4); assert.equal(fn.serviceConfig.availableMemory, '512Mi');
        await authGate(name);
      }
      summary.functions.push({ name, revision: fn.serviceConfig.revision, state: fn.state, sourceVerified: true }); record();
      console.log(name + ': ACTIVE and source verified');
    }
  }
  // Media/gateway first. Keep the upload/save API unavailable until all existing
  // authorities/producers can interpret the additive reference field.
  await createSelected(['wacliBookingReferenceMedia', 'cleanupBookingReferenceUploads', 'notifyBookingReferenceUpdate']);
  for (const [name, entries] of Object.entries(roots)) {
    sourceGate(); sameRuntime(name, before[name]); summary.stage = 'deploy-' + name; record();
    if (prior[name] !== reviewed) cloud(['functions', 'deploy', name, '--project=' + project, '--region=us-central1', '--gen2',
      '--source=' + stage, '--entry-point=' + name, '--runtime=nodejs22', '--run-service-account=' + before[name].serviceConfig.serviceAccountEmail,
      '--quiet', '--format=value(state)']);
    const fn = describe(name); assert.equal(fn.state, 'ACTIVE'); assert.deepEqual(config(fn), config(before[name]), name + ': existing config changed');
    assert.equal(matchingSource(fn, name, entries, [reviewed]), reviewed, name + ': deployed source mismatch');
    if (['wacliOutboundAck', 'wacliOutboundPoll', 'officeBookingAuthority'].includes(name)) await authGate(name);
    summary.functions.push({ name, revision: fn.serviceConfig.revision, state: fn.state, configPreserved: true, sourceVerified: true }); record();
    console.log(name + ': ACTIVE; existing configuration preserved; source verified');
  }
  await createSelected(['bookingVisitReferences']);
  const afterSchedule = scheduler();
  for (const key of ['schedule', 'timeZone', 'state', 'httpTarget', 'retryConfig', 'attemptDeadline']) assert.deepEqual(afterSchedule[key], beforeSchedule[key], 'Existing daily scheduler changed: ' + key);
  const cleanup = JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-cleanupBookingReferenceUploads-us-central1', '--project=' + project, '--location=us-central1', '--format=json(schedule,state)']));
  assert.equal(cleanup.state, 'ENABLED');
  const trigger = describe('notifyBookingReferenceUpdate').eventTrigger;
  assert.equal(trigger.eventType, 'google.cloud.firestore.document.v1.updated');
  assert.ok(trigger.eventFilters.some(f => f.attribute === 'document' && f.value === 'appointments/{appointmentId}'));
  sourceGate(); summary.stage = 'complete'; summary.schedulerPreserved = true; record();
  console.log('PASS: nine bounded functions verified; current daily scheduler preserved; no customer/booking writes or migrations.');
}
main().catch(error => { summary.error = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Release stopped at ' + summary.stage;
  record(); console.error(summary.error);
  // CLI error lines only; never dump runtime descriptions, environment or tokens.
  const details = String(error.stderr || '').split('\n').filter(line => /^(ERROR:|Error:)/.test(line));
  for (const line of details) console.error(line.replace(/https:\/\/\S+/g, '[URL omitted]').slice(0, 600));
  process.exitCode = 1; });
