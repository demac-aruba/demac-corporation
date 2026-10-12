'use strict';
// Read-only production inspection. No invocation, deploy, data write or message.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { releaseConfig, safePaths, runtimeSourceHash } = require('./booking-dwelling-release.cjs');
const { validateLock } = require('./booking-dwelling-candidate-validation.cjs');
const PROJECT = 'demac-corporation';
const TARGETS = ['officeBookingAuthority', 'inventoryAuthority', 'fieldOperationsAuthority', 'processCustomerAgentInbound', 'processCustomerAgentReactivation'];
const APPROVED = {
  standardServiceSplit: [100, 125, 135, 145, 175],
  deepCleaningSplit: [195, 195, 195, 195, 250],
  standardInstallationAdinaDemac: [225, 225, 225, 250, 300],
};
const BTUS = [9000, 12000, 18000, 24000, 36000];
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
function decode(value) {
  if ('nullValue' in value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  return undefined;
}
function auditTariffs(fields) {
  return Object.entries(APPROVED).flatMap(([service, prices]) => BTUS.map((btu, index) => {
    const matches = (Array.isArray(fields[service]) ? fields[service] : []).filter(row => Number(row?.btu) === btu);
    const raw = matches[0]?.price;
    const actual = matches.length === 1 && ['number', 'string'].includes(typeof raw) && String(raw).trim() && Number.isFinite(Number(raw)) ? Number(raw) : null;
    return { service, btu, expected: prices[index], actual, matches: matches.length, matchesApproved: actual === prices[index] && matches.length === 1 };
  }));
}
function manifest(directory) {
  const files = {};
  function visit(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      assert.ok(!item.isSymbolicLink(), 'Unsafe archive symlink');
      if (item.isDirectory()) visit(file);
      else files[path.relative(directory, file).split(path.sep).join('/')] = hash(fs.readFileSync(file));
    }
  }
  visit(directory); return files;
}
async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/fix/appointment-finance-release-20261012');
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), process.env.GITHUB_SHA);
  const out = path.join(process.env.RUNNER_TEMP, 'finance-release-audit');
  const packages = path.join(out, 'packages'); fs.mkdirSync(packages, { recursive: true });
  const report = { sourceSha: process.env.GITHUB_SHA, mode: 'read-only', project: PROJECT, stage: 'tariffs', functions: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
  try {
    const token = run('gcloud', ['auth', 'print-access-token']).trim();
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/businessSettings/company-service-pricing-rules`, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
    assert.ok([200, 404].includes(response.status), 'Pricing settings read failed (HTTP ' + response.status + ')');
    const payload = await response.json();
    if (response.status === 404) assert.equal(payload.error?.status, 'NOT_FOUND', 'Unexpected missing-document response');
    const doc = response.status === 404 ? { fields: {} } : payload;
    const fields = Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, decode(value)]));
    report.tariffs = { exists: response.status === 200, updateTime: doc.updateTime || null, documentHash: hash(doc.fields), rows: auditTariffs(fields) };
    report.tariffs.allMatch = report.tariffs.rows.every(row => row.matchesApproved);
    // Only the approved 15 numeric rates are disclosed; never the full settings.
    save(); console.log('Saved tariff audit: ' + report.tariffs.rows.filter(row => row.matchesApproved).length + '/15 match');
    for (const name of TARGETS) {
      report.stage = 'source-' + name; save();
      const fn = JSON.parse(run('gcloud', ['functions', 'describe', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--format=json']));
      assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.entryPoint, name);
      const source = fn.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && source.generation, 'Versioned source required');
      const directory = path.join(out, name), zip = directory + '.zip';
      run('gcloud', ['storage', 'cp', `gs://${source.bucket}/${source.object}#${source.generation}`, zip, '--quiet']);
      safePaths(run('unzip', ['-Z1', zip]).trim().split('\n'));
      fs.mkdirSync(directory); run('unzip', ['-q', zip, '-d', directory]); fs.unlinkSync(zip);
      const files = manifest(directory);
      // Recovery archives may contain only public repository source, verified
      // package metadata and packaging controls. No runtime config is exported.
      const unknownFiles = [];
      for (const file of Object.keys(files)) {
        assert.ok(!/(^|\/)\.env(?:\.|$)|\.(?:pem|key)$|(?:credential|service-account)\.json$/i.test(file), 'Private file in source archive');
        const oid = run('git', ['hash-object', path.join(directory, file)]).trim();
        try { run('git', ['cat-file', '-e', oid + '^{blob}']); }
        catch { unknownFiles.push(file); }
      }
      const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
      const lockPresent = Object.hasOwn(files, 'package-lock.json');
      if (lockPresent) validateLock(fs.readFileSync(path.join(directory, 'package-lock.json')), pkg);
      let runtimeImage = null;
      if (!lockPresent) {
        const revision = JSON.parse(run('gcloud', ['run', 'revisions', 'describe', fn.serviceConfig.revision, '--project=' + PROJECT, '--region=us-central1', '--format=json']));
        const image = revision.status?.imageDigest || revision.spec?.containers?.[0]?.image;
        assert.ok(image && !image.includes('://') && image.includes('@sha256:'), 'Immutable runtime image required');
        const [registry, ...parts] = image.split('/');
        assert.ok(registry.endsWith('.pkg.dev') || registry.endsWith('.gcr.io') || registry === 'gcr.io', 'Unexpected Google image registry');
        const [repository, digest] = parts.join('/').split('@');
        const manifestResponse = await fetch(`https://${registry}/v2/${repository}/manifests/${digest}`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' }, signal: AbortSignal.timeout(20000) });
        runtimeImage = { image, manifestStatus: manifestResponse.status, available: manifestResponse.ok };
        if (manifestResponse.ok) { const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer()); assert.equal('sha256:' + hash(manifestBytes), digest); runtimeImage.manifestVerified = true; }
      }
      const archive = path.join(packages, name + '-baseline.tar.gz');
      if (!unknownFiles.length) {
        run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', directory, '.']);
        const extracted = directory + '-verify'; fs.mkdirSync(extracted); run('tar', ['-xzf', archive, '-C', extracted]);
        assert.deepEqual(manifest(extracted), files, 'Recovery archive differs'); fs.rmSync(extracted, { recursive: true });
      }
      const policy = JSON.parse(run('gcloud', ['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=' + PROJECT, '--region=us-central1', '--format=json']));
      const fresh = JSON.parse(run('gcloud', ['functions', 'describe', name, '--project=' + PROJECT, '--region=us-central1', '--gen2', '--format=json']));
      assert.deepEqual(fresh.buildConfig.source, fn.buildConfig.source, 'Source changed during read-only inspection');
      assert.equal(hash(releaseConfig(fresh)), hash(releaseConfig(fn)), 'Configuration changed during inspection');
      report.functions.push({ name, revision: fn.serviceConfig.revision, state: fn.state, runtime: fn.buildConfig.runtime,
        source, configHash: hash(releaseConfig(fn)), iamHash: hash(policy), sourceHash: runtimeSourceHash(files), lockPresent, runtimeImage,
        archiveHash: unknownFiles.length ? null : hash(fs.readFileSync(archive)), archiveVerified: !unknownFiles.length, unknownFiles,
        relevantFiles: Object.fromEntries(['appointmentCharges.js', 'serviceCatalogEditing.js', 'appointmentChargeEditing.js', 'servicePricingAuthority.js', 'inventoryAuthority.js', 'commercialSalesAuthority.js', 'demacCustomerSalesTools.js'].filter(file => files[file]).map(file => [file, files[file]])),
        files });
      save(); console.log(name + ': ' + fn.serviceConfig.revision + '; public-source recovery=' + !unknownFiles.length + '; lock=' + lockPresent);
    }
    report.stage = 'complete'; save();
    // Full live config, IAM identities and settings are not persisted as artifacts.
    console.log('PASS read-only inspection; zero production writes or function invocations');
  } catch (error) {
    report.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Inspection failed at ' + report.stage;
    save(); console.error(report.error); process.exitCode = 1;
  }
}
module.exports = { auditTariffs, decode, manifest };
if (require.main === module) main();
