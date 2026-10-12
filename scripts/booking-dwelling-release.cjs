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
  const recoverLock = (fn, stage, manifest) => {
    // Never generate a new lock from floating ranges. Copy the existing one
    // from the immutable image serving this exact Cloud Run revision.
    const auditStage = summary.stage;
    const checkpoint = label => { summary.stage = auditStage + '-' + label; save(); };
    checkpoint('describe-running-revision');
    const revision = JSON.parse(cloud(['run', 'revisions', 'describe', fn.serviceConfig.revision,
      '--project=' + PROJECT, '--region=us-central1', '--format=json']));
    const image = revision.status?.imageDigest;
    assert.ok(typeof image === 'string' && image.includes('/' + PROJECT + '/') && /@sha256:[a-f0-9]{64}$/.test(image), 'Immutable production image required');
    const host = image.split('/')[0]; assert.ok(host.endsWith('-docker.pkg.dev'), 'Unexpected image registry');
    checkpoint('registry-auth');
    cloud(['auth', 'configure-docker', host, '--quiet']);
    checkpoint('read-immutable-image');
    try { run('docker', ['pull', image]); }
    catch (error) {
      // Read-only provenance diagnostics. Never publish raw build logs,
      // environment variables, cloud configuration or credential output.
      const diagnostic = { revision: fn.serviceConfig.revision, image,
        imageMissing: /manifest unknown|not found|name unknown/i.test(String(error.stderr || '')),
        manifestMissing: /manifest unknown/i.test(String(error.stderr || '')),
        missingCommand: error.code === 'ENOENT', build: fn.buildConfig.build || null };
      const imageReference = value => typeof value === 'string' &&
        /^[a-z0-9-]+-docker\.pkg\.dev\/demac-corporation\/[a-zA-Z0-9_./:@-]+$/.test(value) ? value : null;
      diagnostic.revisionImages = (revision.spec?.containers || []).map(item => imageReference(item.image)).filter(Boolean);
      const buildRef = fn.buildConfig.build?.match(/^projects\/[^/]+\/locations\/([^/]+)\/builds\/([a-f0-9-]+)$/);
      if (buildRef) {
        try {
          const build = JSON.parse(cloud(['builds', 'describe', buildRef[2], '--project=' + PROJECT, '--region=' + buildRef[1], '--format=json']));
          diagnostic.buildResult = { status: build.status, finishTime: build.finishTime,
            images: (build.results?.images || []).map(item => ({ name: imageReference(item.name), digest: /^sha256:[a-f0-9]{64}$/.test(item.digest) ? item.digest : null })),
            outputImages: (build.images || []).map(imageReference).filter(Boolean),
            artifactsPresent: Boolean(build.artifacts), source: build.sourceProvenance?.resolvedStorageSource || null };
          const steps = JSON.stringify((build.steps || []).map(step => ({ name: step.name, args: step.args })));
          diagnostic.buildReferences = {
            images: [...new Set((steps.match(/[a-z0-9-]+-docker\.pkg\.dev\/demac-corporation\/[a-zA-Z0-9_./:@-]+/g) || []).filter(imageReference))],
            storage: [...new Set(steps.match(/gs:\/\/gcf-[a-zA-Z0-9_./#-]+/g) || [])],
          };
          try {
            const logs = cloud(['builds', 'log', buildRef[2], '--project=' + PROJECT, '--region=' + buildRef[1]]);
            diagnostic.buildLogEvidence = {
              generatedLock: /generat(?:e|ed|ing)[^\n]*package-lock/i.test(logs),
              usedNpmCi: /(?:Running|executing)[^\n]*npm ci/i.test(logs),
              usedNpmInstall: /(?:Running|executing)[^\n]*npm install/i.test(logs),
              usedCache: /cache hit|reus(?:e|ed|ing)[^\n]*(?:node_modules|dependencies)/i.test(logs),
              packageVersions: [...new Set(logs.match(/(?:firebase-admin|firebase-functions|nodemailer|sharp)@\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?/g) || [])],
              storage: [...new Set(logs.match(/gs:\/\/gcf-[a-zA-Z0-9_./#-]+/g) || [])],
            };
          } catch { diagnostic.buildLogReadFailed = true; }
        } catch { diagnostic.buildReadFailed = true; }
      }
      try {
        const repo = fn.buildConfig.dockerRepository.match(/^projects\/[^/]+\/locations\/([^/]+)\/repositories\/([^/]+)$/);
        assert.ok(repo, 'Unknown image repository');
        const registry = JSON.parse(cloud(['artifacts', 'repositories', 'describe', repo[2], '--project=' + PROJECT, '--location=' + repo[1], '--format=json']));
        diagnostic.cleanup = { dryRun: registry.cleanupPolicyDryRun, policies: registry.cleanupPolicies };
        const images = JSON.parse(cloud(['artifacts', 'docker', 'images', 'list',
          image.split('/').slice(0, 3).join('/'), '--project=' + PROJECT,
          '--filter=package~office_booking_authority', '--include-tags', '--limit=50', '--format=json']));
        diagnostic.retainedOfficeImages = images.map(item => ({ uri: imageReference(item.uri),
          package: imageReference(item.package), version: /^sha256:[a-f0-9]{64}$/.test(item.version) ? item.version : null,
          createTime: item.createTime, updateTime: item.updateTime }));
      } catch { diagnostic.repositoryReadFailed = true; }
      summary.recoveryDiagnostics = diagnostic; save();
      throw error;
    }
    checkpoint('inspect-image');
    const workingDir = run('docker', ['image', 'inspect', '--format={{.Config.WorkingDir}}', image]).trim();
    assert.ok(path.posix.isAbsolute(workingDir) && !workingDir.split('/').includes('..'), 'Unknown image work directory');
    const container = run('docker', ['create', '--entrypoint=/bin/false', image]).trim();
    try {
      checkpoint('copy-existing-lock');
      run('docker', ['cp', container + ':' + path.posix.join(workingDir, 'package-lock.json'), path.join(stage, 'package-lock.json')]);
      const content = fs.readFileSync(path.join(stage, 'package-lock.json'), 'utf8');
      validateRecoveredLock(content, manifest);
      summary.stage = auditStage; save();
      return { image, sha256: hash(content), source: 'immutable-running-image' };
    } finally { run('docker', ['rm', container]); }
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
      const livePackage = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
      assert.deepEqual(livePackage.dependencies, JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'))).dependencies, 'Live dependency declarations differ');
      const recoveredLock = original['package-lock.json'] ? null : recoverLock(fn, stage, livePackage);
      if (recoveredLock) original['package-lock.json'] = recoveredLock.sha256;
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
      let tests;
      try {
        tests = execFileSync(process.execPath, ['--test', ...TESTS], { cwd: validation, env: isolatedTestEnv(process.env),
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
      } catch (error) {
        // Only synthetic test output; never cloud stderr or configuration.
        console.error(String(error.stdout || '').split('\n').filter(line => /not ok|error:|Expected|actual:|expected:|fail /.test(line)).join('\n'));
        throw error;
      }
      assert.match(tests, /(?:#|ℹ) fail 0/); fs.rmSync(validation, { recursive: true });
      candidates[name] = candidate;
      summary.functions.push({ name, state: fn.state, beforeRevision: fn.serviceConfig.revision, rollbackSource: fn.buildConfig.source.storageSource,
        configHash: configs[name], iamHash: policies[name], changedFiles: [...changed, ...(recoveredLock ? ['package-lock.json'] : [])], recoveredLock,
        alreadyApplied, actualSourceTestsPassed: true, codeHashes: Object.fromEntries([...FILES, HELPER].map(file => [file, candidate[file]])) }); save();
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
module.exports = { safePaths, deployArgs, verifyDelta, validateRecoveredLock, isolatedTestEnv };
if (require.main === module) main();
