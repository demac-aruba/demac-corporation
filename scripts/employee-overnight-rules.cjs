'use strict';
// Rules source/metadata only. Never reads or writes employee documents.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const BASE = 'https://firebaserules.googleapis.com/v1/';
const PROJECT = 'projects/demac-corporation';
const RELEASE = PROJECT + '/releases/cloud.firestore';
const BASELINE_HASH = '8dbcaecf7d6faee427cc3600680f542c0be495c0e43f8366c39e3ed1418c5624';
const hash = content => crypto.createHash('sha256').update(content).digest('hex');
function outsideAttendance(source) {
  const start = source.indexOf('    match /employeeTimesheets/{entryId} {');
  const end = source.indexOf('    match /vanMaintenanceLogs/{logId} {', start);
  assert.ok(start >= 0 && end > start, 'Expected Rules boundaries missing');
  return source.slice(0, start) + source.slice(end);
}
async function inspect(api) {
  const release = await api(BASE + RELEASE);
  assert.equal(release.name, RELEASE);
  assert.match(release.rulesetName, /^projects\/demac-corporation\/rulesets\/[^/]+$/);
  const rules = await api(BASE + release.rulesetName);
  assert.equal(rules.source.files.length, 1, 'Unexpected Rules source bundle');
  assert.equal(rules.source.files[0].name, 'firestore.rules');
  return { release, sourceHash: hash(rules.source.files[0].content), source: rules.source.files[0].content };
}
async function auditRules(api, candidate, baseline) {
  assert.equal(hash(baseline), BASELINE_HASH, 'Unreviewed Rules baseline');
  assert.equal(outsideAttendance(candidate), outsideAttendance(baseline), 'Unrelated Rules changed');
  const current = await inspect(api);
  assert.equal(current.sourceHash, BASELINE_HASH, 'Production Rules drift');
  return { baselineHash: current.sourceHash, baselineRelease: current.release, candidateHash: hash(candidate), scope: 'employeeTimesheets adjusted-shift write revision only' };
}
async function publishRules({ api, candidate, audit, sourceGate, record }) {
  assert.equal(audit.baselineHash, BASELINE_HASH);
  assert.equal(hash(candidate), audit.candidateHash, 'Rules candidate differs from audit');
  sourceGate();
  let current = await inspect(api);
  if (current.sourceHash === audit.candidateHash) return { stage: 'complete', alreadyApplied: true, release: current.release, sourceHash: current.sourceHash };
  assert.equal(current.sourceHash, audit.baselineHash, 'Unreviewed live Rules');
  assert.equal(current.release.rulesetName, audit.baselineRelease.rulesetName, 'Rules release changed');
  assert.equal(current.release.updateTime, audit.baselineRelease.updateTime, 'Rules release advanced');
  // Creating an immutable ruleset also compiles/validates it. An interrupted create
  // can leave only an unused source object, never a changed live policy.
  const created = await api(BASE + PROJECT + '/rulesets', 'POST', { source: { files: [{ name: 'firestore.rules', content: candidate }] } });
  assert.match(created.name, /^projects\/demac-corporation\/rulesets\/[^/]+$/);
  const verified = await api(BASE + created.name);
  assert.deepEqual(verified.source.files.map(({name,content})=>({name,content})), [{ name:'firestore.rules', content:candidate }]);
  record({ stage:'candidate-created', rulesetName:created.name });
  sourceGate(); current = await inspect(api);
  assert.equal(current.sourceHash, audit.baselineHash, 'Rules changed before publication');
  assert.equal(current.release.rulesetName, audit.baselineRelease.rulesetName);
  assert.equal(current.release.updateTime, audit.baselineRelease.updateTime);
  record({ stage:'publish-intent', rulesetName:created.name, baselineRelease:current.release });
  // No compare-and-swap is exposed by Rules API. The shared production workflow
  // concurrency lock and immediate source check bound the publication window.
  // On lost response, reconcile the read-only live hash; never blindly roll back.
  let publishError;
  sourceGate();
  try { await api(BASE + RELEASE, 'PATCH', { release:{name:RELEASE,rulesetName:created.name}, updateMask:'rulesetName' }); }
  catch (error) { publishError = error; }
  const after = await inspect(api);
  if (after.sourceHash !== audit.candidateHash) {
    record({ stage:'publication-unconfirmed', sourceHash:after.sourceHash, release:after.release });
    throw publishError || new Error('Rules publication did not reach the reviewed candidate');
  }
  assert.equal(after.release.rulesetName, created.name);
  return { stage:'complete', sourceHash:after.sourceHash, release:after.release, responseReconciled:Boolean(publishError) };
}
module.exports = { auditRules, publishRules, outsideAttendance, hash, BASE, RELEASE, BASELINE_HASH };
