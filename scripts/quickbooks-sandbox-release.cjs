'use strict';
// Bounded continuation of the owner-approved sandbox connection, 2026-10-12.
// Release verification makes no authenticated provider or database calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const PROJECT = 'demac-corporation';
const NAME = 'quickbooksSandbox';
const REVIEWED = '4f1f6b5a058f1aa6d1bf33397c9852867e2ddb36';
const PREVIOUS_SOURCE = '25e180899879344b52493d82aa3d8547ef05a2de';
const PREVIOUS_REVISION = 'quickbookssandbox-00001-jec';
const ORIGIN = 'https://demac-aruba.com';
const REALM = '9341458478454738';
const FILES = ['quickbooksSandbox.js', 'quickbooksSandboxHttp.js', 'quickbooksSandboxService.js', 'quickbooksSandboxReports.js', 'package-lock.json'];
const SECRETS = ['QBO_SANDBOX_CLIENT_ID', 'QBO_SANDBOX_CLIENT_SECRET', 'QBO_SANDBOX_TOKEN_KEY'];
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
const git = args => run('git', args).trim();
const cloud = args => JSON.parse(run('gcloud', [...args, '--project=' + PROJECT, '--format=json']));
const summary = { project: PROJECT, function: NAME, realmId: REALM, accountingSync: false, stage: 'source-check' };
function sourceCheck() {
  for (const file of FILES) assert.equal(fs.readFileSync('functions/' + file, 'utf8'),
    run('git', ['show', REVIEWED + ':functions/' + file]), 'Reviewed source changed: ' + file);
  const current = JSON.parse(fs.readFileSync('functions/package.json', 'utf8'));
  const reviewed = JSON.parse(run('git', ['show', REVIEWED + ':functions/package.json']));
  assert.deepEqual(current.dependencies, reviewed.dependencies);
  assert.equal(current.engines.node, '22');
  return current;
}
function releaseCheck() {
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA);
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0], process.env.GITHUB_SHA,
    'Main advanced; review the current source before deployment');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  sourceCheck();
}
function prepare() {
  releaseCheck();
  const stage = path.join(process.env.RUNNER_TEMP, 'qbo-sandbox-source');
  fs.mkdirSync(stage, { recursive: true });
  for (const file of FILES) fs.copyFileSync('functions/' + file, path.join(stage, file));
  const manifest = sourceCheck();
  // Discovery can see ONLY the sandbox HTTP function, never operational ERP triggers.
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ ...manifest, main: 'quickbooksSandbox.js', scripts: {} }, null, 2));
  fs.writeFileSync(path.join(stage, '.env.' + PROJECT),
    `QBO_SANDBOX_ENABLED=true\nQBO_SANDBOX_REALM_ID=${REALM}\nQBO_SANDBOX_RETURN_URL=${ORIGIN}/integrations/\n`);
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'qbo-sandbox-firebase.json'), JSON.stringify({ functions: {
    source: 'qbo-sandbox-source', codebase: 'default', ignore: ['node_modules', '.git', '*debug*.log'] } }));
  console.log('Prepared isolated sandbox Function source; no credentials copied.');
}
function inventory() {
  return cloud(['functions', 'list', '--regions=us-central1', '--v2']).map(fn => ({ name: fn.name,
    state: fn.state, revision: fn.serviceConfig?.revision, updatedAt: fn.updateTime })).sort((a,b) => a.name.localeCompare(b.name));
}
async function boundaries() {
  const endpoint = `https://us-central1-${PROJECT}.cloudfunctions.net/${NAME}`;
  const cases = [
    { suffix: '', method: 'OPTIONS', origin: ORIGIN, status: 204 },
    { suffix: '', method: 'GET', origin: ORIGIN, status: 401, error: 'sign-in-required' },
    { suffix: '', method: 'POST', origin: ORIGIN, status: 401, error: 'sign-in-required' },
    { suffix: '', method: 'GET', origin: 'https://untrusted.example', status: 403, error: 'origin-denied' },
    { suffix: '/callback', method: 'GET', status: 400, error: 'invalid-state' },
  ];
  for (const item of cases) {
    const response = await fetch(endpoint + item.suffix, { method: item.method, redirect: 'manual',
      signal: AbortSignal.timeout(30000), headers: { ...(item.origin ? { Origin: item.origin } : {}),
        'Content-Type': 'application/json' }, ...(item.method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(response.status, item.status, 'HTTP boundary failed: ' + item.method + item.suffix);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (item.origin === ORIGIN) assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    if (item.error) assert.equal((await response.json()).error, item.error);
  }
  summary.httpBoundaries = 'passed';
}
async function deploy() {
  releaseCheck(); summary.stage = 'metadata-preflight';
  const before = inventory();
  const previous = cloud(['functions', 'describe', NAME, '--region=us-central1', '--gen2']);
  assert.equal(previous.serviceConfig?.revision, PREVIOUS_REVISION, 'Sandbox revision changed; review before updating');
  verifyConfiguration(previous);
  verifyPublishedSource(previous, PREVIOUS_SOURCE, FILES.filter(file => file !== 'quickbooksSandboxReports.js'));
  for (const secret of SECRETS) {
    const version = cloud(['secrets', 'versions', 'describe', '1', '--secret=' + secret]);
    assert.equal(version.state, 'ENABLED', 'Secret version must be enabled: ' + secret);
  }
  releaseCheck(); summary.stage = 'update-single-sandbox-function';
  run(path.join(process.env.RUNNER_TEMP, 'qbo-release-tools/node_modules/.bin/firebase'), [
    'deploy', '--only', 'functions:' + NAME, '--project', PROJECT,
    '--config', path.join(process.env.RUNNER_TEMP, 'qbo-sandbox-firebase.json'), '--non-interactive'],
  { cwd: process.env.RUNNER_TEMP });
  summary.stage = 'verify-function';
  const fn = cloud(['functions', 'describe', NAME, '--region=us-central1', '--gen2']);
  verifyConfiguration(fn);
  assert.deepEqual({ ...fn.serviceConfig, revision: null }, { ...previous.serviceConfig, revision: null },
    'Sandbox runtime configuration changed; review before proceeding');
  verifyPublishedSource(fn, REVIEWED, FILES);
  summary.publishedSourceVerified = true;
  summary.revision = fn.serviceConfig.revision;
  const after = inventory().filter(f => !f.name.endsWith('/' + NAME));
  assert.deepEqual(after, before.filter(f => !f.name.endsWith('/' + NAME)), 'Another function changed during release; inspect concurrent deployment');
  summary.existingFunctionsUnchanged = true;
  await boundaries(); summary.stage = 'complete';
}
function verifyConfiguration(fn) {
  assert.equal(fn.state, 'ACTIVE'); assert.equal(fn.buildConfig.runtime, 'nodejs22');
  assert.equal(fn.buildConfig.entryPoint, NAME); assert.equal(fn.serviceConfig.maxInstanceCount, 10);
  assert.equal(fn.serviceConfig.timeoutSeconds, 60);
  assert.ok(!fn.eventTrigger, 'No financial or operational event trigger allowed');
  assert.equal(fn.serviceConfig.environmentVariables.QBO_SANDBOX_ENABLED, 'true');
  assert.equal(fn.serviceConfig.environmentVariables.QBO_SANDBOX_REALM_ID, REALM);
  assert.equal(fn.serviceConfig.environmentVariables.QBO_SANDBOX_RETURN_URL, ORIGIN + '/integrations/');
  assert.deepEqual(fn.serviceConfig.secretEnvironmentVariables.map(s => s.key).sort(), [...SECRETS].sort());
  for (const secret of fn.serviceConfig.secretEnvironmentVariables) assert.equal(String(secret.version), '1');
}
function verifyPublishedSource(fn, source, files) {
  const storage = fn.buildConfig.source.storageSource;
  assert.ok(storage?.bucket && storage?.object, 'Published source reference missing');
  const archive = path.join(process.env.RUNNER_TEMP, 'qbo-published-source.zip');
  run('gcloud', ['storage', 'cp', `gs://${storage.bucket}/${storage.object}${storage.generation ? '#' + storage.generation : ''}`,
    archive, '--project=' + PROJECT, '--quiet']);
  try {
    for (const file of files) assert.equal(run('unzip', ['-p', archive, file]),
      run('git', ['show', source + ':functions/' + file]), 'Published source mismatch: ' + file);
  } finally { fs.unlinkSync(archive); }
}
(async () => {
  const mode = process.argv[2];
  if (mode === '--check') { sourceCheck(); console.log('Reviewed isolated source check passed.'); return; }
  if (mode === '--prepare') { prepare(); return; }
  assert.equal(mode, '--deploy'); await deploy(); console.log(JSON.stringify(summary));
})().catch(error => {
  summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Command failed';
  // Keep only CLI error lines. Never print full descriptions, environment values,
  // provider bodies, authorization parameters or underlying debug logs.
  const details = [error.stdout, error.stderr].map(v => String(v || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')).join('\n');
  summary.cliErrors = details.split('\n').filter(line => /^(ERROR:|Error:)/.test(line))
    .map(line => line.replace(/https:\/\/\S+/g, '[URL omitted]').slice(0, 500));
  console.error(JSON.stringify(summary)); process.exitCode = 1;
});
