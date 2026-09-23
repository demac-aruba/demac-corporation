// Bounded, owner-authorized release. Never print credentials or runtime environment values.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const project = 'demac-corporation';
const baseline = '0f0bd3f08301e9759df16ddd98b5ec16085a11ed';
if (process.env.GITHUB_REPOSITORY !== 'demac-aruba/demac-corporation' || process.env.GITHUB_REF !== 'refs/heads/release/project-historical-bookings') throw Error('Release context mismatch.');
const run = args => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
const describe = name => JSON.parse(run(['functions', 'describe', name, '--project=' + project, '--region=us-central1', '--gen2', '--format=json']));
const text = bytes => String(bytes).replace(/\r\n/g, '\n');
const config = fn => ({ runtime: fn.buildConfig.runtime, entryPoint: fn.buildConfig.entryPoint,
  service: Object.fromEntries(Object.entries(fn.serviceConfig).filter(([key]) => !['revision', 'uri', 'service'].includes(key))), trigger: fn.eventTrigger || null });
const result = { sourceSha: process.env.GITHUB_SHA, functions: [] };
const artifact = path.join(process.env.RUNNER_TEMP, 'project-history-release.json');
const record = () => fs.writeFileSync(artifact, JSON.stringify(result, null, 2));
async function verifyAuth(name) {
  const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', data: {} }) });
  assert.equal(response.status, 401, name + ' must reject anonymous calls');
}
(async () => {
  const previous = describe('officeBookingAuthority');
  assert.equal(previous.state, 'ACTIVE'); assert.equal(previous.buildConfig.runtime, 'nodejs22');
  // Check the deployed Office source before changing it; a parallel release must not be overwritten.
  const source = previous.buildConfig.source.storageSource;
  const zip = path.join(process.env.RUNNER_TEMP, 'current-office-source.zip');
  run(['storage', 'cp', `gs://${source.bucket}/${source.object}${source.generation ? '#' + source.generation : ''}`, zip, '--quiet']);
  for (const file of ['officeBookingAuthority.js', 'officeBookingAuthorityFacade.js', 'bookingAuthorityCore.js', 'bookingAuthorityFirestore.js', 'bookingAuthoritySchedulingProvider.js', 'bookingAuthorityAppointmentLifecycle.js', 'bookingOperationalMove.js', 'propertyLocations.js']) {
    const deployed = text(execFileSync('unzip', ['-p', zip, file]));
    const base = text(execFileSync('git', ['show', `${baseline}:functions/${file}`]));
    const candidate = text(fs.readFileSync(path.join('functions', file)));
    assert.ok(deployed === base || deployed === candidate, file + ': deployed source changed; reconcile before release');
  }
  let existingProject;
  try { existingProject = describe('projectAuthority'); } catch (error) {
    // Only a verified NOT_FOUND permits creation. Permission/network errors stop the release.
    if (!String(error.stderr || '').includes('NOT_FOUND')) throw error;
  }
  if (existingProject) {
    const existingSource = existingProject.buildConfig.source.storageSource;
    const existingZip = path.join(process.env.RUNNER_TEMP, 'current-project-source.zip');
    run(['storage', 'cp', `gs://${existingSource.bucket}/${existingSource.object}${existingSource.generation ? '#' + existingSource.generation : ''}`, existingZip, '--quiet']);
    assert.equal(text(execFileSync('unzip', ['-p', existingZip, 'projectAuthority.js'])), text(fs.readFileSync('functions/projectAuthority.js')), 'Existing Project Authority differs; reconcile before release');
  }
  const stage = path.join(process.env.RUNNER_TEMP, 'project-history-function-source'); fs.mkdirSync(stage);
  const archive = path.join(process.env.RUNNER_TEMP, 'project-history-source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, 'HEAD:functions']); execFileSync('tar', ['-xf', archive, '-C', stage]);
  // Office guard first: old endpoints must reject a historical Project offer.
  for (const name of ['officeBookingAuthority', 'projectAuthority']) {
    const before = name === 'officeBookingAuthority' ? previous : existingProject;
    const args = ['functions', 'deploy', name, '--project=' + project, '--region=us-central1', '--gen2', '--source=' + stage,
      '--entry-point=' + name, '--runtime=nodejs22', '--run-service-account=' + previous.serviceConfig.serviceAccountEmail, '--quiet', '--format=value(state)'];
    if (!before) args.push('--memory=256Mi', '--timeout=60s', '--trigger-http', '--allow-unauthenticated', '--max-instances=4');
    run(args);
    const after = describe(name); assert.equal(after.state, 'ACTIVE');
    if (before) assert.deepEqual(config(after), config(before), name + ': runtime configuration changed');
    await verifyAuth(name);
    result.functions.push({ name, revision: after.serviceConfig.revision, source: after.buildConfig.source, state: after.state, authenticationVerified: true }); record();
    console.log(name + ': ACTIVE; anonymous access rejected.');
  }
})().catch(error => { result.error = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Release stopped; inspect the bounded deployment job.'; record(); console.error(result.error); process.exitCode = 1; });
