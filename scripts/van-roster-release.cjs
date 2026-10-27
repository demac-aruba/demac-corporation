'use strict';
// Owner-approved atomic fleet crew source and direct-writer guard. No employee data writes or role expansion.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { releaseConfig, runtimeSourceHash, safePaths, isolatedTestEnv } = require('./booking-dwelling-release.cjs');
const { validateAttendanceCandidate } = require('./employee-split-candidate.cjs');
const { verifyPrivateBucket, verifyInheritedPolicies } = require('./appointment-finance-prepare.cjs');
const { retainZip, sourceVerifier, createZip } = require('./appointment-finance-transport.cjs');
const { updateSource } = require('./appointment-finance-source-update.cjs');
const { verifyTraffic } = require('./appointment-finance-release.cjs');
const { verifyDelta, FILES } = require('./van-roster-audit.cjs');
const PROJECT = 'demac-corporation', REGION = 'us-central1', NAME = 'officeBookingAuthority';
const BUCKET = 'gcf-v2-sources-1053571783393-us-central1';
const BRANCH = 'release/van-roster-20261027';
// Immutable baseline and candidate recorded by the reviewed read-only audit.
const audit = require('../docs/ai/releases/van-roster-audit-20261027.json');
assert.equal(audit.stage, 'complete');
assert.equal(audit.mode, 'read-only');
assert.equal(audit.productionWrites, false);
assert.equal(audit.customerReads, false);
assert.equal(audit.functions.length, 1);
const audited = audit.functions[0];
assert.equal(audited.name, NAME);
const EXPECTED = { revision: audited.revision, source: audited.source, sourceHash: audited.sourceHash,
  candidateHash: audited.candidateSourceHash, configHash: audited.configHash, iamHash: audited.iamHash };
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(stable(v))).digest('hex');
function patchFor(transport) {
  assert.equal(transport.format, 'zip'); assert.equal(transport.privateRetained, true); assert.equal(transport.extractionVerified, true); assert.equal(transport.anonymousAccessDenied, true);
  assert.match(transport.uri, new RegExp('^gs://' + BUCKET + '/codex-release-recovery/appointment-finance/[a-f0-9]{40}/' + NAME + '-candidate\\.zip$'));
  assert.match(transport.generation, /^\d+$/); assert.match(transport.sha256, /^[a-f0-9]{64}$/);
  return { name: `projects/${PROJECT}/locations/${REGION}/functions/${NAME}`, buildConfig: { source: { storageSource: { bucket: BUCKET, object: transport.uri.slice(('gs://' + BUCKET + '/').length), generation: transport.generation } } } };
}
function verifyCurrent(fn, iamHash, files) {
  assert.ok(['ACTIVE', 'FAILED', 'UNKNOWN'].includes(fn.state));
  assert.equal(fn.buildConfig.entryPoint, NAME); assert.equal(fn.buildConfig.runtime, 'nodejs22');
  assert.equal(hash(releaseConfig(fn)), EXPECTED.configHash, 'Runtime configuration drift');
  assert.equal(iamHash, EXPECTED.iamHash, 'IAM drift');
  const sourceHash = runtimeSourceHash(files);
  assert.ok([EXPECTED.sourceHash, EXPECTED.candidateHash].includes(sourceHash), 'Unreviewed live source');
  if (sourceHash === EXPECTED.sourceHash) assert.equal(fn.serviceConfig.revision, EXPECTED.revision, 'Unreviewed baseline revision');
  return sourceHash === EXPECTED.candidateHash;
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/' + BRANCH);
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const root = process.cwd(), out = path.join(process.env.RUNNER_TEMP, 'van-roster-release'); fs.mkdirSync(out);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const cloud = args => run('gcloud', args);
  const summary = { sourceSha: process.env.GITHUB_SHA, mode: 'source-only', stage: 'preflight', productionDataWrites: false, customerReads: false, operations: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const sourceGate = () => {
    assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), process.env.GITHUB_SHA);
    for (const ref of ['refs/heads/main', 'refs/heads/' + BRANCH]) assert.equal(run('git', ['ls-remote', 'origin', ref]).split(/\s/)[0], process.env.GITHUB_SHA, 'Reviewed branch advanced');
  };
  let token, tokenAt = 0;
  const api = async (url, method = 'GET', body) => {
    if (!token || Date.now() - tokenAt > 40 * 60 * 1000) { token = cloud(['auth', 'print-access-token']).trim(); tokenAt = Date.now(); }
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, 'Cloud API ' + method + ' HTTP ' + response.status); return response.json();
  };
  const describe = () => JSON.parse(cloud(['functions', 'describe', NAME, '--gen2', '--project=' + PROJECT, '--region=' + REGION, '--format=json']));
  const service = fn => JSON.parse(cloud(['run', 'services', 'describe', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=' + REGION, '--format=json']));
  const iam = fn => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=' + REGION, '--format=json'])));
  let downloads = 0;
  const download = (source, label) => {
    assert.equal(source.bucket, BUCKET); assert.ok(source.object); assert.match(String(source.generation), /^\d+$/);
    const directory = path.join(out, label + '-' + ++downloads), zip = directory + '.zip';
    cloud(['storage', 'cp', `gs://${source.bucket}/${source.object}#${source.generation}`, zip, '--quiet']);
    safePaths(run('unzip', ['-Z1', zip]).trim().split('\n')); fs.mkdirSync(directory); run('unzip', ['-q', zip, '-d', directory]);
    return { directory, files: manifest(directory), archiveHash: hash(fs.readFileSync(zip)) };
  };
  const inspect = async ({ allowFailed = false } = {}) => {
    const fn = describe(); if (!allowFailed) assert.equal(fn.state, 'ACTIVE');
    const downloaded = download(fn.buildConfig.source.storageSource, 'live');
    const alreadyApplied = verifyCurrent(fn, iam(fn), downloaded.files);
    if (fn.state === 'ACTIVE') verifyTraffic(service(fn), fn.serviceConfig.revision);
    return { fn, alreadyApplied };
  };
  try {
    // updateSource settles/classifies any accepted operation before inspecting
    // live state; checking ACTIVE here would incorrectly block safe resumption.
    sourceGate();
    summary.stage = 'candidate-validation'; save();
    const baseline = download(EXPECTED.source, 'baseline'); assert.equal(runtimeSourceHash(baseline.files), EXPECTED.sourceHash);
    const candidate = path.join(out, 'candidate'); fs.cpSync(baseline.directory, candidate, { recursive: true });
    for (const f of FILES) fs.copyFileSync(path.join(root, 'functions', f), path.join(candidate, f));
    const files = manifest(candidate); verifyDelta(baseline.files, files); assert.equal(runtimeSourceHash(files), EXPECTED.candidateHash);
    const tests = ['bookingCrewResolution.test.js', 'bookingAuthoritySchedulingProvider.test.js', 'officeBookingAuthorityCatalog.test.js', 'technicianDailyScheduleService.test.js', 'technicianScheduleChangeService.test.js', 'vanRosterAuthority.test.js'];
    summary.validation = validateAttendanceCandidate({ source: candidate, root, out, env: isolatedTestEnv(process.env), candidate: true, reconstruct: false, name: NAME + '-candidate', selectedTests: tests, updatedTests: tests, smokeScript: 'booking-dwelling-runtime-smoke.cjs', testFixtures: [] });
    assert.equal(summary.validation.dependencyLockSha256, audited.candidateResult.dependencyLockSha256, 'Validation dependency resolution changed since audit');
    assert.deepEqual(manifest(candidate), files);
    summary.stage = 'retain-private-recovery'; save();
    const bucket = JSON.parse(cloud(['storage', 'buckets', 'describe', 'gs://' + BUCKET, '--format=json']));
    const policy = JSON.parse(cloud(['storage', 'buckets', 'get-iam-policy', 'gs://' + BUCKET, '--format=json']));
    verifyPrivateBucket(bucket, policy);
    const prepared = { sourceSha: process.env.GITHUB_SHA, recoveryBucketConfigHash: hash(bucket), recoveryBucketPolicyHash: hash(policy) };
    if ((bucket.public_access_prevention ?? bucket.iamConfiguration?.publicAccessPrevention) === 'enforced') prepared.inheritedPrivacy = { mode: 'bucket-public-access-prevention' };
    if (!prepared.inheritedPrivacy) {
      try { const effective = JSON.parse(cloud(['org-policies', 'describe', 'constraints/storage.publicAccessPrevention', '--effective', '--project=' + PROJECT, '--format=json'])); const rules = effective.spec?.rules; if (Array.isArray(rules) && rules.length && rules.every(r => r.enforce === true && !r.condition)) prepared.inheritedPrivacy = { mode: 'effective-public-access-prevention', policyHash: hash(effective) }; } catch { /* Complete ancestry is required below. */ }
    }
    if (!prepared.inheritedPrivacy) {
      const ancestors = JSON.parse(cloud(['projects', 'get-ancestors', PROJECT, '--format=json']));
      const policies = ancestors.map(a => { const kind = String(a.type).toLowerCase(); assert.ok(['project','folder','organization'].includes(kind)); return JSON.parse(cloud([...(kind === 'project' ? ['projects'] : kind === 'folder' ? ['resource-manager','folders'] : ['organizations']), 'get-iam-policy', String(a.id), '--format=json'])); });
      verifyInheritedPolicies(ancestors, policies); prepared.inheritedPrivacy = { mode: 'complete-ancestry-iam', levels: ancestors.length, policyHashes: policies.map(hash) };
    }
    summary.recovery = await retainZip({ name: NAME + 'Baseline', directory: baseline.directory, archive: { sha256: baseline.archiveHash }, out, prepared, cloud });
    const preliminary = createZip(candidate, path.join(out, 'candidate-proof.zip'));
    summary.transport = await retainZip({ name: NAME, directory: candidate, archive: { sha256: preliminary.sha256 }, out, prepared, cloud });
    const patch = patchFor(summary.transport); save(); sourceGate();
    const sourceMatches = sourceVerifier({ name: NAME, transport: summary.transport, downloadHash: src => download(src, 'provenance').archiveHash });
    summary.stage = 'publish-source-only'; save();
    const after = await updateSource({ patch, baselineRevision: EXPECTED.revision, inspect,
      operations: async () => { const found = []; let pageToken; do { const page = await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/operations?pageSize=100` + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')); found.push(...(page.operations || [])); pageToken = page.nextPageToken; } while (pageToken); return found; },
      publish: body => { sourceGate(); return api('https://cloudfunctions.googleapis.com/v2/' + patch.name + '?updateMask=buildConfig.source', 'PATCH', body); },
      getOperation: name => api('https://cloudfunctions.googleapis.com/v2/' + name), wait: ms => new Promise(resolve => setTimeout(resolve, ms)), sourceMatches,
      record: operation => { summary.operations.push({ name: operation.name, done: operation.done, error: Boolean(operation.error), intent: Boolean(operation.intent) }); save(); } });
    summary.stage = 'verify'; save();
    sourceGate(); assert.equal(after.alreadyApplied, true); assert.equal(after.fn.state, 'ACTIVE'); verifyTraffic(service(after.fn), after.fn.serviceConfig.revision);
    for (const origin of ['https://demac-aruba.com', 'https://www.demac-aruba.com']) {
      const endpoint = `https://${REGION}-${PROJECT}.cloudfunctions.net/${NAME}`;
      const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, signal: AbortSignal.timeout(20000) });
      assert.equal(preflight.status, 204); assert.ok([origin, '*'].includes(preflight.headers.get('access-control-allow-origin')), 'Existing CORS origin policy unavailable');
      const denied = await fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_van_roster', data: {} }), signal: AbortSignal.timeout(20000) });
      assert.equal(denied.status, 401); assert.equal((await denied.json()).error?.code, 'unauthenticated');
    }
    summary.stage = 'publish-rules-guard'; save();
    const { publishRules } = require('./van-roster-rules.cjs');
    summary.rules = await publishRules({api,candidate:fs.readFileSync('firestore.rules','utf8'),audit:audit.rules,sourceGate,record:state=>{summary.rules=state;save();}});
    const rulesPublishedAt = Date.parse(summary.rules.release.updateTime);
    assert.ok(Number.isFinite(rulesPublishedAt), 'Rules publication time missing');
    summary.frontendNotBefore = new Date(rulesPublishedAt + 10 * 60 * 1000).toISOString();
    summary.afterRevision = after.fn.serviceConfig.revision; summary.sourceVerified = true; summary.configPreserved = true; summary.iamPreserved = true; summary.trafficVerified = true; summary.anonymousBoundaryVerified = true; summary.stage = 'complete'; save();
    console.log('PASS exact source publication, runtime configuration, IAM, traffic and both production origins; no customer data touched');
  } catch (error) { summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Release failed at ' + summary.stage; save(); console.error(summary.error); process.exitCode = 1; }
}
module.exports = { patchFor, verifyCurrent, EXPECTED };
if (require.main === module) main();
