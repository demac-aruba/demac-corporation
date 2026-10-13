'use strict';
// Read-only recovery verification after run 38435346866; never repeat its PATCH.
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { releaseCheck, resolveOwner, google, stagePackage, verifyPublishedSource, inventory,
  checkSecretVersions, checkTokenKey, PROJECT, NAME, RESOURCE, SECRETS } = require('./quickbooks-production-prepare.cjs');
const { validateExisting, boundaries, disclosures, ORIGINAL_REVISION } = require('./quickbooks-production-activate.cjs');
const STARTED = Date.parse('2026-10-13T17:02:53.223Z');
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); };
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
function compareRevisions(before, after) {
  function normalized(revision, enabled) {
    check(revision?.spec?.containers?.length === 1, 'unexpected-revision-containers');
    const spec = structuredClone(revision.spec); const container = spec.containers[0];
    check(typeof container.image === 'string' && container.image.includes('gcf-artifacts/'), 'unexpected-revision-image');
    const gate = container.env?.filter(e => e.name === 'QBO_PRODUCTION_ENABLED');
    check(gate?.length === 1 && gate[0].value === String(enabled), 'revision-gate-mismatch');
    delete container.image;
    container.env = container.env.filter(e => e.name !== 'QBO_PRODUCTION_ENABLED').sort((a,b) => a.name.localeCompare(b.name));
    return spec;
  }
  check(isDeepStrictEqual(normalized(before, false), normalized(after, true)), 'unrelated-revision-spec-changed');
  return { revisionSpecVerified: true, imageReferenceChanged: before.spec.containers[0].image !== after.spec.containers[0].image,
    imageDigestChanged: before.status?.imageDigest !== after.status?.imageDigest };
}
function verifyOtherUpdateTimes(items) {
  const others = items.filter(f => f.name !== RESOURCE + NAME);
  check(others.length > 0 && others.every(f => Number.isFinite(Date.parse(f.updatedAt)) && Date.parse(f.updatedAt) < STARTED),
    'other-function-updated-since-activation');
  return others.length;
}
async function audit() {
  releaseCheck();
  const token = run('gcloud', ['auth', 'print-access-token']).trim(); check(Boolean(token), 'cloud-identity-unavailable');
  const uid = await resolveOwner(token); const beforeInventory = inventory();
  const url = `https://cloudfunctions.googleapis.com/v2/${RESOURCE}${NAME}`;
  const fn = await google(url, token); validateExisting(fn, uid, true);
  check(/^quickbooksconnection-00002-[a-z0-9]+$/.test(fn.serviceConfig.revision), 'unexpected-active-revision');
  const stage = stagePackage(uid); verifyPublishedSource(fn, stage);
  for (const name of SECRETS) checkSecretVersions(name, await google(
    `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}/versions?pageSize=10`, token));
  checkTokenKey(await google(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${SECRETS[2]}`, token));
  const revision = name => JSON.parse(run('gcloud', ['run', 'revisions', 'describe', name,
    '--project=' + PROJECT, '--region=us-central1', '--format=json']));
  const previous = revision(ORIGINAL_REVISION); const active = revision(fn.serviceConfig.revision);
  check(previous.metadata?.name === ORIGINAL_REVISION && active.metadata?.name === fn.serviceConfig.revision, 'revision-identity-mismatch');
  const revisionEvidence = compareRevisions(previous, active);
  const otherFunctionsChecked = verifyOtherUpdateTimes(beforeInventory);
  check(beforeInventory.some(f => f.name === RESOURCE + 'quickbooksSandbox' && f.state === 'ACTIVE' &&
    f.revision === 'quickbookssandbox-00002-meb'), 'sandbox-changed');
  await disclosures(); await boundaries(true);
  check(await resolveOwner(token) === uid && isDeepStrictEqual(await google(url, token), fn) &&
    isDeepStrictEqual(inventory(), beforeInventory), 'cloud-state-changed-during-audit');
  console.log(JSON.stringify({ stage: 'read-only-activation-audit-complete', readOnly: true, productionEnabled: true,
    ownerVerified: true, publishedSourceVerified: true, secretVersionsVerified: true, httpBoundaries: 'passed',
    disclosuresVerified: true, otherFunctionsChecked, otherFunctionsUpdatedSinceActivation: false,
    ...revisionEvidence, revision: fn.serviceConfig.revision, accountingWrites: false, financialReports: false,
    providerCalls: false, secretPayloadsAccessed: false,
    buildMetadataKeys: Object.keys(fn.buildConfig).sort() }));
}
if (require.main === module) audit().catch(error => {
  console.error(JSON.stringify({ stage: 'read-only-activation-audit', readOnly: true, error: error.safeCode || 'command-failed' }));
  process.exitCode = 1;
});
module.exports = { compareRevisions, verifyOtherUpdateTimes };
