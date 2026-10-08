'use strict';
// Read-only diagnosis of the bounded PR526 release. Never deploys or reads data.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { assertLock } = require('./technician-approved-release.cjs');
assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
assert.equal(process.env.GITHUB_REF, 'refs/heads/fix/pr526-release-preflight-20261008');
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
let stage = 'start';
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 40 * 1024 * 1024 });
const cloud = args => run('gcloud', args);
const zip = path.join(process.env.RUNNER_TEMP, 'technician-preflight-source.zip');
try {
  let field;
  for (const name of ['fieldOperationsAuthority', 'officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyTechnicianSchedules', 'bookingVisitReferences', 'wacliOutboundPoll', 'wacliOutboundAck']) {
    stage = 'describe-' + name;
    const fn = JSON.parse(cloud(['functions', 'describe', name, '--project=demac-corporation', '--region=us-central1', '--gen2', '--format=json']));
    console.log(JSON.stringify({ stage, state: fn.state, runtime: fn.buildConfig?.runtime, revision: fn.serviceConfig?.revision, hasSource: Boolean(fn.buildConfig?.source?.storageSource) }));
    if (name === 'fieldOperationsAuthority') field = fn;
  }
  stage = 'scheduler';
  const schedule = JSON.parse(cloud(['scheduler', 'jobs', 'describe', 'firebase-schedule-sendDailyTechnicianSchedules-us-central1', '--project=demac-corporation', '--location=us-central1', '--format=json']));
  console.log(JSON.stringify({ stage, state: schedule.state, schedule: schedule.schedule, timeZone: schedule.timeZone }));
  stage = 'download-existing-source';
  const source = field.buildConfig.source.storageSource;
  cloud(['storage', 'cp', `gs://${source.bucket}/${source.object}${source.generation ? '#' + source.generation : ''}`, zip, '--quiet']);
  stage = 'read-existing-dependency-lock';
  const lock = run('unzip', ['-p', zip, 'package-lock.json']);
  assertLock(lock, JSON.parse(fs.readFileSync('functions/package.json', 'utf8')));
  console.log(JSON.stringify({ stage, lockMatches: true }));
} catch (error) {
  // Classify only an allowlisted status; never print cloud output/config/credentials.
  const category = String(error.stderr || '').match(/\b(PERMISSION_DENIED|NOT_FOUND|INVALID_ARGUMENT|UNAUTHENTICATED|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/)?.[1] || error.code || 'COMMAND_FAILED';
  console.error(JSON.stringify({ stage, category, exitStatus: error.status || null,
    assertion: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : undefined }));
  process.exitCode = 1;
} finally { if (fs.existsSync(zip)) fs.unlinkSync(zip); }
