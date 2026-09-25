// Bounded, owner-authorized release. Never print credentials or runtime environment values.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const project = 'demac-corporation';
// These immutable commits are the only previously approved source generations
// that this bounded release may replace. A newer independent deployment stops it.
const approvedOffice = [
  '0f0bd3f08301e9759df16ddd98b5ec16085a11ed',
  'ce2b4b701ab3161d41e3aade76c6dde2f7b0e872',
  '38542864b07ef18b32542ff08118fe9eea1526aa',
];
const approvedProject = [
  'ce2b4b701ab3161d41e3aade76c6dde2f7b0e872',
  '38542864b07ef18b32542ff08118fe9eea1526aa',
];
const firstApprovedMain = '38542864b07ef18b32542ff08118fe9eea1526aa';
const officeFiles = ['officeBookingAuthority.js', 'officeBookingAuthorityFacade.js', 'bookingAuthorityCore.js',
  'bookingAuthorityFirestore.js', 'bookingAuthoritySchedulingProvider.js', 'bookingAuthorityAppointmentLifecycle.js',
  'bookingOperationalMove.js', 'bookingSchedulingPrimitives.js', 'projectBookingLinks.js', 'projectRecords.js',
  'propertyLocations.js'];
const projectFiles = ['projectAuthority.js', 'projectRecords.js', 'projectHistoricalBooking.js',
  'bookingProjectHistoricalCapacity.js', 'projectCommercialGuard.js', 'projectSlotUsage.js', 'bookingSchedulingPrimitives.js'];
if (process.env.GITHUB_REPOSITORY !== 'demac-aruba/demac-corporation' || process.env.GITHUB_REF !== 'refs/heads/release/project-historical-bookings') throw Error('Release context mismatch.');
const run = args => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const describe = name => JSON.parse(run(['functions', 'describe', name, '--project=' + project, '--region=us-central1', '--gen2', '--format=json']));
const text = bytes => String(bytes).replace(/\r\n/g, '\n');
const config = fn => ({ runtime: fn.buildConfig.runtime, entryPoint: fn.buildConfig.entryPoint,
  service: Object.fromEntries(Object.entries(fn.serviceConfig).filter(([key]) => !['revision', 'uri', 'service'].includes(key))), trigger: fn.eventTrigger || null });
const result = { sourceSha: process.env.GITHUB_SHA, expectedMainSha: null, approvedOffice, approvedProject,
  stage: 'verify-release-source', functions: [] };
const artifact = path.join(process.env.RUNNER_TEMP, 'project-history-release.json');
const record = () => fs.writeFileSync(artifact, JSON.stringify(result, null, 2));
function remoteSha(ref) {
  const lines = git(['ls-remote', 'origin', ref]).split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `Expected exactly one remote ${ref} ref`);
  const match = /^([0-9a-f]{40})\s+(\S+)$/.exec(lines[0]);
  assert.ok(match && match[2] === ref, `Malformed remote ${ref} ref`);
  return match[1];
}
function verifyReleaseSource() {
  const sourceSha = git(['rev-parse', 'HEAD']);
  assert.equal(sourceSha, process.env.GITHUB_SHA, 'Checked-out release SHA changed');
  assert.equal(remoteSha('refs/heads/release/project-historical-bookings'), sourceSha, 'A newer release branch commit exists');
  const mainSha = remoteSha('refs/heads/main');
  git(['merge-base', '--is-ancestor', firstApprovedMain, mainSha]);
  git(['merge-base', '--is-ancestor', mainSha, sourceSha]);
  for (const item of ['functions', 'scripts/project-history-approved-deploy.cjs', '.github/workflows/project-history.yml']) {
    assert.equal(git(['rev-parse', `${sourceSha}:${item}`]), git(['rev-parse', `${mainSha}:${item}`]),
      `${item} on release branch differs from current published main`);
  }
  if (result.expectedMainSha) assert.equal(mainSha, result.expectedMainSha, 'Main advanced during release');
  result.expectedMainSha = mainSha;
}
function optionalSource(command, args) {
  try { return text(execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { return null; }
}
function deployedZip(fn, name) {
  const source = fn.buildConfig.source.storageSource;
  assert.ok(source?.bucket && source?.object, `${name} deployed source is unavailable`);
  const zip = path.join(process.env.RUNNER_TEMP, `current-${name}-source.zip`);
  run(['storage', 'cp', `gs://${source.bucket}/${source.object}${source.generation ? '#' + source.generation : ''}`, zip, '--quiet']);
  return zip;
}
function verifyApprovedDeployedSource(fn, name, files, approved) {
  const zip = deployedZip(fn, name);
  const deployed = files.map(file => optionalSource('unzip', ['-p', zip, file]));
  const candidate = files.map(file => text(fs.readFileSync(path.join('functions', file))));
  const same = expected => deployed.every((value, index) => value === expected[index]);
  const approvedPrior = approved.find(commit => same(files.map(file => optionalSource('git', ['show', `${commit}:functions/${file}`]))));
  assert.ok(approvedPrior || same(candidate), `${name} deployed source differs from every approved baseline and candidate; reconcile before release`);
  return { approvedPrior: approvedPrior || null, alreadyCandidate: same(candidate) };
}
function verifyUnchanged(name, before) {
  const current = describe(name);
  assert.equal(current.state, 'ACTIVE', `${name} is no longer active`);
  assert.deepEqual({ source: current.buildConfig.source, revision: current.serviceConfig.revision },
    { source: before.buildConfig.source, revision: before.serviceConfig.revision },
    `${name} was independently deployed during this release`);
}
async function verifyAuth(name) {
  const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', data: {} }) });
  assert.equal(response.status, 401, name + ' must reject anonymous calls');
}
(async () => {
  verifyReleaseSource();
  result.stage = 'verify-existing-office';
  const previous = describe('officeBookingAuthority');
  assert.equal(previous.state, 'ACTIVE'); assert.equal(previous.buildConfig.runtime, 'nodejs22');
  result.officeSource = verifyApprovedDeployedSource(previous, 'officeBookingAuthority', officeFiles, approvedOffice);
  result.stage = 'verify-existing-project';
  // A successful, untruncated v2 inventory proves absence without parsing CLI error text.
  // Require the already verified Office resource in the same inventory; permission, network,
  // malformed and wrong-project results must stop before any deployment.
  const inventory = JSON.parse(run(['functions', 'list', '--project=' + project, '--regions=us-central1', '--v2', '--format=json(name)']));
  assert.ok(Array.isArray(inventory) && inventory.some(fn => fn.name === previous.name), 'Verified Office resource is missing from function inventory');
  const projectName = previous.name.replace(/\/officeBookingAuthority$/, '/projectAuthority');
  assert.notEqual(projectName, previous.name, 'Unexpected Office resource identity');
  const existingProject = inventory.some(fn => fn.name === projectName) ? describe('projectAuthority') : undefined;
  assert.ok(existingProject && existingProject.state === 'ACTIVE', 'Approved Project Authority must already exist');
  result.projectSource = verifyApprovedDeployedSource(existingProject, 'projectAuthority', projectFiles, approvedProject);
  const stage = path.join(process.env.RUNNER_TEMP, 'project-history-function-source'); fs.mkdirSync(stage);
  const archive = path.join(process.env.RUNNER_TEMP, 'project-history-source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, 'HEAD:functions']); execFileSync('tar', ['-xf', archive, '-C', stage]);
  // Office guard first: old endpoints must reject a historical Project offer.
  for (const name of ['officeBookingAuthority', 'projectAuthority']) {
    result.stage = 'deploy-' + name;
    const before = name === 'officeBookingAuthority' ? previous : existingProject;
    verifyReleaseSource();
    verifyUnchanged(name, before);
    const args = ['functions', 'deploy', name, '--project=' + project, '--region=us-central1', '--gen2', '--source=' + stage,
      '--entry-point=' + name, '--runtime=nodejs22', '--run-service-account=' + previous.serviceConfig.serviceAccountEmail, '--quiet', '--format=value(state)'];
    run(args);
    result.stage = 'verify-' + name;
    const after = describe(name); assert.equal(after.state, 'ACTIVE');
    if (before) assert.deepEqual(config(after), config(before), name + ': runtime configuration changed');
    await verifyAuth(name);
    result.functions.push({ name, revision: after.serviceConfig.revision, source: after.buildConfig.source, state: after.state, authenticationVerified: true }); record();
    console.log(name + ': ACTIVE; anonymous access rejected.');
  }
  result.stage = 'complete'; record();
})().catch(error => { result.error = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Release stopped at ' + result.stage + '; inspect the bounded deployment job.'; record(); console.error(result.error); process.exitCode = 1; });
