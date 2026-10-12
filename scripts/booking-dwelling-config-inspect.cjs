'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { releaseConfig, configHash } = require('./booking-dwelling-release.cjs');
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const digest = v => crypto.createHash('sha256').update(JSON.stringify(stable(v)) ?? 'undefined').digest('hex');
const cloud = args => JSON.parse(execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const expected = '956adcd5f88a66e4c349347e5f6fe667b59cf2b25d9bec73c440f646511af662';
const primitive = v => v == null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && /^(RETRY_POLICY_(RETRY|DO_NOT_RETRY|UNSPECIFIED)|ALLOW_(ALL|INTERNAL_ONLY|INTERNAL_AND_GCLB)|nodejs[0-9]+|ARTIFACT_REGISTRY|automatic|on-deploy)$/.test(v));
const safe = v => primitive(v) ? v : { sha256: digest(v), ...(v && typeof v === 'object' && !Array.isArray(v) ? { keys: Object.keys(v) } : {}) };
// Only expose documented scaling settings; all other annotation values stay hashed.
const scaling = resource => Object.fromEntries(Object.entries(resource?.metadata?.annotations || {})
  .filter(([key]) => /^(autoscaling\.knative\.dev|run\.googleapis\.com)\/(minScale|maxScale|scalingMode|manualInstanceCount)$/.test(key))
  .map(([key, value]) => [key, /^\d+$/.test(String(value)) ? Number(value) : /^(automatic|manual)$/.test(value) ? value : safe(value)]));
const errorFacts = error => ({ exitStatus: error.status || error.code || null,
  permissionDenied: /PERMISSION_DENIED|Permission denied|does not have permission|denied:|403/i.test(String(error.stderr || '')),
  namedPermissions: [...new Set(String(error.stderr || '').match(/\b(?:logging|resourcemanager)\.[A-Za-z]+(?:\.[A-Za-z]+)+\b/g) || [])] });
const result = { mode: 'read-only-config-inspection', expectedConfigHash: expected };
async function main() {
try {
  const fn = cloud(['functions', 'describe', 'notifyBookingReferenceUpdate', '--project=demac-corporation', '--region=us-central1', '--gen2', '--format=json']);
  result.revision = fn.serviceConfig.revision; result.currentConfigHash = configHash(fn); result.retryPolicy = fn.eventTrigger?.retryPolicy || null;
  result.retryVariants = Object.fromEntries(['RETRY_POLICY_RETRY', 'RETRY_POLICY_DO_NOT_RETRY'].map(retryPolicy => [retryPolicy,
    configHash({ ...fn, eventTrigger: { ...fn.eventTrigger, retryPolicy } }) === expected]));
  result.singleAddedFieldMatches = [];
  for (const group of ['buildConfig', 'serviceConfig', 'eventTrigger']) for (const key of Object.keys(fn[group] || {})) {
    const reduced = structuredClone(fn); delete reduced[group][key];
    if (configHash(reduced) === expected) result.singleAddedFieldMatches.push(group + '.' + key);
  }
  result.configuration = Object.fromEntries(Object.entries(releaseConfig(fn)).map(([group, value]) => [group,
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safe(item)])) : safe(value)]));
  const revision = name => cloud(['run', 'revisions', 'describe', name, '--project=demac-corporation', '--region=us-central1', '--format=json']);
  const old = revision('notifybookingreferenceupdate-00001-lin'), current = revision(fn.serviceConfig.revision);
  result.revisionDiff = [];
  const compare = (a, b, prefix) => {
    if (digest(a) === digest(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], prefix + '.' + key);
    } else result.revisionDiff.push({ path: prefix, before: safe(a), after: safe(b) });
  };
  compare(old.spec, current.spec, 'spec');
  result.previousAnnotations = Object.fromEntries(Object.entries(old.metadata?.annotations || {}).map(([k,v]) => [k, safe(v)]));
  const service = cloud(['run', 'services', 'describe', 'notifybookingreferenceupdate', '--project=demac-corporation', '--region=us-central1', '--format=json']);
  result.scaling = { previousRevision: { name: old.metadata.name, annotations: scaling(old), concurrency: old.spec.containerConcurrency },
    currentRevision: { name: current.metadata.name, annotations: scaling(current), concurrency: current.spec.containerConcurrency },
    currentService: { annotations: scaling(service), templateAnnotations: scaling(service.spec?.template),
      traffic: (service.status?.traffic || []).map(item => ({ revisionName: item.revisionName, percent: item.percent })) } };
  result.currentAnnotations = Object.fromEntries(Object.entries(current.metadata?.annotations || {}).map(([k,v]) => [k, safe(v)]));
  result.configurationInspectionComplete = true;
  result.deploymentAccount = JSON.parse(execFileSync('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).map(item => item.account);
  // testIamPermissions reads the caller's access; it grants no role or permission.
  try {
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const requested = ['logging.logEntries.list', 'logging.logs.list'];
    const response = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects/demac-corporation:testIamPermissions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: requested }), signal: AbortSignal.timeout(30000) });
    result.loggingPermissions = { httpStatus: response.status, requested };
    if (response.ok) { const data = await response.json(); result.loggingPermissions.granted = requested.filter(permission => (data.permissions || []).includes(permission)); }
  } catch (error) { result.loggingPermissions = { error: 'Permission inspection unavailable', ...errorFacts(error) }; }
  try {
    const query = 'resource.type="cloud_run_revision" AND resource.labels.service_name="notifybookingreferenceupdate" AND timestamp>="2026-10-12T21:31:00Z" AND (severity>=ERROR OR httpRequest.status>=500)';
    const timestamps = execFileSync('gcloud', ['logging', 'read', query, '--project=demac-corporation', '--limit=1000', '--format=value(timestamp)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const count = timestamps ? timestamps.split('\n').length : 0;
    result.logRead = { succeeded: true, from: '2026-10-12T21:31:00Z', observedAt: new Date().toISOString(), errorCount: count, completeWithinLimit: count < 1000 };
  } catch (error) { result.logRead = { succeeded: false, ...errorFacts(error) }; }
  result.complete = result.logRead.succeeded && result.logRead.errorCount === 0 && result.logRead.completeWithinLimit;
  if (!result.complete) process.exitCode = 1;
} catch (error) { result.error = 'Read-only configuration inspection failed'; result.exitStatus = error.status || error.code; process.exitCode = 1; }
fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'dwelling-config-inspection.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main();
