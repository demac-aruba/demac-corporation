'use strict';
// Configuration rollback only. This does not publish source or waive log review.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { configHash, configurationRestorationPlan } = require('./booking-dwelling-release.cjs');
const NAME = 'notifyBookingReferenceUpdate';
const RESOURCE = 'projects/demac-corporation/locations/us-central1/functions/' + NAME;
const ORIGINAL = '956adcd5f88a66e4c349347e5f6fe667b59cf2b25d9bec73c440f646511af662';
const IAM = 'de8e97540ca3499319bd4571ad89c465fd68328a4c4f26d143ca6f58d31816ac';
const SOURCE = { bucket: 'gcf-v2-sources-1053571783393-us-central1', generation: '1791840714365683', object: 'notifyBookingReferenceUpdate/function-source.zip' };
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
function recoveryRequest() {
  return { url: 'https://cloudfunctions.googleapis.com/v2/' + RESOURCE + '?updateMask=serviceConfig.maxInstanceCount',
    method: 'PATCH', body: { name: RESOURCE, serviceConfig: { maxInstanceCount: 0 } } };
}
async function main() {
  const result = { mode: 'restore-original-scaling-only', publicationAuditComplete: false, logReview: 'blocked: logging read permission denied', stage: 'preflight' };
  const save = () => fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'dwelling-scaling-recovery.json'), JSON.stringify(result, null, 2));
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = args => run('git', args);
  const cloud = args => JSON.parse(run('gcloud', args));
  const describe = () => cloud(['functions', 'describe', NAME, '--project=demac-corporation', '--region=us-central1', '--gen2', '--format=json']);
  const iam = fn => hash(cloud(['run', 'services', 'get-iam-policy', fn.serviceConfig.service.split('/').pop(), '--project=demac-corporation', '--region=us-central1', '--format=json']));
  const lease = () => {
    assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/recovery/booking-dwelling-scaling-20261012');
    assert.equal(git(['rev-parse', 'HEAD']), process.env.GITHUB_SHA);
    assert.equal(git(['ls-remote', 'origin', process.env.GITHUB_REF]).split(/\s/)[0], process.env.GITHUB_SHA);
    assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0], '0dc09f3167150ed775018a6f257542961b21cddf');
    assert.equal(git(['rev-parse', 'HEAD:functions']), '8082179127e0da06510c12252e4bd51fcc38ea72', 'Application source changed');
  };
  try {
    lease();
    const before = describe(); assert.equal(before.state, 'ACTIVE');
    assert.deepEqual(before.buildConfig.source.storageSource, SOURCE, 'Audited source generation changed');
    assert.equal(iam(before), IAM, 'Original IAM changed');
    const plan = configurationRestorationPlan(NAME, before, ORIGINAL);
    result.beforeRevision = before.serviceConfig.revision; result.beforeConfigHash = configHash(before); result.plan = plan;
    result.deploymentAccount = run('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
    save();
    if (plan.required) {
      assert.equal(before.serviceConfig.revision, 'notifybookingreferenceupdate-00002-wod', 'Unreviewed revision');
      lease();
      const fresh = describe(); assert.equal(configHash(fresh), configHash(before)); assert.deepEqual(fresh.buildConfig.source, before.buildConfig.source);
      const token = run('gcloud', ['auth', 'print-access-token']);
      const request = recoveryRequest(); result.stage = 'restore-original-setting'; save();
      const call = async (url, options = {}) => {
        const response = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
        assert.ok(response.ok, 'Google control-plane HTTP ' + response.status); return response.json();
      };
      let operation = await call(request.url, { method: request.method, body: JSON.stringify(request.body) });
      assert.match(operation.name, /^projects\/[^/]+\/locations\/us-central1\/operations\/[^/]+$/);
      const operationUrl = 'https://cloudfunctions.googleapis.com/v2/' + operation.name;
      for (let attempt = 0; !operation.done && attempt < 90; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 4000)); operation = await call(operationUrl);
      }
      assert.equal(operation.done, true, 'Recovery operation not complete'); assert.ok(!operation.error, 'Recovery operation returned an error');
    }
    const after = describe(); assert.equal(after.state, 'ACTIVE'); assert.equal(configHash(after), ORIGINAL, 'Original configuration was not restored');
    assert.equal(iam(after), IAM, 'Original IAM changed'); assert.deepEqual(after.buildConfig.source, before.buildConfig.source, 'Source changed during configuration-only recovery');
    lease(); Object.assign(result, { stage: 'complete', afterRevision: after.serviceConfig.revision, originalConfigurationRestored: true, iamPreserved: true, sourcePreserved: true, afterConfigHash: configHash(after) }); save();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { result.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Configuration-only recovery failed'; result.exitStatus = error.status || error.code || null; save(); console.error(result.error); process.exitCode = 1; }
}
module.exports = { recoveryRequest };
if (require.main === module) main();
