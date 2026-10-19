'use strict';
// Isolated identity-link installation. Existing authorization/report readers are verified, never redeployed.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const crypto = require('node:crypto');
const { resolveOwner, google, stagePackage: identityStage,
  verifyPublishedSource: verifyIdentitySource, checkSecretVersions, inventory, PROJECT, NUMBER, REALM, SECRETS, RESOURCE } = require('./quickbooks-production-prepare.cjs');
const { validateExisting, disclosures } = require('./quickbooks-production-activate.cjs');
const reader = require('./quickbooks-reports-release.cjs');
const NAME = 'quickbooksLinks';
const PINS = {
  "quickbooksLinks.js": "a13c144dec43bac814aebb47f4f6a28809bf8c02916ea3919f5db2e6d5b8755c",
  "quickbooksLinksHttp.js": "a4b3869d365706dcff8d919a0f1469e5a819c2c8eb86deff88b35f255491f860",
  "quickbooksLinksService.js": "00368159955e38c4cb31fb0932bf3e4939e99cf14d07271b55b950f7ecc9d87c"
};
const check = (condition, code) => { if (!condition) throw Object.assign(Error(code), { safeCode: code }); };
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
const git = args => run('git', args).trim();
const cloud = args => JSON.parse(run('gcloud', [...args, '--project=' + PROJECT, '--format=json']));
const FILES = [...reader.FILES, ...Object.keys(PINS)];
const report = { stage: 'source-check', accountingWrites: false, syncEnabled: false, providerCalls: false, secretPayloadsAccessed: false };
function sourceCheck() {
  const manifest = reader.sourceCheck(); // Original reader/authorization/dependency pins remain unchanged.
  for (const file of Object.keys(PINS)) check(crypto.createHash('sha256').update(fs.readFileSync('functions/' + file)).digest('hex') === PINS[file], 'reviewed-link-source-changed');
  return manifest;
}
function releaseCheck() {
  check(process.env.GITHUB_REPOSITORY === 'demac-aruba/demac-corporation' && process.env.GITHUB_REF === 'refs/heads/main', 'reviewed-main-only');
  check(git(['rev-parse', 'HEAD']) === process.env.GITHUB_SHA && git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === process.env.GITHUB_SHA, 'main-advanced-review-required');
  check(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'runner-temp-required'); sourceCheck();
}
function stagePackage(uid) {
  check(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), 'owner-uid-invalid');
  const stage = path.join(process.env.RUNNER_TEMP, 'qbo-links-source'); fs.mkdirSync(stage, { recursive: true });
  check(fs.readdirSync(stage).length === 0, 'stage-not-empty');
  for (const file of FILES) fs.copyFileSync('functions/' + file, path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ ...sourceCheck(), main: NAME + '.js', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(stage, '.env.' + PROJECT), `QBO_PRODUCTION_REPORTS_ENABLED=true\nQBO_PRODUCTION_CATALOG_ENABLED=true\nQBO_PRODUCTION_REALM_ID=${REALM}\nQBO_PRODUCTION_OWNER_UID=${uid}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'qbo-links-firebase.json'), JSON.stringify({ functions: {
    source: 'qbo-links-source', codebase: 'default', ignore: ['node_modules', '.git', '*debug*.log'] } }));
  return stage;
}
function verifyFunction(fn, uid, runtimeIdentity) {
  check(fn?.name === RESOURCE + NAME && fn.state === 'ACTIVE' && fn.buildConfig?.runtime === 'nodejs22' && fn.buildConfig.entryPoint === NAME && !fn.eventTrigger, 'report-function-identity');
  const service = fn.serviceConfig; const env = service?.environmentVariables;
  check(service.timeoutSeconds === 60 && service.maxInstanceCount === 3 && (service.minInstanceCount || 0) === 0 && service.serviceAccountEmail === runtimeIdentity, 'report-runtime-mismatch');
  check(env?.QBO_PRODUCTION_REPORTS_ENABLED === 'true' && env.QBO_PRODUCTION_CATALOG_ENABLED === 'true' && env.QBO_PRODUCTION_REALM_ID === REALM && env.QBO_PRODUCTION_OWNER_UID === uid, 'report-config-mismatch');
  const refs = service.secretEnvironmentVariables || [];
  check(refs.length === 3 && SECRETS.every(name => refs.some(s => s.key === name && s.secret === name && String(s.version) === '1' && [PROJECT, NUMBER].includes(String(s.projectId)))), 'report-secrets-mismatch');
}
function verifySource(fn, stage, files = FILES) {
  const storage = fn.buildConfig.source?.storageSource;
  check(storage?.bucket?.startsWith('gcf-v2-sources-' + NUMBER + '-') && /^[A-Za-z0-9_./-]+$/.test(storage.object || '') && /^\d+$/.test(String(storage.generation)), 'report-source-reference-invalid');
  const archive = path.join(process.env.RUNNER_TEMP, 'qbo-links-published.zip');
  try {
    run('gcloud', ['storage', 'cp', `gs://${storage.bucket}/${storage.object}#${storage.generation}`, archive, '--project=' + PROJECT, '--quiet']);
    const expected = [...files, 'package.json', '.env.' + PROJECT];
    const actual = run('unzip', ['-Z1', archive]).trim().split('\n').filter(file => !file.endsWith('/'));
    check(isDeepStrictEqual(actual.sort(), expected.sort()), 'unexpected-source-files');
    for (const file of expected) check(run('unzip', ['-p', archive, file]) === fs.readFileSync(path.join(stage, file), 'utf8'), 'published-report-source-mismatch');
  } finally { if (fs.existsSync(archive)) fs.unlinkSync(archive); }
}
async function boundaries(fetchImpl = fetch) {
  for (const item of [{ method: 'OPTIONS', origin: 'https://demac-aruba.com', status: 204 },
    { method: 'POST', origin: 'https://demac-aruba.com', status: 401, error: 'sign-in-required' },
    { method: 'GET', origin: 'https://demac-aruba.com', status: 405, error: 'method-not-allowed' },
    { method: 'POST', origin: 'https://untrusted.example', status: 403, error: 'origin-denied' }]) {
    const res = await fetchImpl(`https://us-central1-${PROJECT}.cloudfunctions.net/${NAME}`, { method: item.method,
      redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Origin: item.origin, 'Content-Type': 'application/json' },
      ...(item.method === 'POST' ? { body: '{}' } : {}) });
    check(res.status === item.status && res.headers.get('cache-control') === 'private, no-store', 'report-http-boundary');
    if (item.error) check((await res.json()).error === item.error, 'report-http-error');
  }
}
async function connectionMetadata(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/integrationPrivate/quickbooksProduction?mask.fieldPaths=connection&mask.fieldPaths=disconnect&mask.fieldPaths=operation&mask.fieldPaths=attempt.status`;
  const data = await google(url, token); const f = data.fields;
  check(f?.connection?.mapValue?.fields?.realmId?.stringValue === REALM && f.attempt?.mapValue?.fields?.status?.stringValue === 'completed' &&
    !f.disconnect?.mapValue && !f.operation?.mapValue, 'production-connection-not-idle-confirmed');
  return data; // Private metadata is only compared, never logged.
}
async function deploy() {
  releaseCheck(); const token = run('gcloud', ['auth', 'print-access-token']).trim(); check(token, 'cloud-identity-unavailable');
  const uid = await resolveOwner(token); const before = inventory();
  const existing = before.find(fn => fn.name === RESOURCE + NAME); // Retry is verification-only for an identical installed source.
  const identity = cloud(['functions', 'describe', 'quickbooksConnection', '--region=us-central1', '--gen2']);
  validateExisting(identity, uid, true); check(identity.serviceConfig.revision === 'quickbooksconnection-00002-vic', 'identity-revision-changed');
  verifyIdentitySource(identity, identityStage(uid));
  const installedReader = cloud(['functions', 'describe', 'quickbooksReports', '--region=us-central1', '--gen2']);
  reader.verifyFunction(installedReader, uid, identity.serviceConfig.serviceAccountEmail);
  check(installedReader.serviceConfig.revision === 'quickbooksreports-00002-gaf' && installedReader.serviceConfig.environmentVariables.QBO_PRODUCTION_CATALOG_ENABLED === 'true', 'reader-revision-changed');
  const readerStage = reader.stagePackage(uid);
  fs.appendFileSync(path.join(readerStage, '.env.' + PROJECT), 'QBO_PRODUCTION_CATALOG_ENABLED=true\n');
  verifySource(installedReader, readerStage, reader.FILES);
  const baseline = await connectionMetadata(token);
  for (const name of SECRETS) checkSecretVersions(name, await google(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}/versions?pageSize=10`, token));
  await disclosures(); const stage = stagePackage(uid);
  if (existing) {
    const fn = cloud(['functions', 'describe', NAME, '--region=us-central1', '--gen2']);
    verifyFunction(fn, uid, identity.serviceConfig.serviceAccountEmail); verifySource(fn, stage); await boundaries();
    check(isDeepStrictEqual(inventory(), before) && isDeepStrictEqual(await connectionMetadata(token), baseline), 'verification-state-changed');
    report.stage = 'verified-existing'; report.revision = fn.serviceConfig.revision; report.publishedSourceVerified = true; report.httpBoundaries = 'passed';
    console.log(JSON.stringify(report)); return;
  }
  report.stage = 'prepare-isolated-tools'; console.log(JSON.stringify(report));
  run('npm', ['ci', '--prefix', stage, '--ignore-scripts', '--no-audit', '--no-fund']);
  const tooling = path.join(process.env.RUNNER_TEMP, 'qbo-links-tools');
  run('npm', ['install', '--prefix', tooling, '--ignore-scripts', '--no-audit', '--no-fund', 'firebase-tools@15.30.0']);
  releaseCheck(); check(await resolveOwner(token) === uid && isDeepStrictEqual(inventory(), before) && isDeepStrictEqual(await connectionMetadata(token), baseline), 'preflight-state-changed');
  report.stage = 'deploy-single-identity-link-boundary'; console.log(JSON.stringify(report));
  run(path.join(tooling, 'node_modules/.bin/firebase'), ['deploy', '--only', 'functions:' + NAME, '--project', PROJECT,
    '--config', path.join(process.env.RUNNER_TEMP, 'qbo-links-firebase.json'), '--non-interactive'], { cwd: process.env.RUNNER_TEMP });
  report.stage = 'verify-deployment';
  const fn = cloud(['functions', 'describe', NAME, '--region=us-central1', '--gen2']);
  verifyFunction(fn, uid, identity.serviceConfig.serviceAccountEmail); verifySource(fn, stage);
  check(isDeepStrictEqual(inventory().filter(f => f.name !== RESOURCE + NAME), before), 'other-functions-changed-during-release');
  check(isDeepStrictEqual(await connectionMetadata(token), baseline), 'authorization-changed-during-release');
  await boundaries();
  report.stage = 'complete'; report.revision = fn.serviceConfig.revision; report.ownerVerified = true;
  report.publishedSourceVerified = true; report.otherFunctionsUnchanged = true; report.authorizationUnchanged = true; report.httpBoundaries = 'passed';
  console.log(JSON.stringify(report));
}
if (require.main === module) Promise.resolve().then(() => {
  if (process.argv[2] === '--check') { sourceCheck(); console.log('Pinned links, reader and identity sources verified.'); return; }
  check(process.argv[2] === '--deploy', 'unsupported-mode'); return deploy();
}).catch(error => { report.error = error.safeCode || 'command-failed'; console.error(JSON.stringify(report)); process.exitCode = 1; });
module.exports = { sourceCheck, stagePackage, verifyFunction, verifySource, boundaries, FILES };
