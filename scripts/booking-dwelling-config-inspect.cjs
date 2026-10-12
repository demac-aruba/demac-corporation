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
const result = { mode: 'read-only-config-inspection', expectedConfigHash: expected };
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
  result.complete = true;
} catch (error) { result.error = 'Read-only configuration inspection failed'; result.exitStatus = error.status || error.code; process.exitCode = 1; }
fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'dwelling-config-inspection.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
