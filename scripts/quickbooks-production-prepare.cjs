'use strict';
// Owner-authorized initial installation only. No production OAuth or accounting call.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const PROJECT = 'demac-corporation';
const NUMBER = '1053571783393';
const NAME = 'quickbooksConnection';
const REALM = '9130352327074466';
// Exact business sign-in address supplied by the owner, not inferred from repository authors.
const OWNER_EMAIL = 'gm.demac@gmail.com';
const REVIEWED = '14eda78996ca67497f7b86edd50ac965035018a1';
const ORIGIN = 'https://demac-aruba.com';
const FILES = ['quickbooksConnection.js', 'quickbooksConnectionHttp.js', 'quickbooksConnectionService.js', 'package-lock.json'];
const SECRETS = ['QBO_PRODUCTION_CLIENT_ID', 'QBO_PRODUCTION_CLIENT_SECRET', 'QBO_PRODUCTION_TOKEN_KEY'];
const RESOURCE = `projects/${PROJECT}/locations/us-central1/functions/`;
const report = { project: PROJECT, function: NAME, realmId: REALM, productionEnabled: false,
  accountingWrites: false, providerCalls: false, stage: 'source-check' };
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); };
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
const git = args => run('git', args).trim();
const cloud = args => JSON.parse(run('gcloud', [...args, '--project=' + PROJECT, '--format=json']));
const normalizedRole = role => String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

function ownerFromLookup(data) {
  check(Array.isArray(data?.users) && data.users.length === 1, 'owner-lookup-not-unique');
  const user = data.users[0];
  check(typeof user.email === 'string' && user.email.toLowerCase() === OWNER_EMAIL &&
    (user.disabled === undefined || user.disabled === false) && typeof user.localId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(user.localId), 'owner-auth-invalid');
  return user.localId;
}
function checkProfile(data, uid) {
  check(data?.name === `projects/${PROJECT}/databases/(default)/documents/users/${uid}`, 'owner-profile-identity');
  const fields = data.fields || {};
  check(fields.active?.booleanValue === true && ['owner', 'admin', 'superadmin', 'super_admin'].includes(
    normalizedRole(fields.role?.stringValue)), 'owner-profile-not-active-admin');
  check(!fields.email || (typeof fields.email.stringValue === 'string' && fields.email.stringValue.toLowerCase() === OWNER_EMAIL),
    'owner-profile-email-mismatch');
}
async function google(url, token, { method = 'GET', body, allowMissing = false, fetchImpl = fetch } = {}) {
  let response;
  try { response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw Object.assign(new Error(), { safeCode: 'google-request-failed' }); }
  if (response.status === 404 && allowMissing) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(), { safeCode: 'google-http-' + response.status }); }
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 65536) { await reader.cancel(); check(false, 'google-response-too-large'); }
    chunks.push(Buffer.from(value)); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { check(false, 'google-response-invalid'); }
  check(data && typeof data === 'object' && !Array.isArray(data), 'google-response-invalid'); return data;
}
async function resolveOwner(token, fetchImpl = fetch) {
  const auth = await google(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup?fields=users(localId,email,disabled)`,
    token, { method: 'POST', body: { email: [OWNER_EMAIL] }, fetchImpl });
  const uid = ownerFromLookup(auth);
  const profile = await google(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}?mask.fieldPaths=active&mask.fieldPaths=role&mask.fieldPaths=email`, token, { fetchImpl });
  checkProfile(profile, uid); return uid;
}
function sourceCheck() {
  for (const file of FILES) check(fs.readFileSync('functions/' + file, 'utf8') ===
    run('git', ['show', REVIEWED + ':functions/' + file]), 'reviewed-source-changed');
  const current = JSON.parse(fs.readFileSync('functions/package.json', 'utf8'));
  const reviewed = JSON.parse(run('git', ['show', REVIEWED + ':functions/package.json']));
  check(JSON.stringify(current.dependencies) === JSON.stringify(reviewed.dependencies) && current.engines.node === '22', 'reviewed-dependencies-changed');
  return reviewed;
}
function releaseCheck() {
  check(process.env.GITHUB_REPOSITORY === 'demac-aruba/demac-corporation' && process.env.GITHUB_REF === 'refs/heads/main', 'reviewed-main-only');
  check(git(['rev-parse', 'HEAD']) === process.env.GITHUB_SHA &&
    git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === process.env.GITHUB_SHA, 'main-advanced-review-required');
  check(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'runner-temp-required'); sourceCheck();
}
function environment(uid) {
  check(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), 'owner-uid-invalid');
  return `QBO_PRODUCTION_ENABLED=false\nQBO_PRODUCTION_REALM_ID=${REALM}\nQBO_PRODUCTION_OWNER_UID=${uid}\n`;
}
function stagePackage(uid) {
  const stage = path.join(process.env.RUNNER_TEMP, 'qbo-production-source');
  fs.mkdirSync(stage, { recursive: true });
  check(fs.readdirSync(stage).length === 0, 'stage-not-empty');
  for (const file of FILES) fs.copyFileSync('functions/' + file, path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ ...sourceCheck(), main: NAME + '.js', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(stage, '.env.' + PROJECT), environment(uid), { mode: 0o600 });
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'qbo-production-firebase.json'), JSON.stringify({ functions: {
    source: 'qbo-production-source', codebase: 'default', ignore: ['node_modules', '.git', '*debug*.log'] } }));
  return stage;
}
function inventory() {
  return cloud(['functions', 'list', '--regions=us-central1', '--v2']).map(fn => ({ name: fn.name,
    state: fn.state, revision: fn.serviceConfig?.revision, updatedAt: fn.updateTime })).sort((a,b) => a.name.localeCompare(b.name));
}
function checkSecretVersions(name, data) {
  check(data && !data.nextPageToken && Array.isArray(data.versions) && data.versions.length === 1 &&
    [`projects/${PROJECT}/secrets/${name}/versions/1`, `projects/${NUMBER}/secrets/${name}/versions/1`].includes(data.versions[0].name) &&
    data.versions[0].state === 'ENABLED', 'secret-version-review-required');
}
function checkTokenKey(data) {
  check([`projects/${PROJECT}/secrets/${SECRETS[2]}`, `projects/${NUMBER}/secrets/${SECRETS[2]}`].includes(data?.name) &&
    data.labels?.integration === 'qbo-production' && data.labels?.['managed-by'] === 'reviewed-release', 'existing-token-key-review-required');
}
function verifyFunction(fn, uid) {
  check(fn?.name === RESOURCE + NAME && fn.state === 'ACTIVE' && fn.buildConfig?.runtime === 'nodejs22' &&
    fn.buildConfig.entryPoint === NAME && !fn.eventTrigger, 'function-identity-mismatch');
  const service = fn.serviceConfig; const env = service?.environmentVariables || {};
  check(service.maxInstanceCount === 3 && service.timeoutSeconds === 60 && (service.minInstanceCount || 0) === 0,
    'function-runtime-mismatch');
  check(env.QBO_PRODUCTION_ENABLED === 'false' && env.QBO_PRODUCTION_REALM_ID === REALM && env.QBO_PRODUCTION_OWNER_UID === uid,
    'function-config-mismatch');
  const refs = service.secretEnvironmentVariables || [];
  check(refs.length === 3 && SECRETS.every(name => refs.some(s => s.key === name && s.secret === name &&
    String(s.version) === '1' && [PROJECT, NUMBER].includes(String(s.projectId)))), 'function-secret-bindings-mismatch');
}
function verifyPublishedSource(fn, stage) {
  const storage = fn.buildConfig.source?.storageSource;
  check(storage?.bucket?.startsWith('gcf-v2-sources-' + NUMBER + '-') && typeof storage.object === 'string' &&
    /^[A-Za-z0-9_./-]+$/.test(storage.object) && /^\d+$/.test(String(storage.generation)), 'published-source-reference-invalid');
  const archive = path.join(process.env.RUNNER_TEMP, 'qbo-production-published.zip');
  try {
    run('gcloud', ['storage', 'cp', `gs://${storage.bucket}/${storage.object}#${storage.generation}`, archive, '--project=' + PROJECT, '--quiet']);
    for (const file of [...FILES, 'package.json', '.env.' + PROJECT]) check(run('unzip', ['-p', archive, file]) ===
      fs.readFileSync(path.join(stage, file), 'utf8'), 'published-source-mismatch');
  } finally { if (fs.existsSync(archive)) fs.unlinkSync(archive); }
}
async function boundaries(fetchImpl = fetch) {
  for (const item of [
    { method: 'OPTIONS', origin: ORIGIN, status: 204 },
    { method: 'GET', origin: ORIGIN, status: 401, error: 'sign-in-required' },
    { method: 'POST', origin: ORIGIN, status: 401, error: 'sign-in-required' },
    { method: 'GET', origin: 'https://untrusted.example', status: 403, error: 'origin-denied' },
    { method: 'GET', suffix: '/callback', status: 503, error: 'not-configured' },
  ]) {
    const response = await fetchImpl(`https://us-central1-${PROJECT}.cloudfunctions.net/${NAME}${item.suffix || ''}`, {
      method: item.method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: {
        ...(item.origin ? { Origin: item.origin } : {}), 'Content-Type': 'application/json' },
      ...(item.method === 'POST' ? { body: '{}' } : {}) });
    check(response.status === item.status && response.headers.get('cache-control') === 'private, no-store', 'http-boundary-failed');
    if (item.origin === ORIGIN) check(response.headers.get('access-control-allow-origin') === ORIGIN, 'cors-boundary-failed');
    if (item.error) check((await response.json()).error === item.error, 'http-error-boundary-failed');
  }
}
async function diagnose(token, fetchImpl = fetch) {
  const result = { stage: 'read-only-installation-diagnostic', readOnly: true, secretPayloadsAccessed: false,
    providerCalls: false, permissions: {}, keyExists: false, enabledVersion1: false, versionCount: 0 };
  const permissions = ['secretmanager.secrets.create', 'secretmanager.versions.add', 'secretmanager.secrets.getIamPolicy', 'secretmanager.secrets.setIamPolicy'];
  const tested = await google(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`,
    token, { method: 'POST', body: { permissions }, fetchImpl });
  for (const permission of permissions) result.permissions[permission] = Array.isArray(tested.permissions) && tested.permissions.includes(permission);
  const keyUrl = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRETS[2]}`;
  const key = await google(keyUrl, token, { allowMissing: true, fetchImpl });
  if (key) {
    checkTokenKey(key); result.keyExists = true;
    const versions = await google(keyUrl + '/versions?pageSize=10', token, { fetchImpl });
    check(!versions.nextPageToken && Array.isArray(versions.versions || []), 'diagnostic-versions-incomplete');
    result.versionCount = (versions.versions || []).length;
    result.enabledVersion1 = (versions.versions || []).some(v =>
      [`projects/${PROJECT}/secrets/${SECRETS[2]}/versions/1`, `projects/${NUMBER}/secrets/${SECRETS[2]}/versions/1`].includes(v.name) && v.state === 'ENABLED');
  }
  const fn = await google(`https://cloudfunctions.googleapis.com/v2/${RESOURCE}${NAME}`, token, { allowMissing: true, fetchImpl });
  result.productionFunctionExists = Boolean(fn);
  // A narrowly timed failed-operation audit, projected before delivery; never request secret data.
  try {
    const audit = await google('https://logging.googleapis.com/v2/entries:list?fields=entries(protoPayload(methodName,status(code,message)))', token,
      { method: 'POST', body: { resourceNames: ['projects/' + PROJECT], pageSize: 10, orderBy: 'timestamp desc',
        filter: 'timestamp>="2026-10-13T15:03:30Z" AND timestamp<="2026-10-13T15:04:10Z" AND protoPayload.serviceName="secretmanager.googleapis.com" AND protoPayload.status.code>0 AND (protoPayload.resourceName:"/secrets/QBO_PRODUCTION_TOKEN_KEY" OR protoPayload.request.secretId="QBO_PRODUCTION_TOKEN_KEY") AND (protoPayload.methodName="google.cloud.secretmanager.v1.SecretManagerService.CreateSecret" OR protoPayload.methodName="google.cloud.secretmanager.v1.SecretManagerService.AddSecretVersion")' }, fetchImpl });
    result.failedOperations = (audit.entries || []).map(entry => ({
      operation: entry.protoPayload?.methodName?.endsWith('.CreateSecret') ? 'create-secret' : 'add-version',
      statusCode: Number.isInteger(entry.protoPayload?.status?.code) ? entry.protoPayload.status.code : null,
      namedPermissions: permissions.filter(permission => String(entry.protoPayload?.status?.message || '').includes(permission)),
    }));
  } catch (error) { result.auditUnavailable = error.safeCode || 'audit-unavailable'; }
  return result;
}
async function install() {
  releaseCheck(); report.stage = 'verify-owner';
  const token = run('gcloud', ['auth', 'print-access-token']).trim(); check(Boolean(token), 'cloud-identity-unavailable');
  const uid = await resolveOwner(token); report.ownerVerified = true;
  console.log(JSON.stringify({ stage: report.stage, ownerVerified: true, profileActiveAdmin: true }));
  report.stage = 'metadata-preflight';
  const before = inventory(); check(!before.some(fn => fn.name === RESOURCE + NAME), 'production-function-already-exists-review-required');
  check(before.some(fn => fn.name === RESOURCE + 'quickbooksSandbox' && fn.state === 'ACTIVE' && fn.revision === 'quickbookssandbox-00002-meb'),
    'sandbox-revision-changed-review-required');
  const sandbox = cloud(['functions', 'describe', 'quickbooksSandbox', '--region=us-central1', '--gen2']);
  const runtimeIdentity = sandbox.serviceConfig?.serviceAccountEmail;
  check([`${NUMBER}-compute@developer.gserviceaccount.com`, `${PROJECT}@appspot.gserviceaccount.com`].includes(runtimeIdentity),
    'runtime-identity-review-required');
  const versions = async name => google(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}/versions?pageSize=10`, token);
  for (const name of SECRETS.slice(0, 2)) checkSecretVersions(name, await versions(name));
  const keyUrl = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRETS[2]}`;
  const existing = await google(keyUrl, token, { allowMissing: true });
  if (existing) checkTokenKey(existing);
  const stage = stagePackage(uid);
  // Install dependencies before creating any cloud resource. Root lifecycle hooks never run.
  report.stage = 'install-isolated-tooling';
  run('npm', ['ci', '--prefix', stage, '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npm', ['install', '--prefix', path.join(process.env.RUNNER_TEMP, 'qbo-production-tools'), '--ignore-scripts', '--no-audit', '--no-fund', 'firebase-tools@15.30.0']);
  releaseCheck(); check(await resolveOwner(token) === uid, 'owner-changed-review-required');
  if (!existing) {
    report.stage = 'create-encryption-key';
    const bytes = crypto.randomBytes(32); const encoded = Buffer.from(bytes.toString('base64')); bytes.fill(0);
    try { run('gcloud', ['secrets', 'create', SECRETS[2], '--project=' + PROJECT, '--replication-policy=automatic',
      '--labels=integration=qbo-production,managed-by=reviewed-release', '--data-file=-', '--quiet'], { input: encoded }); }
    finally { encoded.fill(0); }
    report.encryptionKeyCreated = true;
  } else report.encryptionKeyCreated = false;
  checkTokenKey(await google(keyUrl, token)); checkSecretVersions(SECRETS[2], await versions(SECRETS[2]));
  for (const name of SECRETS.slice(0, 2)) checkSecretVersions(name, await versions(name));
  releaseCheck();
  check(JSON.stringify(inventory()) === JSON.stringify(before), 'functions-changed-before-deploy');
  report.stage = 'deploy-single-disabled-function'; console.log(JSON.stringify(report));
  run(path.join(process.env.RUNNER_TEMP, 'qbo-production-tools/node_modules/.bin/firebase'), [
    'deploy', '--only', 'functions:' + NAME, '--project', PROJECT, '--config',
    path.join(process.env.RUNNER_TEMP, 'qbo-production-firebase.json'), '--non-interactive'], { cwd: process.env.RUNNER_TEMP });
  report.stage = 'verify-disabled-function';
  const fn = cloud(['functions', 'describe', NAME, '--region=us-central1', '--gen2']);
  check(fn.serviceConfig?.serviceAccountEmail === runtimeIdentity, 'runtime-identity-changed-review-required');
  verifyFunction(fn, uid); verifyPublishedSource(fn, stage);
  check(JSON.stringify(inventory().filter(f => f.name !== RESOURCE + NAME)) === JSON.stringify(before), 'other-function-changed-during-deploy');
  check(await resolveOwner(token) === uid, 'owner-changed-during-deploy');
  await boundaries();
  report.publishedSourceVerified = true; report.otherFunctionsUnchanged = true; report.httpBoundaries = 'passed';
  report.revision = fn.serviceConfig.revision; report.stage = 'complete'; console.log(JSON.stringify(report));
}
if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv[2] === '--check') { sourceCheck(); console.log('Reviewed isolated production source unchanged.'); return; }
    if (process.argv[2] === '--diagnose') {
      releaseCheck(); report.stage = 'read-only-installation-diagnostic';
      return diagnose(run('gcloud', ['auth', 'print-access-token']).trim()).then(result => console.log(JSON.stringify(result)));
    }
    check(process.argv[2] === '--install-disabled', 'unsupported-mode'); return install();
  }).catch(error => {
    report.error = error.safeCode || 'command-failed';
    // No raw CLI stderr, Auth/Firestore responses, environment values or credentials in logs.
    console.error(JSON.stringify(report)); process.exitCode = 1;
  });
}
module.exports = { ownerFromLookup, checkProfile, resolveOwner, google, environment, checkSecretVersions, checkTokenKey,
  verifyFunction, boundaries, diagnose, sourceCheck, stagePackage, releaseCheck, inventory, verifyPublishedSource,
  OWNER_EMAIL, PROJECT, NUMBER, NAME, REALM, SECRETS, RESOURCE };
