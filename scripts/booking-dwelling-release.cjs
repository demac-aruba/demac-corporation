'use strict';
// Source-only, owner-approved PR #570 release. No database or messaging clients.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { validateCandidate, validateLock } = require('./booking-dwelling-candidate-validation.cjs');
const { canonicalFunctionConfig } = require('./booking-references-release-config.cjs');
const PROJECT = 'demac-corporation';
const BASE = '1e9b4568a461367ee4aa8cff25ef34ebc73f19c9';
const RELEASE = 'release/booking-dwelling-messages-20261012';
const FILES = ['appointmentNotificationService.js', 'technicianDailyScheduleService.js', 'technicianScheduleChangeService.js'];
const HELPER = 'bookingLocationDisplay.js';
// SHA256 of every candidate file except top-level packaging controls, calculated
// from verified recovery artifact 11774320564 (run 38308594583). Resume must keep
// the exact application/dependency source already audited before first rollout.
const REVIEWED_RUNTIME_HASHES = {
  officeBookingAuthority: '12336022f661ad3f652b985085850bb85d3ddd212651063b4bedf1d6bb260141',
  queueAppointmentConfirmation: '0b7c0e962c35c7ba7114fd1b92052cd1b949ee727d978520088fdd91d599fd51',
  sendDailyAppointmentReminders: '074987067b86431758182e737a3659ab800a295d10f8db91c60347ab306d05ac',
  sendDailyTechnicianSchedules: '9ed6d1bb89cc4dd748e043374d5fc9af4951fd13a57f17aa6a8a804c82350f61',
  notifyBookingReferenceUpdate: '9ed6d1bb89cc4dd748e043374d5fc9af4951fd13a57f17aa6a8a804c82350f61',
};
const ORIGINAL_CONFIG_HASHES = {
  officeBookingAuthority: '1f3068bd669b1ffdd17ef79f170546722a42131d2949a0566852f929d95e6e39',
  queueAppointmentConfirmation: '8b7f2699c512d05c5939c324a176875c5b7f5189936ceb20216468769feed90e',
  sendDailyAppointmentReminders: '3d720df0ee9baecc52a41bde4aff9017229564af91acd247b1b6ba89cb234a9c',
  sendDailyTechnicianSchedules: 'b7b7339fb02024d49d7e3eb04ab148a9361964b229ec849f3abaf023617694fc',
  notifyBookingReferenceUpdate: '956adcd5f88a66e4c349347e5f6fe667b59cf2b25d9bec73c440f646511af662',
};
const ORIGINAL_IAM_HASHES = {
  officeBookingAuthority: '6ea6e4e297bf9c84cb0dd0386bb594b16b49cb13448749e5f7e28ed2086997a3',
  queueAppointmentConfirmation: 'de8e97540ca3499319bd4571ad89c465fd68328a4c4f26d143ca6f58d31816ac',
  sendDailyAppointmentReminders: '0a9f0f0cf9920bbd720502038841bb01d91ee7786857a4ca7fb8af813490fe63',
  sendDailyTechnicianSchedules: '1e84322e6e8cbecc8235e7ba418fded5f83ca5653acce8375881231d349e0eb9',
  notifyBookingReferenceUpdate: 'de8e97540ca3499319bd4571ad89c465fd68328a4c4f26d143ca6f58d31816ac',
};
const FUNCTIONS = ['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate'];
const TESTS = ['appointmentNotificationService.test.js', 'technicianDailyScheduleService.test.js', 'technicianScheduleChangeService.test.js'];
function sourceFilesForFunction(name) {
  assert.ok(FUNCTIONS.includes(name));
  if (name === 'sendDailyAppointmentReminders') return [FILES[0]];
  if (['sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate'].includes(name)) return [FILES[1]];
  return FILES;
}
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest('hex');
const runtimeSourceHash = manifest => hash(Object.fromEntries(Object.entries(manifest).filter(([file]) => !['.gitignore', '.gcloudignore'].includes(file))));
function verifyPublishedSource(candidate, published) {
  const omittedPackagingFiles = [];
  for (const [file, digest] of Object.entries(candidate)) {
    if (file === '.gcloudignore') continue;
    // gcloud's generated ignore file excludes .gitignore itself. Allow absence,
    // but require the reviewed bytes if the publisher includes it.
    if (file === '.gitignore' && !Object.hasOwn(published, file)) { omittedPackagingFiles.push(file); continue; }
    assert.equal(published[file], digest, 'Published source differs: ' + file);
  }
  for (const file of Object.keys(published)) assert.ok(Object.hasOwn(candidate, file) || file === '.gcloudignore', 'Unexpected published file: ' + file);
  assert.equal(runtimeSourceHash(published), runtimeSourceHash(candidate), 'Published application manifest differs');
  return omittedPackagingFiles;
}
const releaseConfig = fn => ({ ...canonicalFunctionConfig(fn), build: Object.fromEntries(Object.entries(fn.buildConfig).filter(([key]) => !['build', 'source', 'sourceProvenance', 'sourceToken'].includes(key))) });
const configHash = fn => hash(releaseConfig(fn));
function configurationRestorationPlan(name, fn, expectedHash) {
  if (configHash(fn) === expectedHash) return { required: false };
  assert.equal(name, 'notifyBookingReferenceUpdate', 'Unapproved original configuration drift');
  assert.equal(fn.serviceConfig.maxInstanceCount, 20, 'Unexpected scaling-policy drift');
  assert.equal(fn.eventTrigger?.retryPolicy, 'RETRY_POLICY_RETRY', 'Original retry policy must remain enabled');
  const restored = structuredClone(fn); delete restored.serviceConfig.maxInstanceCount;
  // Read-only diagnostic 38312663741 proved this is the sole added API field.
  // Require every other build/runtime/trigger field to match the pre-rollout hash.
  assert.equal(configHash(restored), expectedHash, 'Configuration differs beyond the known maximum-instance restoration');
  return { required: true, field: 'serviceConfig.maxInstanceCount', observedMaxInstances: 20, restoreUnspecified: true };
}

function safePaths(files) {
  assert.ok(files.length > 0, 'Empty source archive');
  for (const file of files) assert.ok(!path.posix.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), 'Unsafe source archive path');
}
function deployArgs(name, stage) {
  assert.ok(FUNCTIONS.includes(name), 'Unapproved function');
  assert.ok(path.isAbsolute(stage), 'Absolute stage required');
  return ['functions', 'deploy', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--source=' + stage,
    ...(name === 'notifyBookingReferenceUpdate' ? ['--retry', '--clear-max-instances'] : []), '--quiet', '--format=value(state)'];
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
function validateRecoveredLock(content, manifest) {
  const lock = JSON.parse(content);
  assert.ok(lock.lockfileVersion >= 2 && lock.packages?.[''], 'Runtime image has no verifiable npm lock');
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies, 'Image lock does not match deployed dependency declarations');
  for (const name of Object.keys(manifest.dependencies || {})) {
    const pkg = lock.packages['node_modules/' + name];
    assert.ok(pkg?.version && pkg?.integrity, 'Image lock has no exact package integrity: ' + name);
  }
  return lock;
}
function authorizeReconstruction(name, revision, liveDependencies, originalDependencies, approvedDependencies) {
  assert.equal(name, 'officeBookingAuthority', 'Unreviewed missing-lock function');
  assert.equal(revision, 'officebookingauthority-00082-dov', 'Unreviewed missing-lock revision');
  assert.deepEqual(liveDependencies, originalDependencies, 'Unreviewed dependency declarations');
  assert.deepEqual(approvedDependencies, { 'firebase-admin': '^13.4.0', 'firebase-functions': '^6.4.0', sharp: '0.35.5', nodemailer: '10.0.16' }, 'Unreviewed reconstruction dependency change');
}
function verifyPreparedRelease(prepared, current) {
  assert.equal(prepared.stage, 'complete');
  assert.equal(prepared.sourceSha, current.sourceSha);
  assert.deepEqual(prepared.functions.map(item => item.name).sort(), [...FUNCTIONS].sort());
  assert.deepEqual(current.functions.map(item => item.name).sort(), [...FUNCTIONS].sort());
  for (const item of current.functions) {
    const audited = prepared.functions.find(entry => entry.name === item.name);
    for (const key of ['beforeRevision', 'originalManifestHash', 'baselineManifestHash', 'candidateManifestHash', 'baselineArchiveSha256', 'candidateArchiveSha256', 'configHash', 'targetConfigHash', 'iamHash']) {
      assert.ok(item[key], 'Missing prepared evidence: ' + key);
      assert.equal(item[key], audited[key], 'Prepared recovery/candidate differs: ' + key);
    }
    assert.deepEqual(item.configurationRestoration, audited.configurationRestoration, 'Prepared configuration restoration differs');
    assert.equal(audited.rollbackSourceVerified, true);
    assert.equal(audited.baselineResult.runtimeSmokePassed, true);
    assert.equal(audited.candidateResult.runtimeSmokePassed, true);
  }
}
function isolatedTestEnv(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) if (/CREDENTIAL|GOOGLE_GHA_CREDS|FIREBASE_CONFIG/.test(key)) delete env[key];
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_PROJECT', 'GCP_PROJECT']) env[key] = 'demo-demac-dwelling-runtime';
  // All tested persistence uses in-memory doubles. An accidental SDK call must
  // fail against loopback, never discover a production endpoint or credential.
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) env[key] = '127.0.0.1:1';
  return env;
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22', 'Production-matching Node 22 required');
  const deploy = process.argv.includes('--deploy');
  const root = process.cwd();
  const out = path.join(process.env.RUNNER_TEMP || '', deploy ? 'dwelling-release-publish' : 'dwelling-release');
  const preparedPath = path.join(process.env.RUNNER_TEMP || '', 'dwelling-release/summary.json');
  const prepared = deploy ? JSON.parse(fs.readFileSync(preparedPath)) : null;
  if (deploy) {
    assert.equal(prepared.stage, 'complete', 'Completed preparation required');
    assert.equal(prepared.sourceSha, process.env.GITHUB_SHA, 'Prepared head differs');
    assert.match(process.env.RECOVERY_ARTIFACT_ID || '', /^\d+$/, 'Recovery package must be uploaded before deploy');
  }
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'Runner directory required');
  fs.mkdirSync(out, { recursive: true });
  const summary = { project: PROJECT, mode: deploy ? 'deploy' : 'read-only-audit', stage: 'preflight', functions: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const git = args => run('git', args).trim();
  const cloud = args => run('gcloud', args);
  const describe = name => JSON.parse(cloud(['functions', 'describe', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--format=json']));
  const iamHash = fn => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=us-central1', '--format=json'])));
  const scheduler = name => JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-' + name + '-us-central1', '--project=' + PROJECT, '--location=us-central1', '--format=json']));
  const schedulerHash = job => hash(Object.fromEntries(['schedule', 'timeZone', 'state', 'httpTarget', 'retryConfig', 'attemptDeadline'].map(key => [key, job[key]])));
  const remote = ref => git(['ls-remote', 'origin', 'refs/heads/' + ref]).split(/\s/)[0];
  const sourceGate = () => {
    assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation', 'Wrong repository');
    assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA, 'Wrong checkout');
    const branch = process.env.GITHUB_REF === 'refs/heads/' + RELEASE ? RELEASE : 'fix/booking-dwelling-messages';
    if (deploy) assert.equal(branch, RELEASE, 'Deployment requires release branch');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/' + branch, 'Wrong task/release branch');
    assert.equal(remote(branch), process.env.GITHUB_SHA, 'Branch advanced');
    git(['merge-base', '--is-ancestor', BASE, 'HEAD']);
    if (branch === RELEASE) {
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
    const helper = fs.readFileSync(path.join(root, 'functions', HELPER));
    const before = {}, candidates = {}, configs = {}, policies = {}, schedules = {};
    const bundleDir = path.join(out, 'packages'); fs.mkdirSync(bundleDir);
    const originalDependencies = JSON.parse(run('git', ['show', BASE + ':functions/package.json'])).dependencies;
    const approvedPackage = JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json')));
    const approvedLock = fs.readFileSync(path.join(root, 'functions/package-lock.json'));
    validateLock(approvedLock, approvedPackage);
    for (const name of ['sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules']) {
      const job = scheduler(name); assert.equal(job.state, 'ENABLED'); assert.equal(job.timeZone, 'America/Aruba');
      assert.equal(job.schedule, name === 'sendDailyTechnicianSchedules' ? '0,5,10 8 * * *' : '0 10 * * *');
      schedules[name] = schedulerHash(job);
    }
    await boundaries();
    for (const name of FUNCTIONS) {
      summary.stage = 'audit-' + name; save();
      const checkpoint = label => { summary.stage = 'audit-' + name + '-' + label; save(); };
      const selectedFiles = sourceFilesForFunction(name);
      const selectedTests = selectedFiles.map(file => file.replace('.js', '.test.js'));
      const patch = run('git', ['diff', '--binary', BASE, 'HEAD', '--', ...selectedFiles.map(file => 'functions/' + file)]);
      const patchPath = path.join(out, name + '.patch'); fs.writeFileSync(patchPath, patch);
      const fn = describe(name); assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.runtime, 'nodejs22'); assert.equal(fn.buildConfig.entryPoint, name);
      before[name] = fn; configs[name] = configHash(fn); policies[name] = iamHash(fn);
      const configurationRestoration = configurationRestorationPlan(name, fn, ORIGINAL_CONFIG_HASHES[name]);
      assert.equal(policies[name], ORIGINAL_IAM_HASHES[name], 'Original IAM changed: ' + name);
      if (configurationRestoration.required) console.log(name + ': confirmed sole configuration drift is the added max-instance limit; exact original hash requires restoration');
      checkpoint('download-source');
      const stage = path.join(out, name); const original = download(fn, stage);
      const livePackage = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
      checkpoint('verify-package-provenance');
      git(['cat-file', '-e', git(['hash-object', path.join(stage, 'package.json')]) + '^{blob}']);
      const originalManifestHash = hash(original);
      const reconstructed = !original['package-lock.json'];
      if (reconstructed) {
        // Explicitly authorized reconstruction on 2026-10-12. This is a new
        // tested dependency baseline, NOT recovery of the lost runtime lock.
        authorizeReconstruction(name, fn.serviceConfig.revision, livePackage.dependencies, originalDependencies, approvedPackage.dependencies);
        fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ ...livePackage, dependencies: approvedPackage.dependencies }, null, 2) + '\n');
        fs.writeFileSync(path.join(stage, 'package-lock.json'), approvedLock);
        original['package.json'] = hash(fs.readFileSync(path.join(stage, 'package.json')));
        original['package-lock.json'] = hash(approvedLock);
      }
      validateLock(fs.readFileSync(path.join(stage, 'package-lock.json')), JSON.parse(fs.readFileSync(path.join(stage, 'package.json'))));
      // Recovery bundles contain only known repository blobs, validated public
      // dependency metadata and the generated ignore file; never cloud config.
      for (const file of Object.keys(original)) {
        assert.ok(!/(^|\/)\.env(?:\.|$)|\.(?:pem|key)$|(?:credential|service-account)\.json$/i.test(file), 'Private file cannot enter a recovery artifact');
        if (['package.json', 'package-lock.json', '.gcloudignore'].includes(file)) continue;
        checkpoint('source-provenance-' + file.replace(/[^a-zA-Z0-9_.-]/g, '_'));
        const object = git(['hash-object', path.join(stage, file)]);
        git(['cat-file', '-e', object + '^{blob}']);
      }
      let alreadyApplied = false;
      checkpoint('verify-reviewed-patch');
      try { run('git', ['apply', '--check', '-p2', patchPath], stage); }
      catch {
        run('git', ['apply', '--reverse', '--check', '-p2', patchPath], stage);
        assert.equal(original[HELPER], hash(helper), 'Partial or unknown previous patch');
        alreadyApplied = true;
      }
      const baseline = stage + '-baseline'; fs.cpSync(stage, baseline, { recursive: true });
      checkpoint('test-baseline');
      const baselineResult = validateCandidate({ source: baseline, root, out, env: isolatedTestEnv(process.env), candidate: alreadyApplied, reconstruct: name === 'officeBookingAuthority', name: name + '-baseline', selectedTests });
      const baselineManifest = sourceManifest(baseline);
      if (!alreadyApplied) run('git', ['apply', '-p2', patchPath], stage);
      fs.writeFileSync(path.join(stage, HELPER), helper);
      const candidate = sourceManifest(stage); const changed = verifyDelta(original, candidate, hash(helper));
      assert.equal(runtimeSourceHash(candidate), REVIEWED_RUNTIME_HASHES[name], 'Candidate differs from original reviewed recovery artifact: ' + name);
      checkpoint('test-candidate');
      const candidateResult = validateCandidate({ source: stage, root, out, env: isolatedTestEnv(process.env), candidate: true, reconstruct: name === 'officeBookingAuthority', name: name + '-candidate', selectedTests });
      const restored = stage + '-restored'; fs.cpSync(stage, restored, { recursive: true });
      if (!alreadyApplied) {
        run('git', ['apply', '--reverse', '-p2', patchPath], restored);
        fs.rmSync(path.join(restored, HELPER));
      }
      assert.deepEqual(sourceManifest(restored), baselineManifest, 'Rollback source differs from tested baseline');
      fs.rmSync(restored, { recursive: true });
      const archiveHashes = {};
      for (const [label, directory] of [['baseline', baseline], ['candidate', stage]]) {
        const archive = path.join(bundleDir, name + '-' + label + '.tar.gz');
        run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', directory, '.']);
        const extracted = directory + '-archive-verification'; fs.mkdirSync(extracted);
        run('tar', ['-xzf', archive, '-C', extracted]);
        assert.deepEqual(sourceManifest(extracted), label === 'baseline' ? baselineManifest : candidate, 'Recovery/archive round trip differs');
        fs.rmSync(extracted, { recursive: true });
        archiveHashes[label + 'ArchiveSha256'] = hash(fs.readFileSync(archive));
      }
      const recoveredLock = reconstructed ? { source: 'owner-approved-reconstruction', sha256: original['package-lock.json'], previousVersionsUnknown: true } : null;
      candidates[name] = candidate;
      summary.functions.push({ name, state: fn.state, beforeRevision: fn.serviceConfig.revision, rollbackSource: fn.buildConfig.source.storageSource,
        configHash: configs[name], targetConfigHash: ORIGINAL_CONFIG_HASHES[name], configurationRestoration, iamHash: policies[name], changedFiles: [...changed, ...(reconstructed ? ['package.json', 'package-lock.json'] : [])], recoveredLock,
        originalManifestHash, baselineManifestHash: hash(baselineManifest), candidateManifestHash: hash(candidate), reviewedRuntimeHash: runtimeSourceHash(candidate), originalRecoveryArtifactId: '11774320564', ...archiveHashes, baselineResult, candidateResult, rollbackSourceVerified: true,
        alreadyApplied, actualSourceTestsPassed: true, codeHashes: Object.fromEntries([...FILES, HELPER].map(file => [file, candidate[file]])) }); save();
      console.log(name + ': baseline ' + baselineResult.testsPassed + ' tests; candidate ' + candidateResult.testsPassed + ' tests; runtime and recovery verified');
    }
    const unchanged = name => {
      const fresh = describe(name); assert.equal(fresh.state, 'ACTIVE');
      assert.deepEqual(fresh.buildConfig.source, before[name].buildConfig.source, 'Concurrent source deployment');
      assert.equal(fresh.serviceConfig.revision, before[name].serviceConfig.revision, 'Concurrent revision');
      assert.equal(configHash(fresh), configs[name], 'Concurrent config change'); assert.equal(iamHash(fresh), policies[name], 'Concurrent IAM change');
    };
    sourceGate(); for (const name of FUNCTIONS) unchanged(name);
    const deploymentWindowAudit = () => {
      // Read timestamps only, never request bodies, customer data or log text.
      const query = 'resource.type="cloud_run_revision" AND resource.labels.service_name="notifybookingreferenceupdate" AND timestamp>="2026-10-12T21:31:00Z" AND (severity>=ERROR OR httpRequest.status>=500)';
      const values = cloud(['logging', 'read', query, '--project=' + PROJECT, '--limit=1000', '--format=value(timestamp)']).trim();
      const errorCount = values ? values.split('\n').length : 0;
      return { from: '2026-10-12T21:31:00Z', observedAt: new Date().toISOString(), observedErrorCount: errorCount, completeWithinLimit: errorCount < 1000 };
    };
    summary.deploymentWindowAudit = deploymentWindowAudit(); save();
    assert.equal(summary.deploymentWindowAudit.observedErrorCount, 0, 'Reference-update errors in deployment window require investigation; no automatic replay');
    // Check every prepared package before the first production write.
    if (deploy) verifyPreparedRelease(prepared, summary);
    if (deploy) for (const name of FUNCTIONS) {
      sourceGate(); unchanged(name); summary.stage = 'deploy-' + name; save();
      const stage = path.join(out, name);
      assert.deepEqual(sourceManifest(stage), candidates[name], 'Staged source changed after audit');
      console.log('Deploying reviewed source and approved dependency baseline: ' + name);
      const reviewed = summary.functions.find(item => item.name === name);
      if (!reviewed.alreadyApplied || reviewed.configurationRestoration.required) cloud(deployArgs(name, stage));
      const after = describe(name); assert.equal(after.state, 'ACTIVE');
      assert.equal(configHash(after), ORIGINAL_CONFIG_HASHES[name], 'Original runtime configuration not preserved/restored'); assert.equal(iamHash(after), ORIGINAL_IAM_HASHES[name], 'Original IAM changed');
      const published = download(after, stage + '-published');
      const omittedPackagingFiles = verifyPublishedSource(candidates[name], published);
      Object.assign(reviewed, { afterRevision: after.serviceConfig.revision, publishedSourceVerified: true, omittedPackagingFiles, configPreserved: true, originalScalingRestored: reviewed.configurationRestoration.required, iamPreserved: true }); save();
    }
    for (const [name, digest] of Object.entries(schedules)) assert.equal(schedulerHash(scheduler(name)), digest, 'Scheduler changed');
    await boundaries(); sourceGate();
    if (deploy) {
      summary.deploymentWindowAudit = deploymentWindowAudit(); save();
      assert.equal(summary.deploymentWindowAudit.observedErrorCount, 0, 'Reference-update errors in deployment window require investigation; no automatic replay');
    }
    summary.stage = 'complete'; summary.schedulersPreserved = true; summary.actualDomainBoundariesPassed = true; save();
    fs.copyFileSync(path.join(out, 'summary.json'), path.join(bundleDir, 'manifest.json'));
    console.log('PASS: ' + summary.mode + '; no customer data, queue, group or scheduler mutations.');
  } catch (error) {
    summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Command failed during ' + summary.stage;
    summary.exitStatus = error.status || error.code || null; save();
    const diagnostic = String(error.stderr || '');
    summary.failureCategories = [
      ['permission-denied', /PERMISSION_DENIED|Permission denied|does not have permission|denied:|403/i],
      ['not-found', /NOT_FOUND|not found|No such file|Could not find|404/i],
      ['invalid-command', /unrecognized arguments|Invalid resource|invalid choice/i],
      ['registry-authentication', /unauthorized|authentication required|Unauthenticated/i],
    ].filter(([, pattern]) => pattern.test(diagnostic)).map(([label]) => label);
    save();
    // Cloud output/configuration can contain secrets. Emit only the safe stage.
    console.error(summary.error); process.exitCode = 1;
    if (summary.failureCategories.length) console.error('Failure categories: ' + summary.failureCategories.join(', '));
  }
}
module.exports = { safePaths, deployArgs, verifyDelta, validateRecoveredLock, isolatedTestEnv, authorizeReconstruction, verifyPreparedRelease, releaseConfig, sourceFilesForFunction, verifyPublishedSource, runtimeSourceHash, configHash, configurationRestorationPlan };
if (require.main === module) main();
