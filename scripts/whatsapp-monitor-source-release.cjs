'use strict';
// Owner-approved monitoring metadata release. Never sends, claims or mutates queue records.
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
const PUBLISHED = require('./whatsapp-monitor-published-sources.json');
const PROJECT = 'demac-corporation', REGION = 'us-central1';
const BUCKET = 'gcf-v2-sources-1053571783393-us-central1';
const BRANCH = 'release/whatsapp-monitor-20261019';
const BASE = '2024b537f93aa6824f5b5e788ef24b46a2baaded';
const REVIEWED = '5cff22bb09a16b3d8eebae43eb998b6cec5f8922';
const FILES = ['appointmentNotifications.js', 'appointmentNotificationService.js', 'technicianScheduleChangeService.js', 'whatsappWacliGateway.js'];
const TARGETS = ['queueAppointmentConfirmation', 'wacliOutboundPoll'];
const TESTS = ['appointmentNotificationService.test.js', 'technicianScheduleChangeService.test.js', 'appointmentCommunicationAuthority.test.js', 'vanScheduleCommunicationAuthority.test.js', 'whatsappWacliGateway.test.js', 'bookingVisitReferences.test.js', 'bookingVisitReferencesHttp.test.js', 'whatsappReferenceBundle.test.js'];
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(stable(v))).digest('hex');
function resumedTransport(entry,published=PUBLISHED) {
  assert.equal(published.releaseSha,'60ace9a86228fe5132fa0bf4e1a32847ec4c449b');
  assert.equal(published.runId,39328826817);assert.equal(entry.alreadyPresent,true);
  const proof=published.functions.find(value=>value.name===entry.name);
  assert.ok(proof,'Missing prior publication evidence');
  assert.equal(entry.beforeRevision,proof.afterRevision,'Published source revision advanced');
  assert.equal(entry.beforeSourceHash,proof.candidateSourceHash,'Published source content changed');
  for(const key of ['configHash','iamHash','schedulerHash'])assert.equal(entry[key],proof[key],'Published configuration changed');
  for(const key of ['sourceVerified','configPreserved','iamPreserved','schedulerPreserved','trafficVerified'])assert.equal(proof[key],true);
  assert.equal(proof.transport.fullManifestHash,entry.beforeSourceHash);
  patchFor(entry.name,proof.transport);
  return proof.transport;
}
function filesForFunction(name) {
  assert.ok(TARGETS.includes(name), 'Unapproved function');
  return name === 'wacliOutboundPoll' ? ['whatsappWacliGateway.js'] : FILES.filter(f => f !== 'whatsappWacliGateway.js');
}
function testsForFunction(name) {
  assert.ok(TARGETS.includes(name), 'Unapproved function');
  return name === 'wacliOutboundPoll' ? TESTS.slice(4) : TESTS.slice(0,4);
}
function verifyDelta(before, after, name) {
  const selected = filesForFunction(name);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort();
  assert.deepEqual(changed, [...selected].sort(), 'Unexpected message source delta');
  for (const f of selected) assert.ok(before[f] && after[f], 'Existing source module required');
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
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/' + BRANCH);
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const root = process.cwd(), out = path.join(process.env.RUNNER_TEMP, 'whatsapp-monitor-source-release'); fs.mkdirSync(out);
  const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const cloud = args => run('gcloud', args);
  const summary = { sourceSha: process.env.GITHUB_SHA, mode: 'source-only', stage: 'preflight', customerReads: false, productionDataWrites: false, functions: [] };
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
    if (!['sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules'].includes(name)) return null;
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
    const candidates = [];
    // Validate and retain both candidates before the first production patch.
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
      checkpoint('verify-reviewed-patch');
      let alreadyPresent = false;
      try { run('git', ['apply', '--check', '-p2', patchPath], candidate); }
      catch { run('git', ['apply', '--reverse', '--check', '-p2', patchPath], candidate); alreadyPresent = true; }
      if (!alreadyPresent) run('git', ['apply', '-p2', patchPath], candidate);
      const files = manifest(candidate);
      if (alreadyPresent) assert.deepEqual(files, before.files); else verifyDelta(before.files, files, name);
      checkpoint('configuration');
      const entry = { name, alreadyPresent, changedFiles: alreadyPresent ? [] : selectedFiles, beforeRevision: fn.serviceConfig.revision, beforeSourceHash: runtimeSourceHash(before.files), candidateSourceHash: runtimeSourceHash(files), configHash: hash(releaseConfig(fn)), iamHash: iam(fn), schedulerHash: scheduler(name), operations: [] };
      summary.functions.push(entry); save();
      checkpoint('test-candidate');
      entry.validation = validateCandidate({ source: candidate, root, out, env: isolatedTestEnv(process.env), candidate: true, reconstruct: false, name: name + '-candidate', selectedTests: testsForFunction(name), updatedTests: testsForFunction(name), smokeScript: 'whatsapp-monitor-runtime-smoke.cjs' });
      assert.deepEqual(manifest(candidate), files);
      checkpoint('retain-baseline');
      entry.recovery = await retainZip({ name: name + 'Baseline', directory: before.directory, archive: { sha256: before.archiveHash }, out, prepared, cloud });
      const zipped = createZip(candidate, path.join(out, name + '-proof.zip'));
      checkpoint('retain-candidate');
      entry.transport = entry.alreadyPresent ? resumedTransport(entry) : await retainZip({ name, directory: candidate, archive: { sha256: zipped.sha256 }, out, prepared, cloud });
      candidates.push({ entry, patch: patchFor(name, entry.transport) }); save();
    }
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
    for (const { entry } of candidates) {
      const fn = describe(entry.name); assert.equal(fn.state, 'ACTIVE');
      assert.equal(fn.serviceConfig.revision, entry.afterRevision, 'Published revision changed');
      assert.equal(runtimeSourceHash(download(fn.buildConfig.source.storageSource, entry.name + '-final').files), entry.candidateSourceHash);
      assert.equal(hash(releaseConfig(fn)), entry.configHash); assert.equal(iam(fn), entry.iamHash);
      assert.equal(scheduler(entry.name), entry.schedulerHash); verifyTraffic(service(fn), entry.afterRevision);
    }
    summary.stage = 'complete'; save();
    console.log('PASS: two source-only monitor metadata updates, exact source, configuration, IAM, scheduler and traffic verified.');
  } catch (error) {
    summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Release failed at ' + summary.stage;
    save(); console.error(summary.error); process.exitCode = 1;
  }
}
module.exports = { verifyDelta, patchFor, filesForFunction, testsForFunction, resumedTransport, FILES, TARGETS, TESTS };
if (require.main === module) main();
