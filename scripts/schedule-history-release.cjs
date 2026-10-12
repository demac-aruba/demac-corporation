'use strict';
// Owner-approved PR576: patch only the read action into the current Office bundle.
// No database/messaging client, dependency reconstruction, IAM or config mutation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { safePaths, isolatedTestEnv, releaseConfig, verifyPublishedSource, runtimeSourceHash } = require('./booking-dwelling-release.cjs');
const { validateCandidate } = require('./booking-dwelling-candidate-validation.cjs');
const PROJECT = 'demac-corporation';
const TARGET = 'officeBookingAuthority';
const BASE = '0dc09f3167150ed775018a6f257542961b21cddf';
const REVIEWED = 'fb8ac45be42792de3ed1a41d01ceb4718ca16749';
// Exact source trees from merging the reviewed feature with owner-approved
// QuickBooks main f1700b0. The Office patch still comes only from REVIEWED.
const SOURCE_TREES = { functions: 'c151ad668efb619cc8eb40e2d9e1aedfe44b6e1e', 'apps/erp-next': 'e5070f63d96cb586d1901823810c53bfb879683a' };
const RELEASE = 'release/schedule-slot-history-20261012';
const LIVE_HASH = '12336022f661ad3f652b985085850bb85d3ddd212651063b4bedf1d6bb260141';
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(Buffer.isBuffer(v) || typeof v === 'string' ? v : JSON.stringify(stable(v))).digest('hex');
function manifest(root) {
  const result = {};
  const visit = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name); assert.ok(!item.isSymbolicLink(), 'Unexpected source symlink');
    if (item.isDirectory()) visit(file); else result[path.relative(root, file).split(path.sep).join('/')] = hash(fs.readFileSync(file));
  } }; visit(root); return result;
}
function verifyDelta(before, after, helperHash) {
  assert.equal(runtimeSourceHash(before), LIVE_HASH, 'Office live application changed; audit the new baseline before releasing');
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort();
  assert.deepEqual(changed, ['bookingScheduleHistory.js', 'officeBookingAuthority.js']);
  assert.equal(after['bookingScheduleHistory.js'], helperHash);
  assert.equal(after['package.json'], before['package.json']);
  assert.ok(before['package-lock.json'], 'Existing dependency lock required');
  assert.equal(after['package-lock.json'], before['package-lock.json']);
  return changed;
}
function deployArgs(name, source) {
  assert.equal(name, TARGET, 'Only Office is authorized'); assert.ok(path.isAbsolute(source));
  return ['functions', 'deploy', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--source=' + source, '--quiet', '--format=value(state)'];
}
function verifyPrepared(prepared, current) {
  assert.equal(prepared.stage, 'prepared');
  for (const key of ['sourceSha', 'beforeRevision', 'beforeSource', 'configHash', 'iamHash', 'baselineManifestHash', 'candidateManifestHash', 'baselineArchiveHash', 'candidateArchiveHash']) {
    assert.ok(prepared[key], 'Missing prepared field: ' + key); assert.deepEqual(current[key], prepared[key], 'Prepared package drift: ' + key);
  }
  assert.equal(prepared.baselineResult.runtimeSmokePassed, true);
  assert.equal(prepared.candidateResult.runtimeSmokePassed, true);
  assert.equal(prepared.historyEmulatorPassed, true);
  assert.equal(prepared.rollbackVerified, true);
}
async function main() {
  const root = process.cwd(), deploy = process.argv.includes('--deploy');
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const out = path.join(process.env.RUNNER_TEMP, 'schedule-history-release' + (deploy ? '-publish' : ''));
  const prepared = deploy ? JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'schedule-history-release/summary.json'))) : null;
  if (deploy) assert.match(process.env.RECOVERY_ARTIFACT_ID || '', /^\d+$/, 'Upload recovery before deployment');
  fs.mkdirSync(out, { recursive: true });
  const summary = { mode: deploy ? 'deploy' : 'audit', sourceSha: process.env.GITHUB_SHA, stage: 'preflight' };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const run = (cmd, args, cwd = root, env = process.env) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const git = args => run('git', args).trim(), cloud = args => run('gcloud', args);
  const remote = branch => git(['ls-remote', 'origin', 'refs/heads/' + branch]).split(/\s/)[0];
  const sourceGate = () => {
    assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
    assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA);
    const branch = process.env.GITHUB_REF?.replace('refs/heads/', '');
    assert.ok(['feature/schedule-slot-history', RELEASE].includes(branch));
    assert.equal(remote(branch), process.env.GITHUB_SHA, 'Branch advanced');
    for (const [dir, expected] of Object.entries(SOURCE_TREES)) assert.equal(git(['rev-parse', 'HEAD:' + dir]), expected, 'Reviewed integrated source changed');
    if (deploy) assert.equal(branch, RELEASE);
    if (branch === RELEASE) {
      const current = remote('main'); git(['fetch', 'origin', current]);
      git(['merge-base', '--is-ancestor', current, 'HEAD']);
      for (const dir of ['functions', 'apps/erp-next']) assert.equal(git(['rev-parse', current + ':' + dir]), git(['rev-parse', 'HEAD:' + dir]));
      if (summary.mainSha) assert.equal(summary.mainSha, current, 'Main advanced');
      summary.mainSha = current;
    }
  };
  const describe = () => JSON.parse(cloud(['functions', 'describe', TARGET, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--format=json']));
  const configHash = fn => hash(releaseConfig(fn));
  const iamHash = fn => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=us-central1', '--format=json'])));
  const download = (fn, dir) => {
    const src = fn.buildConfig.source.storageSource; assert.ok(src?.bucket && src.object && src.generation);
    cloud(['storage', 'cp', `gs://${src.bucket}/${src.object}#${src.generation}`, dir + '.zip', '--quiet']);
    safePaths(run('unzip', ['-Z1', dir + '.zip']).trim().split('\n'));
    fs.mkdirSync(dir); run('unzip', ['-q', dir + '.zip', '-d', dir]); fs.unlinkSync(dir + '.zip'); return manifest(dir);
  };
  const boundaries = async () => {
    const url = `https://us-central1-${PROJECT}.cloudfunctions.net/${TARGET}`;
    for (const origin of ['https://demac-aruba.com', 'https://www.demac-aruba.com']) {
      const r = await fetch(url, { method: 'OPTIONS', signal: AbortSignal.timeout(20000), headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
      assert.equal(r.status, 204); assert.ok([origin, '*'].includes(r.headers.get('access-control-allow-origin')));
      for (const action of ['list_presets', 'list_schedule_history']) {
        const denied = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: {} }) });
        assert.equal(denied.status, 401); assert.equal((await denied.json()).error.code, 'unauthenticated');
      }
    }
  };
  try {
    sourceGate(); await boundaries(); summary.stage = 'download'; save();
    const before = describe(); assert.equal(before.state, 'ACTIVE'); assert.equal(before.buildConfig.runtime, 'nodejs22'); assert.equal(before.buildConfig.entryPoint, TARGET);
    Object.assign(summary, { beforeRevision: before.serviceConfig.revision, beforeSource: before.buildConfig.source, configHash: configHash(before), iamHash: iamHash(before) });
    const baseline = path.join(out, 'baseline'), candidate = path.join(out, 'candidate');
    const original = download(before, baseline);
    assert.equal(runtimeSourceHash(original), LIVE_HASH, 'Office source no longer matches known running bundle');
    fs.cpSync(baseline, candidate, { recursive: true });
    const patchPath = path.join(out, 'history.patch');
    fs.writeFileSync(patchPath, run('git', ['diff', '--binary', BASE, REVIEWED, '--', 'functions/officeBookingAuthority.js']));
    run('git', ['apply', '--check', '-p2', patchPath], candidate); run('git', ['apply', '-p2', patchPath], candidate);
    const helper = fs.readFileSync(path.join(root, 'functions/bookingScheduleHistory.js'));
    fs.writeFileSync(path.join(candidate, 'bookingScheduleHistory.js'), helper);
    const expected = manifest(candidate); summary.changedFiles = verifyDelta(original, expected, hash(helper));
    summary.stage = 'isolated-live-source-tests'; save();
    const env = isolatedTestEnv(process.env);
    summary.baselineResult = validateCandidate({ source: baseline, root, out, env, candidate: false, reconstruct: true, name: TARGET + '-baseline' });
    summary.candidateResult = validateCandidate({ source: candidate, root, out, env, candidate: true, reconstruct: true, name: TARGET + '-candidate', selectedTests: [] });
    // Test the new read and real facade against the actual patched live package.
    const check = path.join(out, 'history-test'); fs.cpSync(candidate, check, { recursive: true });
    for (const file of ['bookingScheduleHistory.test.js', 'bookingScheduleHistory.emulator.test.cjs']) fs.copyFileSync(path.join(root, 'functions', file), path.join(check, file));
    const deps = path.join(out, 'dependencies-' + hash(fs.readFileSync(path.join(candidate, 'package-lock.json'))), 'node_modules');
    fs.symlinkSync(deps, path.join(check, 'node_modules'), 'dir');
    const guard = path.join(root, 'scripts/booking-dwelling-test-network.cjs');
    const testEnv = { ...env, NODE_OPTIONS: '--require=' + guard };
    const unit = run(process.execPath, ['--test', 'bookingScheduleHistory.test.js'], check, testEnv); assert.match(unit, /# fail 0/); assert.match(unit, /# skipped 0/);
    const emulatorConfig = path.join(out, 'history-emulator.json');
    fs.writeFileSync(emulatorConfig, JSON.stringify({ emulators: { firestore: { host: '127.0.0.1', port: 8877 }, hub: { port: 4477 }, logging: { port: 4577 }, ui: { enabled: false }, singleProjectMode: true } }));
    const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
    const command = [process.execPath, '--require', guard, '--test', path.join(check, 'bookingScheduleHistory.emulator.test.cjs')].map(quote).join(' ');
    const emulator = run('npx', ['--yes', 'firebase-tools@15.30.0', 'emulators:exec', '--only', 'firestore', '--project', 'demo-demac-history', '--config', emulatorConfig, command], root, { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8877' });
    assert.match(emulator, /# fail 0/); assert.match(emulator, /# skipped 0/); summary.historyEmulatorPassed = true;
    fs.rmSync(check, { recursive: true });
    assert.deepEqual(manifest(candidate), expected); assert.deepEqual(manifest(baseline), original);
    const restored = path.join(out, 'restored'); fs.cpSync(candidate, restored, { recursive: true });
    run('git', ['apply', '--reverse', '-p2', patchPath], restored); fs.unlinkSync(path.join(restored, 'bookingScheduleHistory.js'));
    assert.deepEqual(manifest(restored), original); fs.rmSync(restored, { recursive: true }); summary.rollbackVerified = true;
    const packages = path.join(out, 'packages'); fs.mkdirSync(packages);
    for (const [label, source] of [['baseline', baseline], ['candidate', candidate]]) {
      const archive = path.join(packages, label + '.tar.gz');
      run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', source, '.']);
      const extracted = source + '-verified'; fs.mkdirSync(extracted); run('tar', ['-xzf', archive, '-C', extracted]);
      assert.deepEqual(manifest(extracted), manifest(source)); fs.rmSync(extracted, { recursive: true });
      summary[label + 'ArchiveHash'] = hash(fs.readFileSync(archive)); summary[label + 'ManifestHash'] = hash(manifest(source));
    }
    const unchanged = () => {
      const fresh = describe(); assert.equal(fresh.state, 'ACTIVE');
      assert.equal(fresh.serviceConfig.revision, summary.beforeRevision); assert.deepEqual(fresh.buildConfig.source, summary.beforeSource);
      assert.equal(configHash(fresh), summary.configHash); assert.equal(iamHash(fresh), summary.iamHash);
    };
    sourceGate(); unchanged(); summary.stage = 'prepared'; save();
    fs.copyFileSync(path.join(out, 'summary.json'), path.join(packages, 'manifest.json'));
    if (deploy) {
      verifyPrepared(prepared, summary); sourceGate(); unchanged();
      assert.deepEqual(manifest(candidate), expected); summary.stage = 'deploy'; save();
      cloud(deployArgs(TARGET, candidate));
      const after = describe(); assert.equal(after.state, 'ACTIVE');
      assert.equal(configHash(after), summary.configHash, 'Runtime configuration drift'); assert.equal(iamHash(after), summary.iamHash, 'IAM drift');
      verifyPublishedSource(expected, download(after, path.join(out, 'published')));
      await boundaries(); sourceGate();
      Object.assign(summary, { stage: 'complete', afterRevision: after.serviceConfig.revision, sourceVerified: true, configPreserved: true, iamPreserved: true, actualDomainBoundariesPassed: true, recoveryArtifactId: process.env.RECOVERY_ARTIFACT_ID }); save();
    }
    console.log('PASS: ' + summary.mode + '; baseline ' + summary.baselineResult.testsPassed + ', candidate ' + summary.candidateResult.testsPassed + ', history 6 tests; only Office source changed.');
  } catch (error) {
    summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Command failed during ' + summary.stage;
    summary.exitStatus = error.status || error.code || null; save(); console.error(summary.error); process.exitCode = 1;
  }
}
module.exports = { verifyDelta, verifyPrepared, deployArgs, manifest };
if (require.main === module) main();
