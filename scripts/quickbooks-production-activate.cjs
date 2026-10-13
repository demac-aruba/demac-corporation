'use strict';
// Change one existing function's runtime gate. No redeploy, IAM/secret mutation or Intuit call.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { resolveOwner, google, checkSecretVersions, checkTokenKey, verifyFunction, sourceCheck,
  stagePackage, releaseCheck, inventory, verifyPublishedSource, PROJECT, NUMBER, NAME, REALM, SECRETS, RESOURCE,
} = require('./quickbooks-production-prepare.cjs');
const FUNCTION_URL = `https://cloudfunctions.googleapis.com/v2/${RESOURCE}${NAME}`;
const ORIGINAL_REVISION = 'quickbooksconnection-00001-taq';
const ORIGIN = 'https://demac-aruba.com';
const LEGAL = ['quickbooks-terms.html', 'quickbooks-privacy.html'];
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); };
const report = { stage: 'source-check', project: PROJECT, function: NAME, accountingWrites: false,
  financialReports: false, providerCalls: false, secretPayloadsAccessed: false };

function validateExisting(fn, uid, enabled) {
  check(typeof enabled === 'boolean' && fn?.serviceConfig?.environmentVariables?.QBO_PRODUCTION_ENABLED === String(enabled),
    'unexpected-activation-state');
  const copy = structuredClone(fn); copy.serviceConfig.environmentVariables.QBO_PRODUCTION_ENABLED = 'false';
  verifyFunction(copy, uid);
  check([`${NUMBER}-compute@developer.gserviceaccount.com`, `${PROJECT}@appspot.gserviceaccount.com`].includes(
    fn.serviceConfig.serviceAccountEmail), 'runtime-identity-review-required');
}
function patchRequest(fn, enabled) {
  check(fn?.name === RESOURCE + NAME && typeof enabled === 'boolean', 'invalid-activation-target');
  return { url: FUNCTION_URL + '?updateMask=serviceConfig.environmentVariables', method: 'PATCH', body: {
    name: fn.name, serviceConfig: { environmentVariables: { ...fn.serviceConfig.environmentVariables,
      QBO_PRODUCTION_ENABLED: String(enabled) } },
  } };
}
function verifyOnlyGateChanged(before, after, uid, enabled) {
  validateExisting(after, uid, enabled);
  const service = fn => {
    const value = structuredClone(fn.serviceConfig);
    delete value.revision; delete value.environmentVariables.QBO_PRODUCTION_ENABLED; return value;
  };
  check(isDeepStrictEqual(service(before), service(after)), 'unrelated-service-config-changed');
  // A config-only update must preserve the published build and source, including its original disabled .env.
  check(isDeepStrictEqual(before.buildConfig, after.buildConfig), 'published-build-changed');
  for (const key of ['name', 'labels', 'eventTrigger', 'environment', 'kmsKeyName']) {
    check(isDeepStrictEqual(before[key], after[key]), 'unrelated-function-config-changed');
  }
}
async function disclosures(fetchImpl = fetch) {
  for (const file of LEGAL) {
    const expected = fs.readFileSync('apps/erp-next/public/legal/' + file, 'utf8');
    const res = await fetchImpl(`${ORIGIN}/legal/${file}`, { redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(20000) });
    check(res.status === 200 && /text\/html/i.test(res.headers.get('content-type') || ''), 'production-disclosure-unavailable');
    const reader = res.body.getReader(); let size = 0; const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 65536) { await reader.cancel(); check(false, 'production-disclosure-too-large'); }
      chunks.push(Buffer.from(value)); }
    check(Buffer.concat(chunks).toString('utf8') === expected, 'production-disclosure-not-published');
  }
}
async function boundaries(enabled, fetchImpl = fetch) {
  for (const item of [
    { method: 'OPTIONS', origin: ORIGIN, status: 204 },
    { method: 'GET', origin: ORIGIN, status: 401, error: 'sign-in-required' },
    { method: 'POST', origin: ORIGIN, status: 401, error: 'sign-in-required' },
    { method: 'GET', origin: 'https://untrusted.example', status: 403, error: 'origin-denied' },
    { method: 'GET', suffix: '/callback', status: enabled ? 400 : 503, error: enabled ? 'invalid-state' : 'not-configured' },
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
function operationName(op) {
  check(typeof op?.name === 'string' && new RegExp(`^projects/(?:${PROJECT}|${NUMBER})/locations/us-central1/operations/[A-Za-z0-9_-]+$`).test(op.name),
    'invalid-operation-reference'); return op.name;
}
async function waitForOperation(op, token, { request = google, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 120 } = {}) {
  const name = operationName(op);
  for (let i = 0; i <= attempts; i++) {
    if (op.done) { check(!op.error, 'activation-operation-failed'); return; }
    check(i < attempts, 'activation-operation-outcome-unknown');
    await pause(5000); op = await request('https://cloudfunctions.googleapis.com/v2/' + name, token);
    check(op.name === name, 'operation-reference-changed');
  }
}
async function activate(enabled) {
  releaseCheck(); report.requestedEnabled = enabled; report.stage = 'verify-existing-installation';
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  check(Boolean(token), 'cloud-identity-unavailable');
  const uid = await resolveOwner(token); const beforeInventory = inventory();
  const before = await google(FUNCTION_URL, token);
  const currentlyEnabled = before.serviceConfig?.environmentVariables?.QBO_PRODUCTION_ENABLED === 'true';
  validateExisting(before, uid, currentlyEnabled);
  check(beforeInventory.some(f => f.name === RESOURCE + 'quickbooksSandbox' && f.state === 'ACTIVE' &&
    f.revision === 'quickbookssandbox-00002-meb'), 'sandbox-revision-changed-review-required');
  const stage = stagePackage(uid); verifyPublishedSource(before, stage);
  for (const name of SECRETS) checkSecretVersions(name, await google(
    `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}/versions?pageSize=10`, token));
  checkTokenKey(await google(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRETS[2]}`, token));
  if (enabled) {
    check(!currentlyEnabled && before.serviceConfig.revision === ORIGINAL_REVISION, 'activation-already-attempted-review-required');
    // Only document existence is needed. Do not retrieve saved credentials or financial data.
    const record = await google(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/integrationPrivate/quickbooksProduction?mask.fieldPaths=connection.version`,
      token, { allowMissing: true });
    check(record === null, 'existing-authorization-review-required');
    await disclosures();
  }
  releaseCheck(); check(await resolveOwner(token) === uid, 'owner-changed-review-required');
  check(isDeepStrictEqual(await google(FUNCTION_URL, token), before) && isDeepStrictEqual(inventory(), beforeInventory),
    'cloud-state-changed-before-activation');
  report.ownerVerified = true; report.publishedSourceVerified = true;
  if (currentlyEnabled !== enabled) {
    report.stage = 'update-runtime-gate'; report.updateSubmitted = true; console.log(JSON.stringify(report));
    const patch = patchRequest(before, enabled);
    const operation = await google(patch.url, token, { method: patch.method, body: patch.body });
    await waitForOperation(operation, token);
  }
  report.stage = 'verify-runtime-gate';
  const after = await google(FUNCTION_URL, token); verifyOnlyGateChanged(before, after, uid, enabled);
  verifyPublishedSource(after, stage);
  check(isDeepStrictEqual(inventory().filter(f => f.name !== RESOURCE + NAME), beforeInventory.filter(f => f.name !== RESOURCE + NAME)),
    'other-function-changed-during-activation');
  check(await resolveOwner(token) === uid, 'owner-changed-during-activation'); await boundaries(enabled);
  report.stage = 'complete'; report.productionEnabled = enabled; report.otherFunctionsUnchanged = true;
  report.httpBoundaries = 'passed'; report.revision = after.serviceConfig.revision; console.log(JSON.stringify(report));
}
if (require.main === module) Promise.resolve().then(() => {
  if (process.argv[2] === '--check') { sourceCheck(); console.log('Reviewed connector source unchanged; runtime-only activation.'); return; }
  check(['--activate', '--disable'].includes(process.argv[2]), 'unsupported-mode');
  return activate(process.argv[2] === '--activate');
}).catch(error => {
  report.error = error.safeCode || 'command-failed';
  // An uncertain PATCH is never retried blindly or described as disabled; inspect/recover through --disable.
  if (report.updateSubmitted) report.outcomeRequiresVerification = true;
  console.error(JSON.stringify(report)); process.exitCode = 1;
});
module.exports = { validateExisting, patchRequest, verifyOnlyGateChanged, disclosures, boundaries, operationName, waitForOperation, ORIGINAL_REVISION };
