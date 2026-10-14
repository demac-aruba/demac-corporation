'use strict';
// Reviewed update of the existing owner-only reader. No Intuit or accounting calls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourceCheck, stagePackage, verifyFunction, boundaries, FILES } = require('./quickbooks-reports-release.cjs');
const { resolveOwner, inventory, PROJECT, NUMBER, RESOURCE } = require('./quickbooks-production-prepare.cjs');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { releaseConfig, safePaths } = require('./booking-dwelling-release.cjs');
const { verifyPrivateBucket, verifyInheritedPolicies } = require('./appointment-finance-prepare.cjs');
const { retainZip, sourceVerifier } = require('./appointment-finance-transport.cjs');
const { updateSource } = require('./appointment-finance-source-update.cjs');
const { verifyTraffic } = require('./appointment-finance-release.cjs');
const NAME = 'quickbooksReports', REGION = 'us-central1', BUCKET = `gcf-v2-sources-${NUMBER}-${REGION}`;
const BASE = '66bc53a63d1fbd5a5be7a5e137ac1ad6d947f3be', REVISION = 'quickbooksreports-00001-liy';
const FLAG = 'QBO_PRODUCTION_CATALOG_ENABLED';
const MASK = 'buildConfig.source,serviceConfig.environmentVariables';
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(stable(v))).digest('hex');
const check = (ok, code) => { if (!ok) throw Object.assign(Error(code), { safeCode: code }); };
function configWithoutFlag(fn) {
  const config = structuredClone(releaseConfig(fn)); delete config.service.environmentVariables[FLAG]; return config;
}
function patchFor(transport, environment) {
  check(transport.format === 'zip' && transport.privateRetained && transport.extractionVerified && transport.anonymousAccessDenied, 'transport-not-verified');
  check(new RegExp(`^gs://${BUCKET}/codex-release-recovery/appointment-finance/[a-f0-9]{40}/${NAME}-candidate\\.zip$`).test(transport.uri), 'transport-path-invalid');
  check(/^\d+$/.test(transport.generation) && /^[a-f0-9]{64}$/.test(transport.sha256), 'transport-identity-invalid');
  return { name: RESOURCE + NAME, buildConfig: { source: { storageSource: { bucket: BUCKET, object: transport.uri.slice(('gs://' + BUCKET + '/').length), generation: transport.generation } } },
    serviceConfig: { environmentVariables: { ...environment, [FLAG]: 'true' } } };
}
function verifyCurrent(fn, files, expected) {
  verifyFunction({ ...fn, state: 'ACTIVE' }, expected.uid, `${NUMBER}-compute@developer.gserviceaccount.com`);
  check(['ACTIVE', 'FAILED', 'UNKNOWN'].includes(fn.state), 'unexpected-function-state');
  check(hash(configWithoutFlag(fn)) === expected.configHash, 'runtime-configuration-drift');
  const digest = hash(files), flag = fn.serviceConfig.environmentVariables[FLAG];
  if (digest === expected.baselineHash) {
    check(fn.serviceConfig.revision === REVISION && (flag === undefined || flag === 'false'), 'baseline-revision-or-flag-changed'); return false;
  }
  check(digest === expected.candidateHash && flag === 'true', 'unreviewed-source-or-flag'); return true;
}
function reviewedSourceMatcher(sourceMatch, environment) {
  return (source, expected, operation) => {
    if (hash(operation?.metadata?.requestResource?.serviceConfig?.environmentVariables || {}) !== hash(environment)) return false;
    return sourceMatch(source, expected, operation);
  };
}
async function catalogBoundaries(fetcher = fetch) {
  for (const origin of ['https://demac-aruba.com', 'https://untrusted.example']) {
    const response = await fetcher(`https://${REGION}-${PROJECT}.cloudfunctions.net/${NAME}/catalog`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'Customer', startPosition: 1 }) });
    check(response.status === (origin.includes('untrusted') ? 403 : 401) && response.headers.get('cache-control') === 'private, no-store', 'catalog-boundary-failed');
    check((await response.json()).error === (origin.includes('untrusted') ? 'origin-denied' : 'sign-in-required'), 'catalog-error-boundary-failed');
  }
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22');
  check(process.argv[2] === '--deploy', 'unsupported-mode');
  check(process.env.GITHUB_REPOSITORY === 'demac-aruba/demac-corporation' && process.env.GITHUB_REF === 'refs/heads/main', 'reviewed-main-only');
  check(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'runner-temp-required');
  const root = process.cwd(), out = path.join(process.env.RUNNER_TEMP, 'qbo-catalog-update'); fs.mkdirSync(out);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  const cloud = args => run('gcloud', args);
  const sourceGate = () => {
    check(run('git', ['rev-parse', 'HEAD']).trim() === process.env.GITHUB_SHA && run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0] === process.env.GITHUB_SHA, 'main-advanced-review-required'); sourceCheck();
  };
  const summary = { sourceSha: process.env.GITHUB_SHA, stage: 'preflight', accountingWrites: false, providerCalls: false, customerReads: false, secretPayloadsAccessed: false, operations: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  let token, tokenAt = 0;
  const getToken = () => { if (!token || Date.now() - tokenAt > 40 * 60 * 1000) { token = cloud(['auth', 'print-access-token']).trim(); tokenAt = Date.now(); } return token; };
  const api = async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, redirect: 'error', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    check(response.status === 200, 'cloud-api-http-' + response.status); return response.json();
  };
  const describe = () => JSON.parse(cloud(['functions', 'describe', NAME, '--gen2', '--project=' + PROJECT, '--region=' + REGION, '--format=json']));
  const service = fn => JSON.parse(cloud(['run', 'services', 'describe', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=' + REGION, '--format=json']));
  const iam = fn => hash(JSON.parse(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=' + REGION, '--format=json'])));
  let downloads = 0;
  const download = source => {
    check(source?.bucket === BUCKET && /^[A-Za-z0-9_./-]+$/.test(source.object || '') && /^\d+$/.test(String(source.generation)), 'source-reference-invalid');
    const directory = path.join(out, 'source-' + ++downloads), zip = directory + '.zip';
    cloud(['storage', 'cp', `gs://${source.bucket}/${source.object}#${source.generation}`, zip, '--quiet']);
    const names = run('unzip', ['-Z1', zip]).trim().split('\n'); safePaths(names);
    check(new Set(names).size === names.length && names.every(n => !n.includes('/')), 'unexpected-archive-layout');
    fs.mkdirSync(directory); run('unzip', ['-q', zip, '-d', directory]);
    return { directory, files: manifest(directory), archiveHash: hash(fs.readFileSync(zip)) };
  };
  try {
    sourceGate(); const uid = await resolveOwner(getToken());
    const before = inventory().filter(f => f.name !== RESOURCE + NAME), initial = describe();
    verifyFunction({ ...initial, state: 'ACTIVE' }, uid, `${NUMBER}-compute@developer.gserviceaccount.com`);
    const candidate = stagePackage(uid), baseline = path.join(out, 'baseline'); fs.cpSync(candidate, baseline, { recursive: true });
    fs.unlinkSync(path.join(baseline, 'quickbooksCatalogFormat.js'));
    for (const file of FILES.filter(f => f !== 'quickbooksCatalogFormat.js')) fs.writeFileSync(path.join(baseline, file), run('git', ['show', BASE + ':functions/' + file]));
    fs.appendFileSync(path.join(candidate, '.env.' + PROJECT), `${FLAG}=true\n`);
    const expected = { uid, configHash: hash(configWithoutFlag(initial)), iamHash: iam(initial), baselineHash: hash(manifest(baseline)), candidateHash: hash(manifest(candidate)) };
    const originalEnvironment = { ...initial.serviceConfig.environmentVariables }; delete originalEnvironment[FLAG];
    const inspect = async ({ allowFailed = false } = {}) => {
      const fn = describe(); if (!allowFailed) check(fn.state === 'ACTIVE', 'function-not-active');
      check(iam(fn) === expected.iamHash, 'iam-drift');
      const alreadyApplied = verifyCurrent(fn, download(fn.buildConfig.source.storageSource).files, expected);
      if (fn.state === 'ACTIVE') verifyTraffic(service(fn), fn.serviceConfig.revision);
      return { fn, alreadyApplied };
    };
    // Verify exact installed source before storage writes; pending/failed candidates are
    // classified again by updateSource before another publication can be attempted.
    verifyCurrent(initial, download(initial.buildConfig.source.storageSource).files, expected);
    summary.baselineHash = expected.baselineHash; summary.candidateHash = expected.candidateHash;
    summary.stage = 'retain-private-recovery'; save();
    const bucket = JSON.parse(cloud(['storage', 'buckets', 'describe', 'gs://' + BUCKET, '--format=json']));
    const policy = JSON.parse(cloud(['storage', 'buckets', 'get-iam-policy', 'gs://' + BUCKET, '--format=json'])); verifyPrivateBucket(bucket, policy);
    const prepared = { sourceSha: process.env.GITHUB_SHA, recoveryBucketConfigHash: hash(bucket), recoveryBucketPolicyHash: hash(policy) };
    if ((bucket.public_access_prevention ?? bucket.iamConfiguration?.publicAccessPrevention) === 'enforced') prepared.inheritedPrivacy = { mode: 'bucket-public-access-prevention' };
    if (!prepared.inheritedPrivacy) {
      try { const effective = JSON.parse(cloud(['org-policies', 'describe', 'constraints/storage.publicAccessPrevention', '--effective', '--project=' + PROJECT, '--format=json'])); const rules = effective.spec?.rules; if (rules?.length && rules.every(r => r.enforce === true && !r.condition)) prepared.inheritedPrivacy = { mode: 'effective-public-access-prevention', policyHash: hash(effective) }; } catch { /* Require complete ancestry below. */ }
    }
    if (!prepared.inheritedPrivacy) {
      const ancestors = JSON.parse(cloud(['projects', 'get-ancestors', PROJECT, '--format=json']));
      const policies = ancestors.map(a => { const kind = String(a.type).toLowerCase(); check(['project', 'folder', 'organization'].includes(kind), 'invalid-ancestor'); return JSON.parse(cloud([...(kind === 'project' ? ['projects'] : kind === 'folder' ? ['resource-manager', 'folders'] : ['organizations']), 'get-iam-policy', String(a.id), '--format=json'])); });
      verifyInheritedPolicies(ancestors, policies); prepared.inheritedPrivacy = { mode: 'complete-ancestry-iam', levels: ancestors.length, policyHashes: policies.map(hash) };
    }
    summary.recovery = await retainZip({ name: NAME + 'Baseline', directory: baseline, archive: { sha256: expected.baselineHash }, out, prepared, cloud });
    summary.transport = await retainZip({ name: NAME, directory: candidate, archive: { sha256: expected.candidateHash }, out, prepared, cloud });
    const patch = patchFor(summary.transport, originalEnvironment); save(); sourceGate();
    const sourceMatch = sourceVerifier({ name: NAME, transport: summary.transport, downloadHash: src => download(src).archiveHash });
    const sourceMatches = reviewedSourceMatcher(sourceMatch, patch.serviceConfig.environmentVariables);
    summary.stage = 'publish-reader-and-catalog-flag'; save();
    const after = await updateSource({ patch, baselineRevision: REVISION, inspect, sourceMatches,
      operations: async () => { const found = []; let next; do { const page = await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/operations?pageSize=100` + (next ? '&pageToken=' + encodeURIComponent(next) : '')); found.push(...(page.operations || [])); next = page.nextPageToken; } while (next); return found; },
      publish: async body => { sourceGate(); check(await resolveOwner(getToken()) === uid, 'owner-changed'); await inspect({ allowFailed: true }); check(hash(inventory().filter(f => f.name !== RESOURCE + NAME)) === hash(before), 'other-functions-changed'); return api('https://cloudfunctions.googleapis.com/v2/' + patch.name + '?updateMask=' + MASK, 'PATCH', body); },
      getOperation: name => api('https://cloudfunctions.googleapis.com/v2/' + name), wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      record: op => { summary.operations.push({ name: op.name, done: op.done, error: Boolean(op.error), intent: Boolean(op.intent) }); save(); } });
    summary.stage = 'verify'; save();
    await boundaries(); await catalogBoundaries();
    check(hash(inventory().filter(f => f.name !== RESOURCE + NAME)) === hash(before), 'other-functions-changed');
    summary.revision = after.fn.serviceConfig.revision; summary.sourceVerified = true; summary.iamPreserved = true; summary.otherConfigurationPreserved = true; summary.otherFunctionsUnchanged = true; summary.catalogReadEnabled = true; summary.anonymousBoundaries = 'passed'; summary.stage = 'complete'; save();
    console.log(JSON.stringify(summary));
  } catch (error) { summary.error = error.safeCode || 'update-failed-review-required'; save(); console.error(JSON.stringify(summary)); process.exitCode = 1; }
}
module.exports = { hash, configWithoutFlag, patchFor, verifyCurrent, reviewedSourceMatcher, catalogBoundaries, BASE, REVISION, FLAG, MASK };
if (require.main === module) main().catch(() => { console.error('QuickBooks update precondition failed'); process.exitCode = 1; });
