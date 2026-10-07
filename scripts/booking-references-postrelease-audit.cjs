// Read-only deployment audit. Never emit customer records, credentials or environment values.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = 'demac-corporation';
const baseline = '0f7155efa951a7751e0daac6ab25e35799a53868';
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 30 * 1024 * 1024 });
const git = args => run('git', args).trim();
const roots = {
  officeBookingAuthority: ['officeBookingAuthorityFacade.js'],
  wacliOutboundPoll: ['whatsappWacliGateway.js'],
  wacliOutboundAck: ['whatsappWacliGateway.js'],
  queueAppointmentConfirmation: ['appointmentNotifications.js'],
  sendDailyTechnicianSchedules: ['technicianDailySchedules.js'],
  bookingVisitReferences: ['bookingVisitReferencesHttp.js'],
  wacliBookingReferenceMedia: ['whatsappWacliGateway.js'],
  cleanupBookingReferenceUploads: ['bookingVisitReferencesHttp.js'],
  notifyBookingReferenceUpdate: ['bookingVisitReferencesHttp.js'],
};
function dependencies(files) {
  const found = new Set();
  const visit = file => {
    if (found.has(file)) return;
    const source = run('git', ['show', `${baseline}:functions/${file}`]);
    found.add(file);
    for (const match of source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
      let next = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      if (!path.posix.extname(next)) next += '.js';
      if (!next.startsWith('../')) visit(next);
    }
  };
  files.forEach(visit); return [...found].sort();
}
const summary = { sourceSha: git(['rev-parse', 'HEAD']), baseline, readOnly: true, functions: [] };
const out = process.env.RUNTIME_AUDIT_OUTPUT;
assert.ok(out && path.isAbsolute(out), 'Absolute audit output directory required');
fs.mkdirSync(out, { recursive: true });
let failed = false;
for (const [name, entries] of Object.entries(roots)) {
  const fn = JSON.parse(run('gcloud', ['functions', 'describe', name, '--project=' + project, '--region=us-central1', '--gen2', '--format=json']));
  assert.equal(fn.state, 'ACTIVE', name + ' must be ACTIVE');
  const source = fn.buildConfig.source.storageSource;
  assert.ok(source?.bucket && source?.object, name + ': deployed source unavailable');
  const zip = path.join(out, name + '.zip');
  run('gcloud', ['storage', 'cp', `gs://${source.bucket}/${source.object}${source.generation ? '#' + source.generation : ''}`, zip, '--quiet']);
  const files = dependencies(entries), mismatches = [];
  for (const file of files) {
    const expected = run('git', ['show', `${baseline}:functions/${file}`]).replace(/\r\n/g, '\n');
    let actual = null;
    try { actual = run('unzip', ['-p', zip, file]).replace(/\r\n/g, '\n'); } catch { /* missing also blocks release */ }
    if (actual !== expected) mismatches.push(file);
  }
  // Retain only mismatch paths, never source archives or runtime configuration.
  fs.unlinkSync(zip);
  summary.functions.push({ name, state: fn.state, revision: fn.serviceConfig.revision, runtime: fn.buildConfig.runtime,
    checkedDependencies: files.length, mismatches });
  console.log(JSON.stringify(summary.functions.at(-1)));
  if (mismatches.length) failed = true;
}
const scheduler = JSON.parse(run('gcloud', ['scheduler', 'jobs', 'describe', 'firebase-schedule-sendDailyTechnicianSchedules-us-central1', '--project=' + project, '--location=us-central1', '--format=json(schedule,timeZone,state)']));
assert.deepEqual(scheduler, { schedule: '0,5,10 8 * * *', timeZone: 'America/Aruba', state: 'ENABLED' });
summary.scheduler = scheduler;
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (failed) throw Error('Production source differs from reviewed release; investigate without deployment.');
