'use strict';
// Owner-approved template editor release. Source-only producer updates plus one isolated authenticated settings API. No queue or customer writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { releaseConfig, runtimeSourceHash, safePaths, isolatedTestEnv } = require('./booking-dwelling-release.cjs');
const { validateCandidate } = require('./booking-dwelling-candidate-validation.cjs');
const { verifyPrivateBucket, verifyInheritedPolicies } = require('./appointment-finance-prepare.cjs');
const { retainZip, sourceVerifier, createZip } = require('./appointment-finance-transport.cjs');
const { updateSource } = require('./appointment-finance-source-update.cjs');
const { verifyTraffic } = require('./appointment-finance-release.cjs');
const PROJECT = 'demac-corporation', REGION = 'us-central1';
const BUCKET = 'gcf-v2-sources-1053571783393-us-central1';
const BRANCH = 'release/message-template-editor-20261019';
const BASE = '78f7ac5ef86897defaf0706a78f2f0209248cb8c';
const REVIEWED = '38533a88da1bf7367e94d6a79611205d54ac5383';
const SHARED = ['messageCopy.js', 'messageCopyStore.js', 'data/message-copy-catalog.json'];
const FILES = ['appointmentCommunicationRenderer.js', 'appointmentNotificationService.js', 'technicianDailyScheduleService.js', 'technicianScheduleChangeService.js', 'whatsappTransactionalService.js', 'taskAssignmentNotificationService.js', 'taskAssignmentNotifications.js', 'taskReminderService.js', 'taskReminders.js', ...SHARED];
const TARGETS = ['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate', 'notifyTaskAssigneeOnCreate', 'processTaskDeadlineReminders', 'sendDailyTaskSummaries'];
const TESTS = ['appointmentCommunicationRenderer.test.js', 'appointmentNotificationService.test.js', 'technicianDailyScheduleService.test.js', 'technicianScheduleChangeService.test.js', 'whatsappTransactionalService.test.js', 'appointmentCommunicationAuthority.test.js', 'vanScheduleCommunicationAuthority.test.js', 'officeBookingAuthorityCommunication.test.js'];
const TASK_TESTS = ['taskReminderService.test.js', 'taskAssignmentNotificationService.test.js'];
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(stable(v))).digest('hex');
function filesForFunction(name) {
  assert.ok(TARGETS.includes(name), 'Unapproved function');
  if (name === 'notifyTaskAssigneeOnCreate') return ['taskAssignmentNotificationService.js', 'taskAssignmentNotifications.js', 'taskReminderService.js', ...SHARED];
  if (['processTaskDeadlineReminders', 'sendDailyTaskSummaries'].includes(name)) return ['taskReminderService.js', 'taskReminders.js', ...SHARED];
  if (name === 'sendDailyAppointmentReminders') return ['appointmentCommunicationRenderer.js', 'appointmentNotificationService.js', 'whatsappTransactionalService.js', ...SHARED];
  if (['sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate'].includes(name)) return ['technicianDailyScheduleService.js', 'whatsappTransactionalService.js', ...SHARED];
  return [...FILES.slice(0,5), ...SHARED];
}
function testsForFunction(name) {
  const files = filesForFunction(name);
  const pool = name.includes('Task') ? TASK_TESTS : TESTS;
  return pool.filter(f => files.includes(f.replace('.test.js', '.js')));
}
function verifyDelta(before, after, name) {
  const selected = filesForFunction(name);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort();
  assert.deepEqual(changed, [...selected].sort(), 'Unexpected template source delta');
  for (const f of selected) { assert.ok(after[f], 'Missing selected source'); if (!SHARED.includes(f)) assert.ok(before[f], 'Existing producer required'); }
  return changed;
}
function patchFor(name, transport) {
  assert.ok(TARGETS.includes(name), 'Unapproved function');
  for (const key of ['privateRetained', 'extractionVerified', 'anonymousAccessDenied']) assert.equal(transport[key], true);
  assert.equal(transport.format, 'zip');
  assert.match(transport.uri, new RegExp('^gs://' + BUCKET + '/codex-release-recovery/appointment-finance/[a-f0-9]{40}/' + name + '-candidate\\.zip$'));
  assert.match(transport.generation, /^\d+$/); assert.match(transport.sha256, /^[a-f0-9]{64}$/);
  return { name: `projects/${PROJECT}/locations/${REGION}/functions/${name}`, buildConfig: { source: { storageSource: {
    bucket: BUCKET, object: transport.uri.slice(('gs://' + BUCKET + '/').length), generation: transport.generation,
  } } } };
}
function patchForArchive(name, patch, files) {
  // This exact deployed reminder variant predates reference bundles. Preserve
  // that contract while adding the same reviewed text-copy composition.
  if (name !== 'sendDailyAppointmentReminders' || ![
    '15b59ed6d516e807f4165e663c106979c4f11cc6ef30334daaf629321c667f1a',
    '15fb9443e052c9d31be7428bd2c89e347dd73b665e1ac02204931a05ab5ae1cf',
  ].includes(files['whatsappTransactionalService.js'])) return patch;
  const parts = patch.split(/(?=^diff --git )/m);
  const header = 'diff --git a/functions/whatsappTransactionalService.js b/functions/whatsappTransactionalService.js\n';
  assert.equal(parts.filter(part => part.startsWith(header)).length, 1);
  return parts.map(part => part.startsWith(header) ? fs.readFileSync(path.join(__dirname, 'message-template-legacy-reminder.patch'), 'utf8') : part).join('');
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/' + BRANCH);
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const root = process.cwd(), out = path.join(process.env.RUNNER_TEMP, 'message-template-editor-release'); fs.mkdirSync(out);
  const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const cloud = args => run('gcloud', args);
  const summary = { sourceSha: process.env.GITHUB_SHA, mode: 'isolated-api-and-source-only-producers', stage: 'preflight', customerReads: false, productionDataWrites: false, functions: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const sourceGate = () => {
    assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), process.env.GITHUB_SHA);
    for (const ref of ['refs/heads/main', 'refs/heads/' + BRANCH]) assert.equal(run('git', ['ls-remote', 'origin', ref]).split(/\s/)[0], process.env.GITHUB_SHA, 'Reviewed branch advanced');
    run('git', ['merge-base', '--is-ancestor', BASE, 'HEAD']);
    run('git', ['merge-base', '--is-ancestor', REVIEWED, 'HEAD']);
  };
  let token, tokenAt = 0;
  const api = async (url, method = 'GET', body) => {
    if (!token || Date.now() - tokenAt > 40 * 60 * 1000) { token = cloud(['auth', 'print-access-token']).trim(); tokenAt = Date.now(); }
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, 'Cloud API ' + method + ' HTTP ' + response.status); return response.json();
  };
  const describe = name => JSON.parse(cloud(['functions', 'describe', name, '--gen2', '--project=' + PROJECT, '--region=' + REGION, '--format=json']));
  const service = fn => JSON.parse(cloud(['run', 'services', 'describe', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=' + REGION, '--format=json']));
  const iam = fn => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=' + REGION, '--format=json'])));
  const scheduler = name => {
    if (!['sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'processTaskDeadlineReminders', 'sendDailyTaskSummaries'].includes(name)) return null;
    const job = JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-' + name + '-us-central1', '--project=' + PROJECT, '--location=' + REGION, '--format=json']));
    return hash(Object.fromEntries(['schedule', 'timeZone', 'state', 'httpTarget', 'retryConfig', 'attemptDeadline'].map(k => [k, job[k]])));
  };
  let downloads = 0;
  const download = (source, label) => {
    assert.equal(source.bucket, BUCKET); assert.ok(source.object); assert.match(String(source.generation), /^\d+$/);
    const directory = path.join(out, label + '-' + ++downloads), zip = directory + '.zip';
    cloud(['storage', 'cp', `gs://${source.bucket}/${source.object}#${source.generation}`, zip, '--quiet']);
    safePaths(run('unzip', ['-Z1', zip]).trim().split('\n')); fs.mkdirSync(directory); run('unzip', ['-q', zip, '-d', directory]);
    return { directory, files: manifest(directory), archiveHash: hash(fs.readFileSync(zip)) };
  };
  try {
    sourceGate(); save();
    const bucket = JSON.parse(cloud(['storage', 'buckets', 'describe', 'gs://' + BUCKET, '--format=json']));
    const policy = JSON.parse(cloud(['storage', 'buckets', 'get-iam-policy', 'gs://' + BUCKET, '--format=json']));
    verifyPrivateBucket(bucket, policy);
    const prepared = { sourceSha: process.env.GITHUB_SHA, recoveryBucketConfigHash: hash(bucket), recoveryBucketPolicyHash: hash(policy) };
    if ((bucket.public_access_prevention ?? bucket.iamConfiguration?.publicAccessPrevention) === 'enforced') prepared.inheritedPrivacy = { mode: 'bucket-public-access-prevention' };
    if (!prepared.inheritedPrivacy) {
      try { const effective = JSON.parse(cloud(['org-policies', 'describe', 'constraints/storage.publicAccessPrevention', '--effective', '--project=' + PROJECT, '--format=json'])); const rules = effective.spec?.rules; if (Array.isArray(rules) && rules.length && rules.every(r => r.enforce === true && !r.condition)) prepared.inheritedPrivacy = { mode: 'effective-public-access-prevention', policyHash: hash(effective) }; } catch { /* Require complete ancestry below. */ }
    }
    if (!prepared.inheritedPrivacy) {
      const ancestors = JSON.parse(cloud(['projects', 'get-ancestors', PROJECT, '--format=json']));
      const policies = ancestors.map(a => { const kind = String(a.type).toLowerCase(); assert.ok(['project','folder','organization'].includes(kind)); return JSON.parse(cloud([...(kind === 'project' ? ['projects'] : kind === 'folder' ? ['resource-manager','folders'] : ['organizations']), 'get-iam-policy', String(a.id), '--format=json'])); });
      verifyInheritedPolicies(ancestors, policies); prepared.inheritedPrivacy = { mode: 'complete-ancestry-iam', levels: ancestors.length, policyHashes: policies.map(hash) };
    }
    const reviewedRoot = path.join(out, 'reviewed'); fs.mkdirSync(reviewedRoot);
    const archive = path.join(out, 'reviewed.tar');
    run('git', ['archive', '--format=tar', '--output=' + archive, REVIEWED, 'functions']);
    run('tar', ['-xf', archive, '-C', reviewedRoot]);
    fs.cpSync(path.join(root, 'scripts'), path.join(reviewedRoot, 'scripts'), { recursive: true });
    const candidates = [], preserved = [];
    // Validate and retain all eight live producer candidates before the first production patch.
    for (const name of TARGETS) {
      const checkpoint = step => { summary.stage = 'prepare-' + name + '-' + step; save(); };
      checkpoint('source-gate'); sourceGate();
      const selectedFiles = filesForFunction(name);
      const patchPath = path.join(out, name + '-message-source.patch');
      fs.writeFileSync(patchPath, run('git', ['diff', '--binary', BASE, REVIEWED, '--', ...selectedFiles.map(f => 'functions/' + f)]));
      assert.ok(fs.statSync(patchPath).size > 0);
      checkpoint('describe');
      const fn = describe(name); assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.runtime, 'nodejs22'); assert.equal(fn.buildConfig.entryPoint, name);
      checkpoint('traffic');
      verifyTraffic(service(fn), fn.serviceConfig.revision);
      checkpoint('download-source');
      const before = download(fn.buildConfig.source.storageSource, name + '-baseline');
      const candidate = path.join(out, name + '-candidate'); fs.cpSync(before.directory, candidate, { recursive: true });
      fs.writeFileSync(patchPath, patchForArchive(name, fs.readFileSync(patchPath, 'utf8'), before.files));
      checkpoint('verify-reviewed-patch');
      let alreadyApplied = false;
      try { run('git', ['apply', '--reverse', '--check', '-p2', patchPath], candidate); alreadyApplied = true; } catch { /* The complete forward patch must apply below. */ }
      if (alreadyApplied) {
        for (const file of SHARED) assert.equal(fs.readFileSync(path.join(candidate, file), 'utf8'), fs.readFileSync(path.join(reviewedRoot, 'functions', file), 'utf8'));
        const entry = { name, alreadyApplied: true, afterRevision: fn.serviceConfig.revision, candidateSourceHash: runtimeSourceHash(before.files), configHash: hash(releaseConfig(fn)), iamHash: iam(fn), schedulerHash: scheduler(name), sourceVerified: true };
        preserved.push(entry); summary.functions.push(entry); save();
        continue;
      }
      run('git', ['apply', '--check', '-p2', patchPath], candidate);
      run('git', ['apply', '-p2', patchPath], candidate);
      const files = manifest(candidate); verifyDelta(before.files, files, name);
      checkpoint('configuration');
      const entry = { name, changedFiles: selectedFiles, beforeRevision: fn.serviceConfig.revision, beforeSourceHash: runtimeSourceHash(before.files), candidateSourceHash: runtimeSourceHash(files), configHash: hash(releaseConfig(fn)), iamHash: iam(fn), schedulerHash: scheduler(name), operations: [] };
      summary.functions.push(entry); save();
      checkpoint('test-candidate');
      entry.validation = validateCandidate({ source: candidate, root: reviewedRoot, out, env: isolatedTestEnv(process.env), candidate: true, reconstruct: false, name: name + '-candidate', selectedTests: name.includes('Task') ? TASK_TESTS : TESTS, updatedTests: testsForFunction(name), smokeScript: 'message-template-runtime-smoke.cjs' });
      assert.deepEqual(manifest(candidate), files);
      checkpoint('retain-baseline');
      entry.recovery = await retainZip({ name: name + 'Baseline', directory: before.directory, archive: { sha256: before.archiveHash }, out, prepared, cloud });
      const zipped = createZip(candidate, path.join(out, name + '-proof.zip'));
      checkpoint('retain-candidate');
      entry.transport = await retainZip({ name, directory: candidate, archive: { sha256: zipped.sha256 }, out, prepared, cloud });
      candidates.push({ entry, patch: patchFor(name, entry.transport) }); save();
    }
    summary.stage = 'install-settings-api'; save();
    const { installApi } = require('./message-template-settings-install.cjs');
    summary.settingsApi = await installApi({ reviewedRoot, out, cloud, api, describe, service, download, prepared, sourceGate, saveStage: stage => { summary.stage = stage; save(); } }); save();
    for (const { entry, patch } of candidates) {
      const name = entry.name;
      const inspect = async ({ allowFailed = false } = {}) => {
        const fn = describe(name); if (!allowFailed) assert.equal(fn.state, 'ACTIVE');
        assert.equal(hash(releaseConfig(fn)), entry.configHash, 'Runtime configuration drift'); assert.equal(iam(fn), entry.iamHash, 'IAM drift'); assert.equal(scheduler(name), entry.schedulerHash, 'Scheduler drift');
        const files = download(fn.buildConfig.source.storageSource, name + '-live').files;
        const sourceHash = runtimeSourceHash(files);
        assert.ok([entry.beforeSourceHash, entry.candidateSourceHash].includes(sourceHash), 'Concurrent source change');
        if (sourceHash === entry.beforeSourceHash) assert.equal(fn.serviceConfig.revision, entry.beforeRevision, 'Concurrent revision change');
        if (fn.state === 'ACTIVE') verifyTraffic(service(fn), fn.serviceConfig.revision);
        return { fn, alreadyApplied: sourceHash === entry.candidateSourceHash };
      };
      sourceGate(); summary.stage = 'publish-' + name; save();
      const sourceMatches = sourceVerifier({ name, transport: entry.transport, downloadHash: src => download(src, name + '-provenance').archiveHash });
      const after = await updateSource({ patch, baselineRevision: entry.beforeRevision, inspect,
        operations: async () => { const found = []; let pageToken; do { const page = await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/operations?pageSize=100` + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')); found.push(...(page.operations || [])); pageToken = page.nextPageToken; } while (pageToken); return found; },
        publish: async body => { sourceGate(); await inspect(); return api('https://cloudfunctions.googleapis.com/v2/' + patch.name + '?updateMask=buildConfig.source', 'PATCH', body); },
        getOperation: name => api('https://cloudfunctions.googleapis.com/v2/' + name), wait: ms => new Promise(resolve => setTimeout(resolve, ms)), sourceMatches,
        record: op => { entry.operations.push({ name: op.name, done: op.done, error: Boolean(op.error), intent: Boolean(op.intent) }); save(); } });
      entry.afterRevision = after.fn.serviceConfig.revision; entry.sourceVerified = true; entry.configPreserved = true; entry.iamPreserved = true; entry.schedulerPreserved = true; entry.trafficVerified = true; save();
      console.log(JSON.stringify({ name, stage: 'verified', revision: entry.afterRevision }));
    }
    sourceGate();
    for (const entry of [...candidates.map(item => item.entry), ...preserved]) {
      const fn = describe(entry.name); assert.equal(fn.state, 'ACTIVE');
      assert.equal(fn.serviceConfig.revision, entry.afterRevision, 'Published revision changed');
      assert.equal(runtimeSourceHash(download(fn.buildConfig.source.storageSource, entry.name + '-final').files), entry.candidateSourceHash);
      assert.equal(hash(releaseConfig(fn)), entry.configHash); assert.equal(iam(fn), entry.iamHash);
      assert.equal(scheduler(entry.name), entry.schedulerHash); verifyTraffic(service(fn), entry.afterRevision);
      entry.configPreserved = true; entry.iamPreserved = true; entry.schedulerPreserved = true; entry.trafficVerified = true;
    }
    for (const origin of ['https://demac-aruba.com', 'https://www.demac-aruba.com']) {
      const endpoint = `https://${REGION}-${PROJECT}.cloudfunctions.net/officeBookingAuthority`;
      const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, signal: AbortSignal.timeout(20000) });
      assert.equal(preflight.status, 204); assert.ok([origin, '*'].includes(preflight.headers.get('access-control-allow-origin')));
      const denied = await fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list_presets', data: {} }), signal: AbortSignal.timeout(20000) });
      assert.equal(denied.status, 401); assert.equal((await denied.json()).error?.code, 'unauthenticated');
    }
    summary.anonymousBoundaryVerified = true; summary.stage = 'complete'; save();
    console.log('PASS: settings API and eight producer sources verified; existing configuration, IAM, scheduler and traffic preserved. No messages replayed.');
  } catch (error) {
    summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Release failed at ' + summary.stage;
    summary.patchFailures = [...String(error.stderr || '').matchAll(/error: patch failed: ([a-zA-Z0-9_.\/-]+:\d+)/g)].map(match => match[1]);
    save(); console.error(summary.error); process.exitCode = 1;
  }
}
module.exports = { verifyDelta, patchFor, patchForArchive, filesForFunction, testsForFunction, FILES, TARGETS, TESTS, SHARED };
if (require.main === module) main();
